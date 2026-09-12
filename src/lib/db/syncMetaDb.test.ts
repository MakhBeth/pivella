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
  assert.deepEqual([...db.raw.objectStoreNames].sort(), ['meta', 'tombstones']);
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
