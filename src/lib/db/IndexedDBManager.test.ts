import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { IndexedDBManager } from './IndexedDBManager';
import { SYNC_META_DB_NAME, openSyncMetaDb } from './syncMetaDb';
import { DB_NAME, DB_VERSION, STORES } from '../constants/fiscali';
import { createEmptySnapshot, type Tombstone } from '../sync/schema';
import { mergeSnapshots, type MergeResult } from '../sync/merge';

// Il manager è rumoroso sulla console: qui non serve.
console.log = () => {};
console.warn = () => {};

const T0 = '2026-09-01T00:00:00.000Z';
const T1 = '2026-09-02T00:00:00.000Z';
const NOW = '2026-09-10T12:00:00.000Z';

// Ogni test usa un IDBFactory finto e vuoto: nessun database reale viene toccato.
function manager(now = NOW) {
  const factory = new IDBFactory();
  return { factory, db: new IndexedDBManager({ factory, now: () => now }) };
}

const cliente = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({ id, userId: 'u1', nome, ...extra });

test('init opens ForfettarioDB version 3 and PivellaSyncMeta, and exposes a writer id', async () => {
  const { factory, db } = manager();
  await db.init();
  assert.equal(db.db?.name, DB_NAME);
  assert.equal(db.db?.version, DB_VERSION);
  const names = (await factory.databases()).map((d) => d.name).sort();
  assert.deepEqual(names, [DB_NAME, SYNC_META_DB_NAME].sort());
  assert.match(db.writerId!, /^app-/);
});

test('init keeps the same writer id across restarts', async () => {
  const { factory, db } = manager();
  await db.init();
  const first = db.writerId;
  db.close();
  const again = new IndexedDBManager({ factory, now: () => NOW });
  await again.init();
  assert.equal(again.writerId, first);
});

test('put stamps updatedAt and updatedBy only when missing', async () => {
  const { db } = manager();
  await db.init();
  await db.put('clienti', cliente('c1', 'Nuovo'));
  await db.put('clienti', cliente('c2', 'Dal file', { updatedAt: T0, updatedBy: 'mcp-9' }));
  const c1 = await db.get('clienti', 'c1');
  const c2 = await db.get('clienti', 'c2');
  assert.equal(c1.updatedAt, NOW);
  assert.equal(c1.updatedBy, db.writerId);
  assert.equal(c2.updatedAt, T0);
  assert.equal(c2.updatedBy, 'mcp-9');
});

test('stamp always overwrites updatedAt and updatedBy', async () => {
  const { db } = manager();
  await db.init();
  const stamped = db.stamp(cliente('c1', 'Modificato', { updatedAt: T0, updatedBy: 'mcp-9' }));
  assert.equal(stamped.updatedAt, NOW);
  assert.equal(stamped.updatedBy, db.writerId);
  assert.equal(stamped.nome, 'Modificato');
});

test('delete writes the tombstone first, strictly after the record updatedAt, then removes the record', async () => {
  const { factory, db } = manager(T1);
  await db.init();
  await db.put('fatture', { id: 'f1', userId: 'u1', updatedAt: T1, updatedBy: 'app-x' });
  await db.delete('fatture', 'f1');
  assert.equal(await db.get('fatture', 'f1'), undefined);
  const meta = await openSyncMetaDb(factory);
  const tombstones = await meta.getTombstones();
  meta.close();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].store, 'fatture');
  assert.equal(tombstones[0].id, 'f1');
  assert.equal(tombstones[0].deletedBy, db.writerId);
  assert.ok(Date.parse(tombstones[0].deletedAt) > Date.parse(T1), 'deletedAt deve superare updatedAt anche nello stesso millisecondo');
});

test('delete of a missing record still leaves a tombstone', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.delete('workLogs', 'ghost');
  const meta = await openSyncMetaDb(factory);
  const tombstones = await meta.getTombstones();
  meta.close();
  assert.deepEqual(tombstones.map((t) => t.id), ['ghost']);
});

test('reconciliation at init removes records whose tombstone is newer and keeps the others', async () => {
  const factory = new IDBFactory();
  const seed = new IndexedDBManager({ factory, now: () => NOW });
  await seed.init();
  await seed.put('clienti', cliente('vecchio', 'Cancellato altrove', { updatedAt: T0, updatedBy: 'app-a' }));
  await seed.put('clienti', cliente('ricreato', 'Modificato dopo', { updatedAt: NOW, updatedBy: 'app-a' }));
  await seed.put('clienti', cliente('senzaData', 'Mai timbrato', { updatedAt: undefined }));
  // Rimuove il timbro messo da put: simula un record precedente alla sync v2.
  const raw = await seed.get('clienti', 'senzaData');
  delete raw.updatedAt;
  delete raw.updatedBy;
  await new Promise<void>((resolve, reject) => {
    const tx = seed.db!.transaction('clienti', 'readwrite');
    tx.objectStore('clienti').put(raw);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  seed.close();

  const meta = await openSyncMetaDb(factory);
  const tomb = (id: string, deletedAt: string): Tombstone => ({ store: 'clienti', id, deletedAt, deletedBy: 'mcp-1' });
  await meta.addTombstone(tomb('vecchio', T1));
  await meta.addTombstone(tomb('ricreato', T1));
  await meta.addTombstone(tomb('senzaData', T1));
  meta.close();

  const db = new IndexedDBManager({ factory, now: () => NOW });
  await db.init();
  const rest = (await db.getAll('clienti')).map((c) => c.id).sort();
  assert.deepEqual(rest, ['ricreato']);
});

function mergeAgainstLocal(local: ReturnType<typeof createEmptySnapshot>, remote: ReturnType<typeof createEmptySnapshot>): MergeResult {
  return mergeSnapshots(local, remote, { now: NOW, writer: { id: 'app-test', kind: 'app' } });
}

test('mergeIntoDb archives losers, applies upserts and deletes across stores, and stores the merged tombstones', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.put('clienti', cliente('c1', 'Locale', { updatedAt: T0, updatedBy: 'app-a' }));
  await db.put('clienti', cliente('c2', 'Solo locale', { updatedAt: T0, updatedBy: 'app-a' }));
  await db.put('fatture', { id: 'f1', userId: 'u1', numero: '1', updatedAt: T0, updatedBy: 'app-a' });

  const local = createEmptySnapshot({ now: T0, writer: { id: 'app-a', kind: 'app' } });
  local.clienti.push(cliente('c1', 'Locale', { updatedAt: T0, updatedBy: 'app-a' }) as any, cliente('c2', 'Solo locale', { updatedAt: T0, updatedBy: 'app-a' }) as any);
  local.fatture.push({ id: 'f1', userId: 'u1', numero: '1', updatedAt: T0, updatedBy: 'app-a' } as any);
  const remote = createEmptySnapshot({ now: T1, writer: { id: 'mcp-1', kind: 'mcp' } });
  remote.clienti.push(cliente('c1', 'Remoto più nuovo', { updatedAt: T1, updatedBy: 'mcp-1' }) as any, cliente('c3', 'Nuovo dal file', { updatedAt: T1, updatedBy: 'mcp-1' }) as any);
  remote.tombstones.push({ store: 'fatture', id: 'f1', deletedAt: T1, deletedBy: 'mcp-1' });

  const result = mergeAgainstLocal(local, remote);
  assert.equal(result.conflicts.length, 1);
  await db.mergeIntoDb(result);

  const c1 = await db.get('clienti', 'c1');
  assert.equal(c1.nome, 'Remoto più nuovo');
  assert.equal(c1.updatedAt, T1, 'i record dal merge non vengono ritimbrati');
  assert.equal(c1.updatedBy, 'mcp-1');
  assert.equal((await db.get('clienti', 'c2')).nome, 'Solo locale');
  assert.equal((await db.get('clienti', 'c3')).nome, 'Nuovo dal file');
  assert.equal(await db.get('fatture', 'f1'), undefined);

  const meta = await openSyncMetaDb(factory);
  const archive = await meta.getArchive();
  const conflicts = await meta.getConflicts();
  const tombstones = await meta.getTombstones();
  meta.close();
  assert.equal(archive.length, 1);
  assert.deepEqual(archive[0].record, cliente('c1', 'Locale', { updatedAt: T0, updatedBy: 'app-a' }));
  assert.equal(conflicts.length, 1);
  assert.deepEqual(tombstones, result.snapshot.tombstones);
});

test('mergeIntoDb applies all stores in one transaction: a bad record leaves every store untouched', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.put('clienti', cliente('c1', 'Prima', { updatedAt: T0, updatedBy: 'app-a' }));

  const local = createEmptySnapshot({ now: T0, writer: { id: 'app-a', kind: 'app' } });
  local.clienti.push(cliente('c1', 'Prima', { updatedAt: T0, updatedBy: 'app-a' }) as any);
  const remote = createEmptySnapshot({ now: T1, writer: { id: 'mcp-1', kind: 'mcp' } });
  remote.clienti.push(cliente('c1', 'Dopo', { updatedAt: T1, updatedBy: 'mcp-1' }) as any);
  remote.workLogs.push({ id: 'w1', userId: 'u1', updatedAt: T1, updatedBy: 'mcp-1' } as any);
  const result = mergeAgainstLocal(local, remote);
  // Un record senza chiave nello store workLogs fa fallire la put dentro la transazione.
  (result.snapshot.workLogs[0] as any).id = undefined;

  await assert.rejects(db.mergeIntoDb(result));
  assert.equal((await db.get('clienti', 'c1')).nome, 'Prima');
  assert.deepEqual(await db.getAll('workLogs'), []);
  const meta = await openSyncMetaDb(factory);
  assert.equal((await meta.getArchive()).length, 1, 'l\'archivio dei perdenti è scritto prima e resta');
  meta.close();
});

test('mergeIntoDb with no changes touches nothing and does not fail', async () => {
  const { db } = manager();
  await db.init();
  const local = createEmptySnapshot({ now: T0, writer: { id: 'app-a', kind: 'app' } });
  const result = mergeAgainstLocal(local, local);
  await db.mergeIntoDb(result);
  for (const store of STORES) assert.deepEqual(await db.getAll(store), []);
});
