/**
 * Politica di backup (specifica 13.3).
 *
 * Nessuna scrittura sul file di sync inizia se il backup dello stato che sta
 * per essere sovrascritto non è stato completato e verificato.
 */
import { atomicWrite, sha256Hex } from './atomicWrite';
import type { SyncFileSystem } from './fileSystem';

export const SYNC_FILENAME = 'pivella-sync.json';
export const BACKUP_DIR = 'pivella-backups';
export const LATEST_HASH_FILE = `${BACKUP_DIR}/latest.sha256`;

export const KEEP_MOST_RECENT = 30;
export const DAILY_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

export type BackupKind = 'app' | 'mcp' | 'v1' | 'pre-restore';
const KINDS: ReadonlySet<string> = new Set<BackupKind>(['app', 'mcp', 'v1', 'pre-restore']);
const PROTECTED_KINDS: ReadonlySet<BackupKind> = new Set<BackupKind>(['v1', 'pre-restore']);

export class BackupError extends Error {
  code = 'BACKUP_FAILED' as const;
  reason: string;
  constructor(reason: string) {
    super(`Backup non riuscito: ${reason}`);
    this.name = 'BackupError';
    this.reason = reason;
  }
}

export interface BackupOptions {
  kind: BackupKind;
  now: Date;
}

export type BackupOutcome =
  | { status: 'created'; file: string; hash: string }
  | { status: 'skipped-identical'; file?: undefined; hash: string }
  | { status: 'skipped-missing'; file?: undefined; hash?: undefined };

export function backupFileName(now: Date, kind: BackupKind): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `pivella-sync.${stamp}.${kind}.json`;
}

const NAME_RE = /^pivella-sync\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.([a-z0-9-]+)\.json$/;

export function parseBackupFileName(name: string): { timestamp: Date; kind: BackupKind } | null {
  const m = NAME_RE.exec(name);
  if (!m || !KINDS.has(m[2])) return null;
  const [date, time] = m[1].split('T');
  const [hh, mm, ss, ms] = time.replace('Z', '').split('-');
  const timestamp = new Date(`${date}T${hh}:${mm}:${ss}.${ms}Z`);
  if (Number.isNaN(timestamp.getTime())) return null;
  return { timestamp, kind: m[2] as BackupKind };
}

/** Nomi dei backup da cancellare. Pura. */
export function planRotation(names: string[], now: Date): string[] {
  const parsed = names
    .map((name) => ({ name, info: parseBackupFileName(name) }))
    .filter((x): x is { name: string; info: NonNullable<ReturnType<typeof parseBackupFileName>> } => x.info !== null)
    .sort((a, b) => b.info.timestamp.getTime() - a.info.timestamp.getTime());

  const toDelete: string[] = [];
  const seenDays = new Set<string>();
  parsed.forEach(({ name, info }, index) => {
    const day = info.timestamp.toISOString().slice(0, 10);
    if (index < KEEP_MOST_RECENT) {
      seenDays.add(day);
      return;
    }
    if (PROTECTED_KINDS.has(info.kind)) return;
    const age = now.getTime() - info.timestamp.getTime();
    if (age < DAY_MS) return;
    if (age > DAILY_RETENTION_DAYS * DAY_MS || seenDays.has(day)) {
      toDelete.push(name);
      return;
    }
    seenDays.add(day);
  });
  return toDelete;
}

export interface RotationResult {
  deleted: string[];
  failed: Array<{ name: string; reason: string }>;
}

/** Cancella i backup in eccesso. Non lancia mai: gli errori sono riportati. */
export async function rotateBackups(fs: SyncFileSystem, now: Date): Promise<RotationResult> {
  const result: RotationResult = { deleted: [], failed: [] };
  let names: string[];
  try {
    names = await fs.list(BACKUP_DIR);
  } catch (err) {
    result.failed.push({ name: BACKUP_DIR, reason: messageOf(err) });
    return result;
  }
  for (const name of planRotation(names, now)) {
    try {
      await fs.remove(`${BACKUP_DIR}/${name}`);
      result.deleted.push(name);
    } catch (err) {
      result.failed.push({ name, reason: messageOf(err) });
    }
  }
  return result;
}

export async function backupBeforeWrite(fs: SyncFileSystem, { kind, now }: BackupOptions): Promise<BackupOutcome> {
  try {
    await removeStaleParts(fs);

    const current = await fs.read(SYNC_FILENAME);
    if (!current) return { status: 'skipped-missing' };

    const hash = await sha256Hex(current);
    const latest = await fs.read(LATEST_HASH_FILE);
    if (latest && new TextDecoder().decode(latest).trim() === hash) {
      return { status: 'skipped-identical', hash };
    }

    const file = `${BACKUP_DIR}/${backupFileName(now, kind)}`;
    await atomicWrite(fs, file, current);
    await fs.write(LATEST_HASH_FILE, new TextEncoder().encode(hash));
    return { status: 'created', file, hash };
  } catch (err) {
    throw new BackupError(messageOf(err));
  }
}

async function removeStaleParts(fs: SyncFileSystem): Promise<void> {
  for (const name of await fs.list(BACKUP_DIR)) {
    if (name.endsWith('.part')) await fs.remove(`${BACKUP_DIR}/${name}`);
  }
}

export interface WriteSyncFileResult {
  backup: BackupOutcome;
  write: { method: 'move' | 'fallback'; hash: string };
  rotation: RotationResult;
}

/**
 * Backup, poi scrittura atomica del file di sync, poi rotazione.
 * Il chiamante detiene il lock (13.3). Se il backup fallisce, il file di sync
 * non viene toccato.
 */
export async function writeSyncFile(fs: SyncFileSystem, bytes: Uint8Array, options: BackupOptions): Promise<WriteSyncFileResult> {
  const backup = await backupBeforeWrite(fs, options);
  const write = await atomicWrite(fs, SYNC_FILENAME, bytes);
  const rotation = await rotateBackups(fs, options.now);
  return { backup, write, rotation };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
