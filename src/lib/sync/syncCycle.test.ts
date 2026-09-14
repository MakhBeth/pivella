import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { IndexedDBManager } from '../db/IndexedDBManager';
import { openSyncMetaDb } from '../db/syncMetaDb';
import { BACKUP_DIR, BackupError, SYNC_FILENAME } from './backup';
import { LOCK_FILE } from './lock';
import { createEmptySnapshot, type SyncSnapshot, type Writer } from './schema';
import { runSyncCycle, type SyncSource } from './syncCycle';
import { LEGACY_SYNC_FILENAME } from './syncFile';
import { fromBytes, memoryFileSystem, text, type MemoryFileSystem } from './testing/memoryFileSystem';

console.log = () => {};
console.warn = () => {};

const T0 = '2026-09-01T00:00:00.000Z';
const T1 = '2026-09-02T00:00:00.000Z';
const NOW = '2026-09-14T10:00:00.000Z';
const MCP: Writer = { id: 'mcp-1', kind: 'mcp' };

const cliente = (id: string, nome: string, updatedAt: string, updatedBy = 'app-a') => ({ id, userId: 'u1', nome, updatedAt, updatedBy });

/** Sorgente in memoria: `lastModified` cresce a ogni scrittura del file di sync, come farebbe il disco. */
function memorySource(fs: MemoryFileSystem): SyncSource & { bump: () => void } {
  let version = 0;
  const write = fs.write.bind(fs);
  fs.write = async (path, bytes) => {
    if (path === SYNC_FILENAME) version++;
    return write(path, bytes);
  };
  const move = fs.move?.bind(fs);
  if (move) fs.move = async (from, to) => { if (to === SYNC_FILENAME) version++; return move(from, to); };
  return {
    fs,
    lastModified: async () => ((await fs.read(SYNC_FILENAME)) ? version : null),
    bump: () => { version++; },
  };
}

async function setup() {
  const factory = new IDBFactory();
  const db = new IndexedDBManager({ factory, now: () => NOW });
  await db.init();
  const fs = memoryFileSystem({ withMove: true });
  const source = memorySource(fs);
  const writer: Writer = { id: db.writerId!, kind: 'app' };
  return { factory, db, fs, source, writer, run: (extra: Record<string, unknown> = {}) => runSyncCycle({ db, source, writer, now: () => new Date(NOW), ...extra }) };
}

function remoteWith(mutate: (s: SyncSnapshot) => void): string {
  const s = createEmptySnapshot({ now: T0, writer: MCP });
  mutate(s);
  return JSON.stringify(s);
}

test('first sync with no file writes the local snapshot and creates no backup', async () => {
  const { db, fs, run } = await setup();
  await db.put('clienti', cliente('c1', 'Locale', T0));
  const outcome = await run();
  assert.equal(outcome.status, 'created');
  const written = JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!);
  assert.equal(written.schemaVersion, 2);
  assert.deepEqual(written.clienti.map((c: any) => c.id), ['c1']);
  assert.deepEqual(await fs.list(BACKUP_DIR), []);
  assert.equal(await fs.read(LOCK_FILE), null, 'il lock viene rilasciato');
});

test('a newer record in the file updates IndexedDB and leaves the file untouched', async () => {
  const { db, fs, run } = await setup();
  await db.put('clienti', cliente('c1', 'Vecchio', T0));
  const bytes = remoteWith((s) => s.clienti.push(cliente('c1', 'Nuovo dal file', T1, 'mcp-1') as any));
  await fs.write(SYNC_FILENAME, text(bytes));
  const outcome = await run();
  assert.equal(outcome.status, 'unchanged');
  assert.equal(outcome.localChanged, true);
  assert.equal((await db.get('clienti', 'c1')).nome, 'Nuovo dal file');
  assert.equal(fromBytes(await fs.read(SYNC_FILENAME)), bytes);
});

test('a newer local record is written to the file after a backup of the previous one', async () => {
  const { db, fs, run } = await setup();
  await db.put('clienti', cliente('c1', 'Locale più nuovo', T1));
  await fs.write(SYNC_FILENAME, text(remoteWith((s) => s.clienti.push(cliente('c1', 'Vecchio nel file', T0, 'mcp-1') as any))));
  const outcome = await run();
  assert.equal(outcome.status, 'written');
  assert.equal(outcome.localChanged, false);
  const written = JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!);
  assert.equal(written.clienti[0].nome, 'Locale più nuovo');
  assert.equal(written.updatedAt, NOW);
  assert.equal(written.writer.id, db.writerId);
  const backups = await fs.list(BACKUP_DIR);
  assert.equal(backups.filter((n) => n.endsWith('.app.json')).length, 1);
  assert.equal(await fs.read(LOCK_FILE), null);
});

test('an identical file is not rewritten', async () => {
  const { db, fs, run } = await setup();
  await db.put('clienti', cliente('c1', 'Uguale', T0));
  await fs.write(SYNC_FILENAME, text(remoteWith((s) => s.clienti.push(cliente('c1', 'Uguale', T0) as any))));
  const before = fromBytes(await fs.read(SYNC_FILENAME));
  const outcome = await run();
  assert.equal(outcome.status, 'unchanged');
  assert.equal(outcome.localChanged, false);
  assert.equal(fromBytes(await fs.read(SYNC_FILENAME)), before);
});

test('a v1 file is upgraded and rewritten as v2 with a v1 backup even when the data is identical', async () => {
  const { db, fs, run } = await setup();
  const v1 = JSON.stringify({ users: [], config: [], clienti: [{ id: 'c1', userId: 'u1', nome: 'Legacy' }], fatture: [], workLogs: [], scadenze: [] });
  await fs.write(SYNC_FILENAME, text(v1));
  const outcome = await run();
  assert.equal(outcome.status, 'written');
  assert.equal(JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!).schemaVersion, 2);
  const v1Backups = (await fs.list(BACKUP_DIR)).filter((n) => n.endsWith('.v1.json'));
  assert.equal(v1Backups.length, 1);
  assert.equal(fromBytes(await fs.read(`${BACKUP_DIR}/${v1Backups[0]}`)), v1);
  assert.equal((await db.get('clienti', 'c1')).nome, 'Legacy');
});

test('a legacy-named file is read, preserved as v1 backup and left in place', async () => {
  const { fs, run } = await setup();
  const v1 = JSON.stringify({ users: [], config: [], clienti: [{ id: 'c1', userId: 'u1', nome: 'Legacy' }], fatture: [], workLogs: [], scadenze: [] });
  await fs.write(LEGACY_SYNC_FILENAME, text(v1));
  const outcome = await run();
  assert.equal(outcome.status, 'written');
  assert.equal(fromBytes(await fs.read(LEGACY_SYNC_FILENAME)), v1);
  assert.equal((await fs.list(BACKUP_DIR)).filter((n) => n.endsWith('.v1.json')).length, 1);
});

test('a file with restoredAt newer than the last acknowledged restore replaces local data instead of merging', async () => {
  const { db, fs, factory, run } = await setup();
  await db.put('clienti', cliente('locale', 'Solo locale, più nuovo', NOW));
  await db.put('fatture', { id: 'f1', userId: 'u1', updatedAt: T0, updatedBy: 'app-a' });
  await db.delete('fatture', 'f1');
  const bytes = remoteWith((s) => {
    s.clienti.push(cliente('dalBackup', 'Dal backup', T0) as any);
    s.restoredAt = T1;
    s.restoredFrom = 'pivella-sync.2026-09-01T00-00-00-000Z.app.json';
    s.writer = { id: 'restore-1', kind: 'restore' };
  });
  await fs.write(SYNC_FILENAME, text(bytes));
  const outcome = await run();
  assert.equal(outcome.status, 'restored');
  assert.deepEqual((await db.getAll('clienti')).map((c) => c.id), ['dalBackup']);
  assert.equal(await db.getLastRestoreAck(), T1);
  const meta = await openSyncMetaDb(factory);
  assert.deepEqual(await meta.getTombstones(), []);
  meta.close();
  assert.equal(fromBytes(await fs.read(SYNC_FILENAME)), bytes, 'nessuna scrittura durante il ripristino');

  // Al giro successivo il ripristino è già riconosciuto: si torna al merge normale.
  const again = await run();
  assert.equal(again.status, 'unchanged');
});

test('when the file changes between the read and the lock the cycle rereads and merges again', async () => {
  const { db, fs, source, run } = await setup();
  await db.put('clienti', cliente('c1', 'Locale', T1));
  await fs.write(SYNC_FILENAME, text(remoteWith(() => {})));
  let bumped = false;
  const lastModified = source.lastModified;
  source.lastModified = async () => {
    const v = await lastModified();
    if (!bumped && v !== null) {
      // Simula un altro writer che aggiunge un cliente subito dopo la nostra lettura.
      bumped = true;
      await fs.write(SYNC_FILENAME, text(remoteWith((s) => s.clienti.push(cliente('c2', 'Dal server', T1, 'mcp-1') as any))));
      return v;
    }
    return v;
  };
  const outcome = await run();
  assert.equal(outcome.status, 'written');
  const written = JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!);
  assert.deepEqual(written.clienti.map((c: any) => c.id).sort(), ['c1', 'c2'], 'la scrittura include ciò che è arrivato nel frattempo');
  assert.equal((await db.get('clienti', 'c2')).nome, 'Dal server');
});

test('a failed backup leaves the file untouched, releases the lock and surfaces BackupError', async () => {
  const { db, source, run } = await setup();
  const fs = source.fs as MemoryFileSystem;
  const write = fs.write.bind(fs);
  fs.write = async (path, bytes) => {
    if (path.startsWith(`${BACKUP_DIR}/`)) throw new Error('ENOSPC');
    return write(path, bytes);
  };
  await db.put('clienti', cliente('c1', 'Locale', T1));
  const bytes = remoteWith(() => {});
  await fs.write(SYNC_FILENAME, text(bytes));
  await assert.rejects(run(), BackupError);
  assert.equal(fromBytes(await fs.read(SYNC_FILENAME)), bytes);
  assert.equal(await fs.read(LOCK_FILE), null);
});

test('prepareRemote can fix up the file before the merge and the fix is written back', async () => {
  const { db, fs, run } = await setup();
  await fs.write(SYNC_FILENAME, text(remoteWith((s) => s.clienti.push({ id: 'c1', nome: 'Senza utente', updatedAt: T0, updatedBy: 'mcp-1' } as any))));
  const outcome = await run({
    prepareRemote: (s: SyncSnapshot) => ({ ...s, clienti: s.clienti.map((c) => ({ ...c, userId: c.userId || 'u1' })) }),
  });
  assert.equal(outcome.status, 'written');
  assert.equal((await db.get('clienti', 'c1')).userId, 'u1');
  assert.equal(JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!).clienti[0].userId, 'u1');
});

// --- F16, F17: lettura coerente e pubblicazione di ogni applicazione ---------

test('when the file changes while it is being read, the cycle rereads before merging', async () => {
  const { db, fs, run } = await setup();
  await fs.write(SYNC_FILENAME, text(remoteWith((s) => s.clienti.push(cliente('c1', 'Prima versione', T0, 'mcp-1') as any))));
  const read = fs.read.bind(fs);
  let swapped = false;
  fs.read = async (path) => {
    const bytes = await read(path);
    if (path === SYNC_FILENAME && !swapped) {
      // Un altro writer riscrive il file subito dopo che i byte sono stati letti.
      swapped = true;
      await fs.write(SYNC_FILENAME, text(remoteWith((s) => s.clienti.push(cliente('c1', 'Seconda versione', T1, 'mcp-1') as any))));
    }
    return bytes;
  };
  const outcome = await run();
  assert.equal(outcome.status, 'unchanged');
  assert.equal((await db.get('clienti', 'c1')).nome, 'Seconda versione');
  assert.equal(JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!).clienti[0].nome, 'Seconda versione');
});

test('onApplied is called for every merge committed to IndexedDB, even when the write then fails', async () => {
  const { db, source, run } = await setup();
  const fs = source.fs as MemoryFileSystem;
  await db.put('clienti', cliente('c1', 'Locale', T1));
  await fs.write(SYNC_FILENAME, text(remoteWith((s) => s.clienti.push(cliente('c2', 'Dal file', T0, 'mcp-1') as any))));
  const write = fs.write.bind(fs);
  fs.write = async (path, bytes) => {
    if (path.startsWith(`${BACKUP_DIR}/`)) throw new Error('ENOSPC');
    return write(path, bytes);
  };
  const seen: string[][] = [];
  await assert.rejects(run({ onApplied: async (applied: any) => { seen.push(applied.clienti.upserted); } }), BackupError);
  assert.deepEqual(seen, [['c2']], 'il record importato viene pubblicato anche se poi il backup fallisce');
});
