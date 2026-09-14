import test from 'node:test';
import assert from 'node:assert/strict';

import { applyStoreChanges, tombstonesFor } from './applyChanges';

type Rec = { id: string; userId?: string; nome: string };
const r = (id: string, nome: string, userId = 'u1'): Rec => ({ id, userId, nome });

test('upserts replace existing records in place and append new ones', () => {
  const prev = [r('a', 'A'), r('b', 'B')];
  const next = applyStoreChanges(prev, { upserted: ['b', 'c'], deleted: [] }, [r('a', 'A'), r('b', 'B2'), r('c', 'C')], 'u1');
  assert.deepEqual(next.map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(next[1].nome, 'B2');
});

test('deletes remove records and leave the rest untouched', () => {
  const prev = [r('a', 'A'), r('b', 'B')];
  const next = applyStoreChanges(prev, { upserted: [], deleted: ['a'] }, [r('b', 'B')], 'u1');
  assert.deepEqual(next, [r('b', 'B')]);
});

test('upserted records of another user are dropped from state, not added', () => {
  const prev = [r('a', 'A'), r('x', 'X')];
  const next = applyStoreChanges(prev, { upserted: ['x', 'y'], deleted: [] }, [r('a', 'A'), r('x', 'X', 'u2'), r('y', 'Y', 'u2')], 'u1');
  assert.deepEqual(next.map((x) => x.id), ['a']);
});

test('without a user filter every record is kept, as for the users store', () => {
  const prev = [r('a', 'A')];
  const next = applyStoreChanges(prev, { upserted: ['b'], deleted: [] }, [r('a', 'A'), r('b', 'B', 'u2')]);
  assert.deepEqual(next.map((x) => x.id), ['a', 'b']);
});

test('no changes returns the same array instance so React does not rerender', () => {
  const prev = [r('a', 'A')];
  assert.equal(applyStoreChanges(prev, { upserted: [], deleted: [] }, prev, 'u1'), prev);
});

test('an upserted id missing from the snapshot is ignored', () => {
  const prev = [r('a', 'A')];
  const next = applyStoreChanges(prev, { upserted: ['ghost'], deleted: [] }, [r('a', 'A')], 'u1');
  assert.deepEqual(next.map((x) => x.id), ['a']);
});

// --- F18: modifiche locali arrivate dopo il merge ----------------------------

const stamped = (id: string, nome: string, updatedAt: string, userId = 'u1') => ({ id, userId, nome, updatedAt });

test('an upsert does not overwrite a record the user edited after the merge', () => {
  const prev = [stamped('a', 'Modifica più nuova', '2026-09-14T10:00:05.000Z')];
  const merged = [stamped('a', 'Dal merge', '2026-09-14T10:00:00.000Z')];
  const next = applyStoreChanges(prev, { upserted: ['a'], deleted: [] }, merged, 'u1');
  assert.equal(next[0].nome, 'Modifica più nuova');
});

test('a delete is skipped when the record was edited after the tombstone', () => {
  const prev = [stamped('a', 'Ricreato', '2026-09-14T10:00:05.000Z')];
  const tombstones = [{ store: 'clienti' as const, id: 'a', deletedAt: '2026-09-14T10:00:00.000Z', deletedBy: 'mcp-1' }];
  const next = applyStoreChanges(prev, { upserted: [], deleted: ['a'] }, [], 'u1', tombstones);
  assert.equal(next.length, 1);
  const older = [stamped('a', 'Vecchio', '2026-09-14T09:00:00.000Z')];
  assert.equal(applyStoreChanges(older, { upserted: [], deleted: ['a'] }, [], 'u1', tombstones).length, 0);
});

test('tombstonesFor keeps only the tombstones of one store, so an id reused in another store does not shadow it', () => {
  const tombstones = [
    { store: 'fatture' as const, id: 'x', deletedAt: '2026-09-14T09:00:00.000Z', deletedBy: 'mcp-1' },
    { store: 'clienti' as const, id: 'x', deletedAt: '2026-09-14T10:00:00.000Z', deletedBy: 'mcp-1' },
  ];
  const prev = [stamped('x', 'Cliente', '2026-09-14T09:30:00.000Z')];
  assert.equal(applyStoreChanges(prev, { upserted: [], deleted: ['x'] }, [], 'u1', tombstonesFor('clienti', tombstones)).length, 0);
  assert.equal(applyStoreChanges(prev, { upserted: [], deleted: ['x'] }, [], 'u1', tombstonesFor('fatture', tombstones)).length, 1);
});
