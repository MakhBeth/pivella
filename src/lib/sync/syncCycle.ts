/**
 * Ciclo di sincronizzazione dell'app (protocollo di scrittura, 13.2):
 * leggi, ripristina se il file porta un ripristino non ancora riconosciuto,
 * altrimenti fondi, applica a IndexedDB, e riscrivi il file solo se diverso,
 * sotto lock e dopo aver ricontrollato che nessuno l'abbia toccato.
 *
 * Puro rispetto al browser: lavora su `SyncSource` e su `IndexedDBManager`,
 * testato con file system in memoria e fake-indexeddb.
 */
import type { IndexedDBManager } from '../db/IndexedDBManager';
import type { WriteSyncFileResult } from './backup';
import type { SyncFileSystem } from './fileSystem';
import { acquireLock } from './lock';
import { mergeSnapshots, type MergeResult, type StoreChanges } from './merge';
import { compareInstants, snapshotsEquivalent, type SyncSnapshot, type Writer } from './schema';
import { readSyncSnapshot, writeSyncSnapshot } from './syncFile';
import { STORES } from '../constants/fiscali';
import type { StoreName } from '../../types';

export interface SyncSource {
  fs: SyncFileSystem;
  /**
   * Versione del file letto: identità e `lastModified` del file di sync, o
   * del file legacy se il corrente manca; null se non c'è nessuno dei due.
   * Cambia a ogni scrittura da qualunque writer e quando compare il file corrente.
   */
  lastModified(): Promise<string | null>;
}

export interface SyncCycleOptions {
  db: IndexedDBManager;
  source: SyncSource;
  writer: Writer;
  now?: () => Date;
  /** Aggiusta lo snapshot letto prima del merge (es. record senza userId). Una differenza viene riscritta nel file. */
  prepareRemote?: (snapshot: SyncSnapshot) => SyncSnapshot;
  /** Quante volte rileggere se il file cambia tra lettura e lock. */
  maxRetries?: number;
  /**
   * Chiamato subito dopo ogni applicazione a IndexedDB, prima della scrittura
   * del file: così lo stato React riceve ciò che è stato applicato anche se
   * poi il backup o il lock falliscono, o se il giro rilegge e rifonde.
   */
  onApplied?: (applied: AppliedChanges, merge: MergeResult) => Promise<void> | void;
}

export type AppliedChanges = Record<StoreName, StoreChanges>;

export type SyncCycleOutcome =
  | { status: 'created'; localChanged: false; write: WriteSyncFileResult }
  | { status: 'restored'; localChanged: true; snapshot: SyncSnapshot }
  | { status: 'unchanged'; localChanged: boolean; merge: MergeResult }
  | { status: 'written'; localChanged: boolean; merge: MergeResult; write: WriteSyncFileResult }
  | { status: 'stale'; localChanged: boolean };

function anyChange(changes: AppliedChanges): boolean {
  return STORES.some((s) => changes[s].upserted.length > 0 || changes[s].deleted.length > 0);
}

export async function runSyncCycle(options: SyncCycleOptions): Promise<SyncCycleOutcome> {
  const { db, source, writer } = options;
  const now = options.now ?? (() => new Date());
  const maxRetries = options.maxRetries ?? 3;
  let localChanged = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const nowDate = now();
    const stamp = { now: nowDate.toISOString(), writer };
    // Byte e lastModified devono appartenere alla stessa versione del file:
    // se cambia durante la lettura, si rilegge.
    const beforeRead = await source.lastModified();
    const read = await readSyncSnapshot(source.fs, stamp);
    const seenModified = await source.lastModified();
    if (seenModified !== beforeRead) continue;

    if (!read) {
      // Prima sincronizzazione: il file nasce dallo stato locale.
      const local = await db.exportSnapshot();
      const lock = await acquireLock(source.fs, { writerId: writer.id, kind: writer.kind });
      try {
        if ((await source.lastModified()) !== seenModified) continue;
        const write = await writeSyncSnapshot(source.fs, local, { now: nowDate, writer, previous: null });
        return { status: 'created', localChanged: false, write };
      } finally {
        await lock.release();
      }
    }

    const remote = options.prepareRemote ? options.prepareRemote(read.snapshot) : read.snapshot;

    // Ripristino non ancora riconosciuto: rimpiazzo totale, niente merge, niente scrittura.
    const ack = await db.getLastRestoreAck();
    if (remote.restoredAt && compareInstants(remote.restoredAt, ack) > 0) {
      await db.restoreFromSnapshot(remote);
      return { status: 'restored', localChanged: true, snapshot: remote };
    }

    const local = await db.exportSnapshot();
    const merge = mergeSnapshots(local, remote, { now: stamp.now, writer });
    const applied = await db.mergeIntoDb(merge, local);
    if (anyChange(applied)) {
      localChanged = true;
      await options.onApplied?.(applied, merge);
    }

    const mustWrite = read.upgradedFromV1 || read.source === 'legacy' || !snapshotsEquivalent(merge.snapshot, read.snapshot);
    if (!mustWrite) return { status: 'unchanged', localChanged, merge };

    const lock = await acquireLock(source.fs, { writerId: writer.id, kind: writer.kind });
    try {
      if ((await source.lastModified()) !== seenModified) continue;
      const write = await writeSyncSnapshot(source.fs, merge.snapshot, { now: nowDate, writer, previous: read });
      return { status: 'written', localChanged, merge, write };
    } finally {
      await lock.release();
    }
  }
  return { status: 'stale', localChanged };
}
