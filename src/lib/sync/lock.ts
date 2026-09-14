/**
 * Lock advisory sul file di sync (specifica 13.3).
 *
 * File `pivella-sync.lock` con `{ writerId, kind, acquiredAt }`. Se il file
 * manca o è più vecchio di 10 secondi lo si scrive, si attende 50 ms, lo si
 * rilegge: se porta il proprio writerId il lock è acquisito. Timeout
 * complessivo 3 secondi, poi SOURCE_LOCKED. Il lock è advisory: nessuno dei
 * due writer ha esclusione atomica, per questo il backup è obbligatorio.
 */
import type { SyncFileSystem } from './fileSystem';
import type { WriterKind } from './schema';
import { instantOf } from './schema';

export const LOCK_FILE = 'pivella-sync.lock';
export const LOCK_STALE_MS = 10_000;
export const LOCK_TIMEOUT_MS = 3_000;
const LOCK_SETTLE_MS = 50;

export interface LockRecord {
  writerId: string;
  kind: WriterKind;
  acquiredAt: string;
}

export interface LockOptions {
  writerId: string;
  kind: WriterKind;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export interface SyncLock {
  record: LockRecord;
  release(): Promise<void>;
}

export class SyncLockedError extends Error {
  code = 'SOURCE_LOCKED' as const;
  holder: LockRecord | null;
  constructor(holder: LockRecord | null) {
    super(holder ? `File di sync bloccato da ${holder.writerId} (${holder.kind}) dalle ${holder.acquiredAt}` : 'File di sync bloccato');
    this.name = 'SyncLockedError';
    this.holder = holder;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readLock(fs: SyncFileSystem): Promise<LockRecord | null> {
  try {
    const raw = await fs.read(LOCK_FILE);
    if (!raw) return null;
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<LockRecord>;
    if (typeof parsed?.writerId !== 'string' || typeof parsed.acquiredAt !== 'string') return null;
    return parsed as LockRecord;
  } catch {
    // Un lock illeggibile non è un lock: vale come stantio.
    return null;
  }
}

export async function acquireLock(fs: SyncFileSystem, options: LockOptions): Promise<SyncLock> {
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
  const started = instantOf(now());
  let holder: LockRecord | null = null;

  for (;;) {
    const current = await readLock(fs);
    const stale = !current || instantOf(now()) - instantOf(current.acquiredAt) > LOCK_STALE_MS;
    if (stale) {
      const record: LockRecord = { writerId: options.writerId, kind: options.kind, acquiredAt: now() };
      await fs.write(LOCK_FILE, new TextEncoder().encode(JSON.stringify(record)));
      await sleep(LOCK_SETTLE_MS);
      const after = await readLock(fs);
      if (after?.writerId === options.writerId) {
        return { record, release: () => fs.remove(LOCK_FILE) };
      }
      holder = after;
    } else {
      holder = current;
    }
    if (instantOf(now()) - started >= timeoutMs) throw new SyncLockedError(holder);
    await sleep(LOCK_SETTLE_MS);
  }
}
