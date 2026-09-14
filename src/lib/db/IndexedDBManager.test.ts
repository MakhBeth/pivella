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

test('exportSnapshot builds the local v2 snapshot from every store plus the local tombstones', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.put('clienti', cliente('c1', 'Locale', { updatedAt: T0, updatedBy: 'app-a' }));
  await db.put('fatture', { id: 'f1', userId: 'u1', updatedAt: T0, updatedBy: 'app-a' });
  await db.delete('fatture', 'f1');
  const meta = await openSyncMetaDb(factory);
  await meta.setMeta('lastRestoreAck', T1);
  meta.close();

  const snapshot = await db.exportSnapshot();
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.updatedAt, NOW);
  assert.deepEqual(snapshot.writer, { id: db.writerId, kind: 'app' });
  assert.deepEqual(snapshot.clienti.map((c) => c.id), ['c1']);
  assert.deepEqual(snapshot.fatture, []);
  assert.deepEqual(snapshot.tombstones.map((t) => `${t.store}/${t.id}`), ['fatture/f1']);
  assert.deepEqual(snapshot.proposals, []);
  assert.equal(snapshot.restoredAt, T1);
  assert.equal(snapshot.restoredFrom, null);
  for (const store of STORES) assert.ok(Array.isArray(snapshot[store]));
});

test('restoreFromSnapshot replaces every store, clears local tombstones and acknowledges the restore', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.put('clienti', cliente('locale', 'Solo locale', { updatedAt: T0, updatedBy: 'app-a' }));
  await db.put('fatture', { id: 'f1', userId: 'u1', updatedAt: T0, updatedBy: 'app-a' });
  await db.delete('fatture', 'f1');

  const snapshot = createEmptySnapshot({ now: T1, writer: { id: 'restore-1', kind: 'restore' } });
  snapshot.clienti.push(cliente('dalBackup', 'Dal backup', { updatedAt: T0, updatedBy: 'app-a' }) as any);
  snapshot.restoredAt = T1;
  snapshot.restoredFrom = 'pivella-sync.2026-09-02T00-00-00-000Z.app.json';
  await db.restoreFromSnapshot(snapshot);

  assert.deepEqual((await db.getAll('clienti')).map((c) => c.id), ['dalBackup']);
  assert.deepEqual(await db.getAll('fatture'), []);
  assert.equal(await db.getLastRestoreAck(), T1);
  const meta = await openSyncMetaDb(factory);
  assert.deepEqual(await meta.getTombstones(), []);
  meta.close();
  const exported = await db.exportSnapshot();
  assert.equal(exported.restoredAt, T1);
  assert.equal(exported.restoredFrom, snapshot.restoredFrom, 'a parità di restoredAt il merge confronta restoredFrom: va ricordato');
});

test('getSyncStatus reports conflicts and archived records after a merge', async () => {
  const { db } = manager();
  await db.init();
  assert.deepEqual(await db.getSyncStatus(), { conflicts: 0, archived: 0 });
  await db.put('clienti', cliente('c1', 'Locale', { updatedAt: T0, updatedBy: 'app-a' }));
  const local = createEmptySnapshot({ now: T0, writer: { id: 'app-a', kind: 'app' } });
  local.clienti.push(cliente('c1', 'Locale', { updatedAt: T0, updatedBy: 'app-a' }) as any);
  const remote = createEmptySnapshot({ now: T1, writer: { id: 'mcp-1', kind: 'mcp' } });
  remote.clienti.push(cliente('c1', 'Remoto', { updatedAt: T1, updatedBy: 'mcp-1' }) as any);
  await db.mergeIntoDb(mergeAgainstLocal(local, remote));
  assert.deepEqual(await db.getSyncStatus(), { conflicts: 1, archived: 1 });
});

// --- F15: mutazioni locali tra exportSnapshot e mergeIntoDb ------------------

test('mergeIntoDb skips a record edited locally after the snapshot was taken and reports what it applied', async () => {
  const { db } = manager();
  await db.init();
  await db.put('clienti', cliente('c1', 'Locale', { updatedAt: T0, updatedBy: 'app-a' }));
  await db.put('clienti', cliente('c2', 'Altro', { updatedAt: T0, updatedBy: 'app-a' }));
  const local = await db.exportSnapshot();
  const remote = createEmptySnapshot({ now: T1, writer: { id: 'mcp-1', kind: 'mcp' } });
  remote.clienti.push(cliente('c1', 'Dal file', { updatedAt: T1, updatedBy: 'mcp-1' }) as any, cliente('c2', 'Altro dal file', { updatedAt: T1, updatedBy: 'mcp-1' }) as any);
  const result = mergeAgainstLocal(local, remote);
  // L'utente modifica c1 dopo lo snapshot e prima dell'applicazione.
  await db.put('clienti', cliente('c1', 'Modifica in corsa', { updatedAt: NOW, updatedBy: 'app-a' }));

  const applied = await db.mergeIntoDb(result, local);
  assert.equal((await db.get('clienti', 'c1')).nome, 'Modifica in corsa', 'la modifica in corsa non viene sovrascritta');
  assert.equal((await db.get('clienti', 'c2')).nome, 'Altro dal file');
  assert.deepEqual(applied.clienti, { upserted: ['c2'], deleted: [] });
});

test('mergeIntoDb keeps a tombstone written locally after the snapshot was taken', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.put('fatture', { id: 'f1', userId: 'u1', updatedAt: T0, updatedBy: 'app-a' });
  const local = await db.exportSnapshot();
  const remote = createEmptySnapshot({ now: T1, writer: { id: 'mcp-1', kind: 'mcp' } });
  remote.fatture.push({ id: 'f1', userId: 'u1', updatedAt: T0, updatedBy: 'app-a' } as any);
  const result = mergeAgainstLocal(local, remote);
  assert.equal(result.snapshot.tombstones.length, 0);
  // L'utente cancella f1 nel frattempo: tombstone scritto, record rimosso.
  await db.delete('fatture', 'f1');

  await db.mergeIntoDb(result, local);
  const meta = await openSyncMetaDb(factory);
  const tombstones = await meta.getTombstones();
  meta.close();
  assert.deepEqual(tombstones.map((t) => t.id), ['f1'], 'il tombstone nuovo sopravvive al merge basato sullo snapshot vecchio');
  assert.equal(await db.get('fatture', 'f1'), undefined);
});

test('mergeIntoDb drops a local tombstone only when the merge dropped it and it is unchanged', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.put('fatture', { id: 'f1', userId: 'u1', updatedAt: T0, updatedBy: 'app-a' });
  await db.delete('fatture', 'f1');
  const local = await db.exportSnapshot();
  assert.equal(local.tombstones.length, 1);
  // Il file ha ricreato f1 dopo la cancellazione: il tombstone decade.
  const remote = createEmptySnapshot({ now: NOW, writer: { id: 'mcp-1', kind: 'mcp' } });
  remote.fatture.push({ id: 'f1', userId: 'u1', updatedAt: '2026-09-11T00:00:00.000Z', updatedBy: 'mcp-1' } as any);
  const result = mergeAgainstLocal(local, remote);
  assert.equal(result.snapshot.tombstones.length, 0);
  await db.mergeIntoDb(result, local);
  const meta = await openSyncMetaDb(factory);
  assert.deepEqual(await meta.getTombstones(), []);
  meta.close();
  assert.equal((await db.get('fatture', 'f1')).updatedBy, 'mcp-1');
});

test('mergeIntoDb does not resurrect a record created and deleted locally after the snapshot', async () => {
  const { db } = manager();
  await db.init();
  const local = await db.exportSnapshot();
  const remote = createEmptySnapshot({ now: T1, writer: { id: 'mcp-1', kind: 'mcp' } });
  remote.clienti.push(cliente('c1', 'Dal file', { updatedAt: T0, updatedBy: 'mcp-1' }) as any);
  const result = mergeAgainstLocal(local, remote);
  // Nel frattempo l'utente crea e cancella c1: resta il tombstone, più recente del record nel file.
  await db.put('clienti', cliente('c1', 'Creato e cancellato', { updatedAt: T1, updatedBy: 'app-a' }));
  await db.delete('clienti', 'c1');
  const applied = await db.mergeIntoDb(result, local);
  assert.equal(await db.get('clienti', 'c1'), undefined);
  assert.deepEqual(applied.clienti.upserted, []);
});

test('restoreFromSnapshot archives every local record that the restore drops or changes', async () => {
  const { factory, db } = manager();
  await db.init();
  await db.put('clienti', cliente('solo-locale', 'Mai nel file', { updatedAt: NOW, updatedBy: 'app-a' }));
  await db.put('clienti', cliente('comune', 'Versione locale', { updatedAt: NOW, updatedBy: 'app-a' }));
  await db.put('clienti', cliente('uguale', 'Identico', { updatedAt: T0, updatedBy: 'app-a' }));
  const snapshot = createEmptySnapshot({ now: T1, writer: { id: 'restore-1', kind: 'restore' } });
  snapshot.clienti.push(cliente('comune', 'Versione del backup', { updatedAt: T0, updatedBy: 'app-a' }) as any, cliente('uguale', 'Identico', { updatedAt: T0, updatedBy: 'app-a' }) as any);
  snapshot.restoredAt = T1;
  await db.restoreFromSnapshot(snapshot);
  const meta = await openSyncMetaDb(factory);
  const archive = await meta.getArchive();
  meta.close();
  assert.deepEqual(archive.map((a) => a.id).sort(), ['comune', 'solo-locale']);
  assert.ok(archive.every((a) => a.reason === 'restore'));
  assert.deepEqual((await db.getAll('clienti')).map((c) => c.id).sort(), ['comune', 'uguale']);
});
