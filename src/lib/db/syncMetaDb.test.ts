import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { SYNC_META_DB_NAME, SYNC_META_DB_VERSION, openSyncMetaDb } from './syncMetaDb';
import type { Tombstone } from '../sync/schema';
import type { Conflict } from '../sync/merge';

// Ogni test apre un IDBFactory finto e vuoto: nessun database reale viene toccato.
function freshFactory(): IDBFactory {
  return new IDBFactory();
}

const t = (store: Tombstone['store'], id: string, deletedAt: string): Tombstone => ({ store, id, deletedAt, deletedBy: 'app-test' });

test('opens PivellaSyncMeta version 1 with tombstones and meta stores', async () => {
  const factory = freshFactory();
  const db = await openSyncMetaDb(factory);
  assert.equal(db.raw.name, SYNC_META_DB_NAME);
  assert.equal(db.raw.version, SYNC_META_DB_VERSION);
  assert.deepEqual([...db.raw.objectStoreNames].sort(), ['archive', 'meta', 'tombstones']);
  db.close();
});

test('never touches ForfettarioDB', async () => {
  const factory = freshFactory();
  const db = await openSyncMetaDb(factory);
  db.close();
  const names = (await factory.databases()).map((d) => d.name);
  assert.deepEqual(names, [SYNC_META_DB_NAME]);
});

test('addTombstone stores by composite key and getTombstones returns all', async () => {
  const db = await openSyncMetaDb(freshFactory());
  await db.addTombstone(t('fatture', 'f1', '2026-09-01T00:00:00.000Z'));
  await db.addTombstone(t('workLogs', 'f1', '2026-09-02T00:00:00.000Z'));
  const all = await db.getTombstones();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((x) => `${x.store}/${x.id}`).sort(), ['fatture/f1', 'workLogs/f1']);
  db.close();
});

test('addTombstone keeps the later deletedAt when the same key is written twice', async () => {
  const db = await openSyncMetaDb(freshFactory());
  await db.addTombstone(t('clienti', 'c1', '2026-09-05T00:00:00.000Z'));
  await db.addTombstone(t('clienti', 'c1', '2026-09-01T00:00:00.000Z'));
  const all = await db.getTombstones();
  assert.equal(all.length, 1);
  assert.equal(all[0].deletedAt, '2026-09-05T00:00:00.000Z');
  db.close();
});

test('replaceTombstones makes the store equal to the given list', async () => {
  const db = await openSyncMetaDb(freshFactory());
  await db.addTombstone(t('clienti', 'old', '2026-01-01T00:00:00.000Z'));
  await db.replaceTombstones([t('fatture', 'a', '2026-09-01T00:00:00.000Z'), t('fatture', 'b', '2026-09-02T00:00:00.000Z')]);
  const all = await db.getTombstones();
  assert.deepEqual(all.map((x) => x.id).sort(), ['a', 'b']);
  db.close();
});

test('removeTombstones deletes only the given keys', async () => {
  const db = await openSyncMetaDb(freshFactory());
  await db.addTombstone(t('fatture', 'a', '2026-09-01T00:00:00.000Z'));
  await db.addTombstone(t('fatture', 'b', '2026-09-01T00:00:00.000Z'));
  await db.removeTombstones([{ store: 'fatture', id: 'a' }, { store: 'fatture', id: 'missing' }]);
  assert.deepEqual((await db.getTombstones()).map((x) => x.id), ['b']);
  db.close();
});

test('getMeta returns undefined for unknown keys and round-trips values', async () => {
  const db = await openSyncMetaDb(freshFactory());
  assert.equal(await db.getMeta('lastRestoreAck'), undefined);
  await db.setMeta('lastRestoreAck', '2026-09-12T00:00:00.000Z');
  assert.equal(await db.getMeta('lastRestoreAck'), '2026-09-12T00:00:00.000Z');
  db.close();
});

test('getWriterId creates a stable app writer id once and returns the same afterwards', async () => {
  const factory = freshFactory();
  const db = await openSyncMetaDb(factory);
  const first = await db.getWriterId();
  assert.match(first, /^app-[0-9a-f]{8}$/);
  assert.equal(await db.getWriterId(), first);
  db.close();
  const reopened = await openSyncMetaDb(factory);
  assert.equal(await reopened.getWriterId(), first);
  reopened.close();
});

test('appendConflicts keeps the most recent 200 entries', async () => {
  const db = await openSyncMetaDb(freshFactory());
  const conflict = (i: number): Conflict => ({
    store: 'clienti', id: `c${i}`, reason: 'newer',
    kept: { updatedAt: 'b', updatedBy: 'x' }, dropped: { updatedAt: 'a', updatedBy: 'y' },
    droppedRecord: { id: `c${i}`, userId: 'u', nome: 'perdente' },
  });
  await db.appendConflicts(Array.from({ length: 150 }, (_, i) => conflict(i)));
  await db.appendConflicts(Array.from({ length: 100 }, (_, i) => conflict(1000 + i)));
  const log = await db.getConflicts();
  assert.equal(log.length, 200);
  assert.equal(log[0].id, 'c50');
  assert.equal(log[199].id, 'c1099');
  db.close();
});

test('appendConflicts with an empty list does nothing', async () => {
  const db = await openSyncMetaDb(freshFactory());
  await db.appendConflicts([]);
  assert.deepEqual(await db.getConflicts(), []);
  db.close();
});

test('data survives close and reopen', async () => {
  const factory = freshFactory();
  const db = await openSyncMetaDb(factory);
  await db.addTombstone(t('scadenze', 's1', '2026-09-01T00:00:00.000Z'));
  db.close();
  const again = await openSyncMetaDb(factory);
  assert.equal((await again.getTombstones()).length, 1);
  again.close();
});

// --- F10: writer id atomico ---------------------------------------------------

test('concurrent getWriterId calls on a fresh database all return the same persisted id', async () => {
  const factory = freshFactory();
  const db = await openSyncMetaDb(factory);
  const ids = await Promise.all([db.getWriterId(), db.getWriterId(), db.getWriterId()]);
  assert.equal(new Set(ids).size, 1);
  assert.equal(await db.getMeta('writerId'), ids[0]);
  db.close();
});

test('concurrent getWriterId calls from two connections agree', async () => {
  const factory = freshFactory();
  const [a, b] = await Promise.all([openSyncMetaDb(factory), openSyncMetaDb(factory)]);
  const [ia, ib] = await Promise.all([a.getWriterId(), b.getWriterId()]);
  assert.equal(ia, ib);
  a.close(); b.close();
});

// --- F6, F8: addTombstone confronta istanti e usa il tiebreak ----------------

test('addTombstone compares deletedAt as instants', async () => {
  const db = await openSyncMetaDb(freshFactory());
  await db.addTombstone(t('clienti', 'c1', '2026-09-05T00:00:00.500Z'));
  await db.addTombstone(t('clienti', 'c1', '2026-09-05T00:00:00Z'));
  assert.equal((await db.getTombstones())[0].deletedAt, '2026-09-05T00:00:00.500Z');
  db.close();
});

test('addTombstone on equal deletedAt keeps the smaller deletedBy regardless of order', async () => {
  for (const order of [['mcp-1', 'app-1'], ['app-1', 'mcp-1']]) {
    const db = await openSyncMetaDb(freshFactory());
    for (const by of order) await db.addTombstone({ store: 'clienti', id: 'c1', deletedAt: '2026-09-05T00:00:00.000Z', deletedBy: by });
    assert.equal((await db.getTombstones())[0].deletedBy, 'app-1');
    db.close();
  }
});

// --- F12: ogni record perdente viene archiviato per intero, senza limite -----

test('appendConflicts archives every dropped record even beyond the bounded log', async () => {
  const db = await openSyncMetaDb(freshFactory());
  const conflict = (i: number): Conflict => ({
    store: 'fatture', id: `f${i}`, reason: 'newer',
    kept: { updatedAt: 'b', updatedBy: 'x' }, dropped: { updatedAt: 'a', updatedBy: 'y' },
    droppedRecord: { id: `f${i}`, userId: 'u', clienteId: 'c', clienteNome: 'C', data: '2026-09-01', importo: i },
  });
  await db.appendConflicts(Array.from({ length: 201 }, (_, i) => conflict(i)));
  assert.equal((await db.getConflicts()).length, 200, 'display log stays bounded');
  const archive = await db.getArchive();
  assert.equal(archive.length, 201, 'every losing payload is archived');
  assert.equal(archive.some((a) => a.store === 'fatture' && a.id === 'f0' && (a.record as { importo: number }).importo === 0), true);
  db.close();
});

test('archive entries carry store, id, archivedAt and the full record', async () => {
  const db = await openSyncMetaDb(freshFactory());
  await db.appendConflicts([{
    store: 'clienti', id: 'c1', reason: 'tiebreak',
    kept: { updatedAt: 'b', updatedBy: 'x' }, dropped: { updatedAt: 'a', updatedBy: 'y' },
    droppedRecord: { id: 'c1', userId: 'u', nome: 'Perso' },
  }], '2026-09-13T00:00:00.000Z');
  const [entry] = await db.getArchive();
  assert.equal(entry.store, 'clienti');
  assert.equal(entry.id, 'c1');
  assert.equal(entry.archivedAt, '2026-09-13T00:00:00.000Z');
  assert.deepEqual(entry.record, { id: 'c1', userId: 'u', nome: 'Perso' });
  db.close();
});
