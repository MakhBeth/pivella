/**
 * Lettura e scrittura del file di sync sopra `SyncFileSystem` (13.2, 13.3).
 * Puro: nessun accesso al DOM, testato con il file system in memoria. La
 * parte File System Access sta in `utils/fileSystemSync.ts`.
 */
import { atomicWrite } from './atomicWrite';
import { SYNC_FILENAME, writeSyncFile, type BackupKind, type WriteSyncFileResult } from './backup';
import type { SyncFileSystem } from './fileSystem';
import { pruneSnapshot } from './merge';
import { parseSyncFile, serializeSnapshot, type Stamp, type SyncSnapshot, type Writer } from './schema';

/** Nome precedente alla rinomina: letto solo se `pivella-sync.json` manca. */
export const LEGACY_SYNC_FILENAME = 'forfettino-sync.json';

export interface SyncFileRead {
  snapshot: SyncSnapshot;
  upgradedFromV1: boolean;
  /** `current` è `pivella-sync.json`, `legacy` il vecchio nome. */
  source: 'current' | 'legacy';
  /** Byte esatti letti: servono a conservare il file v1 come backup. */
  bytes: Uint8Array;
}

export async function readSyncSnapshot(fs: SyncFileSystem, stamp: Stamp): Promise<SyncFileRead | null> {
  let bytes = await fs.read(SYNC_FILENAME);
  let source: SyncFileRead['source'] = 'current';
  if (!bytes) {
    bytes = await fs.read(LEGACY_SYNC_FILENAME);
    source = 'legacy';
  }
  if (!bytes) return null;
  const { snapshot, upgradedFromV1 } = parseSyncFile(new TextDecoder().decode(bytes), stamp);
  return { snapshot, upgradedFromV1, source, bytes };
}

export interface WriteSnapshotOptions {
  now: Date;
  writer: Writer;
  /** Esito della lettura che ha preceduto questa scrittura, o null alla prima sync. */
  previous: SyncFileRead | null;
}

/**
 * Timbra la busta, pota, serializza e scrive con backup verificato prima
 * (13.3). Il chiamante detiene il lock. Se il file letto era v1 il backup ha
 * kind `v1`, conservato per sempre; se stava sotto il vecchio nome, i suoi
 * byte vengono prima copiati sul nome nuovo così il backup li preserva, e il
 * vecchio file resta dov'è.
 */
export async function writeSyncSnapshot(fs: SyncFileSystem, snapshot: SyncSnapshot, options: WriteSnapshotOptions): Promise<WriteSyncFileResult> {
  const nowIso = options.now.toISOString();
  const stamped: SyncSnapshot = { ...pruneSnapshot(snapshot, nowIso), updatedAt: nowIso, writer: { ...options.writer } };
  const bytes = new TextEncoder().encode(serializeSnapshot(stamped));

  const previous = options.previous;
  if (previous?.source === 'legacy' && (await fs.read(SYNC_FILENAME)) === null) {
    await atomicWrite(fs, SYNC_FILENAME, previous.bytes);
  }
  const kind: BackupKind = previous?.upgradedFromV1 ? 'v1' : 'app';
  return writeSyncFile(fs, bytes, { kind, now: options.now });
}
