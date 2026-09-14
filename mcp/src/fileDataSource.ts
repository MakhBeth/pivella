/**
 * `DataSource` sul file di sync (13.2, 13.3, 13.4). Il server non ha stato
 * proprio: ogni lettura rilegge il file; ogni scrittura fa lock, lettura,
 * modifica in memoria di `proposals` soltanto, backup verificato, scrittura,
 * rilascio. Gli store e i tombstone non vengono mai toccati.
 */
import { BackupError } from '../../src/lib/sync/backup';
import type { SyncFileSystem } from '../../src/lib/sync/fileSystem';
import { acquireLock, SyncLockedError, type LockOptions } from '../../src/lib/sync/lock';
import { createProposal, withdrawProposal, withExpiry, ProposalNotPendingError, type NewProposal } from '../../src/lib/sync/proposals';
import { SyncSchemaError, type Proposal, type SyncSnapshot, type Writer } from '../../src/lib/sync/schema';
import { readSyncSnapshot, writeSyncSnapshot, type SyncFileRead } from '../../src/lib/sync/syncFile';
import type { User } from '../../src/types';
import { DataSourceError, paginate, type DataSource, type Principal, type ProposalFilter, type UserSnapshot } from './datasource';

export interface FileDataSourceOptions {
  writerId: string;
  version?: string;
  /** Iniettabile per i test. */
  now?: () => Date;
  lock?: Pick<LockOptions, 'sleep' | 'timeoutMs'>;
}

export class FileDataSource implements DataSource {
  private readonly fs: SyncFileSystem;
  private readonly writer: Writer;
  private readonly now: () => Date;
  private readonly lockOptions: Pick<LockOptions, 'sleep' | 'timeoutMs'>;

  constructor(fs: SyncFileSystem, options: FileDataSourceOptions) {
    this.fs = fs;
    this.writer = { id: options.writerId, kind: 'mcp', ...(options.version ? { version: options.version } : {}) };
    this.now = options.now ?? (() => new Date());
    this.lockOptions = options.lock ?? {};
  }

  async listUsers(_p: Principal): Promise<User[]> {
    const { snapshot } = await this.read();
    return snapshot.users;
  }

  async getSnapshot(_p: Principal, userId: string): Promise<UserSnapshot> {
    const { snapshot, readAt } = await this.read();
    return this.userSnapshot(snapshot, userId, readAt);
  }

  async listProposals(_p: Principal, f: ProposalFilter): Promise<{ items: Proposal[]; total: number }> {
    const { snapshot, readAt } = await this.read();
    this.requireUser(snapshot, f.userId);
    const visible = withExpiry(snapshot.proposals, readAt).filter((p) => p.userId === f.userId && (f.status === undefined || p.status === f.status));
    const { items, total } = paginate(visible, f.limit, f.offset);
    return { items, total };
  }

  async getProposal(_p: Principal, proposalId: string): Promise<Proposal | null> {
    const { snapshot, readAt } = await this.read();
    const found = snapshot.proposals.find((p) => p.id === proposalId);
    return found ? withExpiry([found], readAt)[0] : null;
  }

  async addProposal(_p: Principal, input: NewProposal): Promise<Proposal> {
    return this.write((snapshot, now) => {
      this.requireUser(snapshot, input.userId);
      const proposal = createProposal(input, { now, writerId: this.writer.id });
      return { proposals: [...snapshot.proposals, proposal], result: proposal };
    });
  }

  async withdrawProposal(_p: Principal, proposalId: string): Promise<Proposal> {
    return this.write((snapshot, now) => {
      const index = snapshot.proposals.findIndex((p) => p.id === proposalId);
      if (index < 0) throw new DataSourceError('NOT_FOUND', `Proposta ${proposalId} inesistente`, { proposalId });
      const withdrawn = withdrawProposal(snapshot.proposals[index], now);
      const proposals = [...snapshot.proposals];
      proposals[index] = withdrawn;
      return { proposals, result: withdrawn };
    });
  }

  private async read(): Promise<SyncFileRead & { readAt: string }> {
    const readAt = this.now().toISOString();
    let file: SyncFileRead | null;
    try {
      file = await readSyncSnapshot(this.fs, { now: readAt, writer: this.writer });
    } catch (err) {
      throw translate(err);
    }
    if (!file) throw new DataSourceError('SOURCE_UNAVAILABLE', 'File di sync non trovato nella cartella indicata');
    return { ...file, readAt };
  }

  /**
   * Protocollo di scrittura del server (13.2): lock, lettura, modifica in
   * memoria delle sole proposte, backup, scrittura, rilascio. Se il file era
   * v1 la busta viene aggiornata a v2 e il backup ha kind `v1`.
   */
  private async write<T>(mutate: (snapshot: SyncSnapshot, now: string) => { proposals: Proposal[]; result: T }): Promise<T> {
    let lock;
    try {
      lock = await acquireLock(this.fs, { writerId: this.writer.id, kind: 'mcp', now: () => this.now().toISOString(), ...this.lockOptions });
    } catch (err) {
      throw translate(err);
    }
    try {
      const file = await this.read();
      const { proposals, result } = mutate(file.snapshot, file.readAt);
      const next: SyncSnapshot = { ...file.snapshot, proposals };
      const kind = file.upgradedFromV1 ? 'v1' : 'mcp';
      await writeSyncSnapshot(this.fs, next, { now: this.now(), writer: this.writer, previous: file, kind });
      return result;
    } catch (err) {
      throw translate(err);
    } finally {
      await lock.release();
    }
  }

  private requireUser(snapshot: SyncSnapshot, userId: string): User {
    const user = snapshot.users.find((u) => u.id === userId);
    if (!user) throw new DataSourceError('USER_NOT_FOUND', `Profilo ${userId} non trovato`, { userId });
    return user;
  }

  private userSnapshot(snapshot: SyncSnapshot, userId: string, readAt: string): UserSnapshot {
    const user = this.requireUser(snapshot, userId);
    const own = <T extends { userId: string }>(records: T[]) => records.filter((r) => r.userId === userId);
    const config = snapshot.config.find((c) => c.id === `config_${userId}`) ?? snapshot.config.find((c) => c.userId === userId) ?? null;
    return {
      user,
      config,
      clienti: own(snapshot.clienti),
      fatture: own(snapshot.fatture),
      workLogs: own(snapshot.workLogs),
      scadenze: own(snapshot.scadenze),
      readAt,
    };
  }
}

/** Mappa gli errori dei moduli di sync sui codici del contratto (13.1). */
export function translate(err: unknown): DataSourceError {
  if (err instanceof DataSourceError) return err;
  if (err instanceof SyncSchemaError) return new DataSourceError(err.code, err.message, err.details);
  if (err instanceof SyncLockedError) return new DataSourceError('SOURCE_LOCKED', err.message, err.holder ? { holder: err.holder } : undefined);
  if (err instanceof BackupError) return new DataSourceError('BACKUP_FAILED', err.message, { reason: err.reason });
  if (err instanceof ProposalNotPendingError) return new DataSourceError('PROPOSAL_NOT_PENDING', err.message, err.details);
  const message = err instanceof Error ? err.message : String(err);
  if (/ENOENT|EACCES|EPERM|fuori dalla cartella|sostituita/.test(message)) {
    return new DataSourceError('SOURCE_UNAVAILABLE', message);
  }
  return new DataSourceError('INTERNAL', message);
}
