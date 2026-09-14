/**
 * Cronologia dei backup e ripristino (specifica 13.3, "Ripristino").
 *
 * Un ripristino è un rimpiazzo totale, non un merge: backup `pre-restore`
 * dello stato corrente, poi il file di sync riscritto con il contenuto del
 * backup e `restoredAt`, `restoredFrom`, `writer.kind = restore` nella busta,
 * poi il database rimpiazzato e il ripristino riconosciuto. Se il backup
 * `pre-restore` fallisce, il ripristino non parte.
 */
import type { IndexedDBManager } from '../db/IndexedDBManager';
import { STORES } from '../constants/fiscali';
import { BACKUP_DIR, parseBackupFileName, type BackupKind, type WriteSyncFileResult } from './backup';
import type { SyncFileSystem } from './fileSystem';
import { acquireLock } from './lock';
import type { StoreName, User } from '../../types';
import { parseSyncFile, type Stamp, type SyncSnapshot, type Writer } from './schema';
import { runSyncCycle, type SyncCycleOptions, type SyncSource } from './syncCycle';
import { writeSyncSnapshot } from './syncFile';

export interface BackupEntry {
  name: string;
  kind: BackupKind;
  timestamp: Date;
  size: number;
}

export interface BackupPreview {
  name: string;
  snapshot: SyncSnapshot;
  upgradedFromV1: boolean;
  counts: Record<StoreName, number>;
  users: User[];
}

function validBackupName(name: string): boolean {
  return !name.includes('/') && !name.includes('\\') && parseBackupFileName(name) !== null;
}

/** Backup validi nella cartella, dal più recente. La dimensione viene dalla lettura del file. */
export async function listBackups(fs: SyncFileSystem): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];
  for (const name of await fs.list(BACKUP_DIR)) {
    const parsed = parseBackupFileName(name);
    if (!parsed) continue;
    const bytes = await fs.read(`${BACKUP_DIR}/${name}`);
    if (!bytes) continue;
    entries.push({ name, kind: parsed.kind, timestamp: parsed.timestamp, size: bytes.byteLength });
  }
  return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || (a.name < b.name ? 1 : -1));
}

export async function readBackup(fs: SyncFileSystem, name: string, stamp: Stamp): Promise<BackupPreview> {
  if (!validBackupName(name)) throw new Error(`Nome di backup non valido: ${name}`);
  const bytes = await fs.read(`${BACKUP_DIR}/${name}`);
  if (!bytes) throw new Error(`Backup non trovato: ${name}`);
  const { snapshot, upgradedFromV1 } = parseSyncFile(new TextDecoder().decode(bytes), stamp);
  const counts = {} as Record<StoreName, number>;
  for (const store of STORES) counts[store] = snapshot[store].length;
  return { name, snapshot, upgradedFromV1, counts, users: snapshot.users };
}

export interface RestoreOptions {
  now?: () => Date;
  /** Stessa preparazione del ciclo di sync (es. profili per un backup v1 senza utenti). */
  prepare?: (snapshot: SyncSnapshot) => SyncSnapshot;
  /** Solo per `restoreBackupSafely`: pubblicazione delle applicazioni del giro preliminare. */
  onApplied?: SyncCycleOptions['onApplied'];
  /** Solo per `restoreBackupSafely`: il giro preliminare ha applicato un ripristino già presente nel file. */
  onRestored?: () => Promise<void> | void;
}

export interface RestoreOutcome {
  snapshot: SyncSnapshot;
  write: WriteSyncFileResult;
}

export async function restoreFromBackup(fs: SyncFileSystem, db: IndexedDBManager, name: string, options: RestoreOptions = {}): Promise<RestoreOutcome> {
  const nowDate = (options.now ?? (() => new Date()))();
  const nowIso = nowDate.toISOString();
  const writer: Writer = { id: db.writerId ?? 'app-unknown', kind: 'restore' };
  const preview = await readBackup(fs, name, { now: nowIso, writer });
  const prepared = options.prepare ? options.prepare(preview.snapshot) : preview.snapshot;
  const snapshot: SyncSnapshot = { ...prepared, restoredAt: nowIso, restoredFrom: name, tombstones: [] };

  const lock = await acquireLock(fs, { writerId: writer.id, kind: writer.kind });
  try {
    // Prima il file: se l'app muore subito dopo, il prossimo giro vede
    // restoredAt maggiore di lastRestoreAck e completa il rimpiazzo locale.
    const write = await writeSyncSnapshot(fs, snapshot, { now: nowDate, writer, previous: null, kind: 'pre-restore' });
    await db.restoreFromSnapshot(snapshot);
    return { snapshot, write };
  } finally {
    await lock.release();
  }
}

/**
 * Ripristino dall'app. Prima un giro di sync completo, così ogni modifica
 * locale non ancora nel file (debounce, backup fallito in precedenza) finisce
 * nel file e quindi nel backup `pre-restore`. Se quel giro non riesce a
 * scrivere, il ripristino non parte e nulla viene toccato.
 */
export async function restoreBackupSafely(source: SyncSource, db: IndexedDBManager, name: string, options: RestoreOptions = {}): Promise<RestoreOutcome> {
  const writer: Writer = { id: db.writerId ?? 'app-unknown', kind: 'app' };
  const outcome = await runSyncCycle({ db, source, writer, now: options.now, prepareRemote: options.prepare, onApplied: options.onApplied });
  if (outcome.status === 'stale') throw new Error('Il file di sincronizzazione continua a cambiare: ripristino annullato');
  if (outcome.status === 'restored') {
    // Il database è stato rimpiazzato: chi ascolta deve saperlo anche se qui ci si ferma.
    await options.onRestored?.();
    throw new Error('Il file conteneva già un ripristino più recente, applicato ora: ricontrolla e riprova');
  }
  return restoreFromBackup(source.fs, db, name, options);
}
