import test from 'node:test';
import assert from 'node:assert/strict';

import { applyStoreChanges } from './applyChanges';

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
