import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptySnapshot, snapshotsEquivalent, type Proposal, type SyncSnapshot, type Writer } from './schema';
import { mergeSnapshots, type MergeOptions } from './merge';

const T0 = '2026-09-01T00:00:00.000Z';
const T1 = '2026-09-02T00:00:00.000Z';
const T2 = '2026-09-03T00:00:00.000Z';
const NOW = '2026-09-12T10:00:00.000Z';
const APP: Writer = { id: 'app-1', kind: 'app' };
const MCP: Writer = { id: 'mcp-1', kind: 'mcp' };
const OPTS: MergeOptions = { now: NOW, writer: APP };

function snap(mutate?: (s: SyncSnapshot) => void): SyncSnapshot {
  const s = createEmptySnapshot({ now: T0, writer: APP });
  s.users.push({ id: 'u1', nome: 'Utente', createdAt: T0, updatedAt: T0, updatedBy: 'app-1' });
  mutate?.(s);
  return s;
}

const cliente = (id: string, nome: string, updatedAt: string, updatedBy = 'app-1') => ({
  id, userId: 'u1', nome, updatedAt, updatedBy,
});

function merged(a: SyncSnapshot, b: SyncSnapshot) {
  return mergeSnapshots(a, b, OPTS);
}

// --- proprietà algebriche ---------------------------------------------------

test('merge is commutative on data', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1), cliente('c2', 'B', T0)); });
  const b = snap((s) => { s.clienti.push(cliente('c1', 'A2', T2), cliente('c3', 'C', T1)); s.tombstones.push({ store: 'clienti', id: 'c2', deletedAt: T2, deletedBy: 'mcp-1' }); });
  assert.equal(snapshotsEquivalent(merged(a, b).snapshot, merged(b, a).snapshot), true);
});

test('merge is idempotent: merging the result with either input changes nothing', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  const b = snap((s) => { s.clienti.push(cliente('c1', 'A2', T2)); });
  const m = merged(a, b).snapshot;
  assert.equal(snapshotsEquivalent(merged(m, a).snapshot, m), true);
  assert.equal(snapshotsEquivalent(merged(m, b).snapshot, m), true);
  assert.equal(snapshotsEquivalent(merged(m, m).snapshot, m), true);
});

test('merge of a snapshot with itself reports no changes and no conflicts', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  const r = merged(a, a);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.hasChanges, false);
});

// --- tabella dei casi -------------------------------------------------------

test('record only in A without tombstone in B stays', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  const r = merged(a, snap());
  assert.equal(r.snapshot.clienti.length, 1);
  assert.equal(r.hasChanges, false);
});

test('record only in A with newer tombstone in B is deleted and the tombstone kept', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  const b = snap((s) => { s.tombstones.push({ store: 'clienti', id: 'c1', deletedAt: T2, deletedBy: 'mcp-1' }); });
  const r = merged(a, b);
  assert.equal(r.snapshot.clienti.length, 0);
  assert.equal(r.snapshot.tombstones.length, 1);
  assert.deepEqual(r.changes.clienti.deleted, ['c1']);
});

test('record only in A with older tombstone in B survives and the tombstone is dropped', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T2)); });
  const b = snap((s) => { s.tombstones.push({ store: 'clienti', id: 'c1', deletedAt: T1, deletedBy: 'mcp-1' }); });
  const r = merged(a, b);
  assert.equal(r.snapshot.clienti.length, 1);
  assert.equal(r.snapshot.tombstones.length, 0);
});

test('tombstone with deletedAt equal to updatedAt does not delete', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  const b = snap((s) => { s.tombstones.push({ store: 'clienti', id: 'c1', deletedAt: T1, deletedBy: 'mcp-1' }); });
  assert.equal(merged(a, b).snapshot.clienti.length, 1);
});

test('record without updatedAt loses against any tombstone', () => {
  const a = snap((s) => { s.clienti.push({ id: 'c1', userId: 'u1', nome: 'Legacy' }); });
  const b = snap((s) => { s.tombstones.push({ store: 'clienti', id: 'c1', deletedAt: T0, deletedBy: 'mcp-1' }); });
  assert.equal(merged(a, b).snapshot.clienti.length, 0);
});

test('same id with identical content stays and is not a conflict', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  const b = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  const r = merged(a, b);
  assert.equal(r.snapshot.clienti.length, 1);
  assert.deepEqual(r.conflicts, []);
});

test('same id with different updatedAt: the newer wins whole and the loser is logged', () => {
  const a = snap((s) => { s.clienti.push({ ...cliente('c1', 'Vecchio', T1), piva: '111' }); });
  const b = snap((s) => { s.clienti.push({ ...cliente('c1', 'Nuovo', T2, 'mcp-1'), email: 'x@y' }); });
  const r = merged(a, b);
  assert.equal(r.snapshot.clienti.length, 1);
  assert.deepEqual(r.snapshot.clienti[0], { ...cliente('c1', 'Nuovo', T2, 'mcp-1'), email: 'x@y' });
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0], {
    store: 'clienti', id: 'c1', reason: 'newer',
    kept: { updatedAt: T2, updatedBy: 'mcp-1' },
    dropped: { updatedAt: T1, updatedBy: 'app-1' },
  });
  assert.deepEqual(r.changes.clienti.upserted, ['c1']);
});

test('same id, same updatedAt, different content: deterministic tiebreak on updatedBy, logged', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'Da app', T1, 'app-1')); });
  const b = snap((s) => { s.clienti.push(cliente('c1', 'Da mcp', T1, 'mcp-1')); });
  const r1 = merged(a, b);
  const r2 = merged(b, a);
  assert.equal(r1.snapshot.clienti[0].nome, 'Da app');
  assert.equal(r2.snapshot.clienti[0].nome, 'Da app');
  assert.equal(r1.conflicts[0].reason, 'tiebreak');
});

test('same id, same updatedAt, same updatedBy, different content: tiebreak on canonical JSON', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'B', T1)); });
  const b = snap((s) => { s.clienti.push(cliente('c1', 'A', T1)); });
  assert.equal(merged(a, b).snapshot.clienti[0].nome, 'A');
  assert.equal(merged(b, a).snapshot.clienti[0].nome, 'A');
});

test('tombstone on both sides keeps the later deletedAt', () => {
  const a = snap((s) => { s.tombstones.push({ store: 'fatture', id: 'f1', deletedAt: T1, deletedBy: 'app-1' }); });
  const b = snap((s) => { s.tombstones.push({ store: 'fatture', id: 'f1', deletedAt: T2, deletedBy: 'mcp-1' }); });
  const r = merged(a, b);
  assert.equal(r.snapshot.tombstones.length, 1);
  assert.equal(r.snapshot.tombstones[0].deletedAt, T2);
});

test('config is merged as a whole record: concurrent partial edits do not combine', () => {
  const base = { id: 'config_u1', userId: 'u1', coefficiente: 78, aliquota: 15, ateco: [], aliquotaOverride: null, annoApertura: 2020, codiciAteco: [], gestionePrevidenziale: 'gestione_separata' as const, contributiInpsFissi: null, riduzioneContributiva: false };
  const a = snap((s) => { s.config.push({ ...base, iban: 'IT-A', updatedAt: T1, updatedBy: 'app-1' }); });
  const b = snap((s) => { s.config.push({ ...base, nomeAttivita: 'Studio', updatedAt: T2, updatedBy: 'mcp-1' }); });
  const r = merged(a, b);
  assert.equal(r.snapshot.config[0].nomeAttivita, 'Studio');
  assert.equal(r.snapshot.config[0].iban, undefined);
  assert.equal(r.conflicts.length, 1);
});

test('user deleted on one side and modified later on the other survives', () => {
  const a = snap((s) => { s.users[0] = { ...s.users[0], nome: 'Rinominato', updatedAt: T2 }; });
  const b = snap((s) => { s.users = []; s.tombstones.push({ store: 'users', id: 'u1', deletedAt: T1, deletedBy: 'app-1' }); });
  const r = merged(a, b);
  assert.equal(r.snapshot.users.length, 1);
  assert.equal(r.snapshot.users[0].nome, 'Rinominato');
});

test('orphan records (userId without profile) stay and are counted, never deleted', () => {
  const a = snap((s) => { s.clienti.push({ id: 'c9', userId: 'ghost', nome: 'Orfano', updatedAt: T1, updatedBy: 'app-1' }); });
  const r = merged(a, snap());
  assert.equal(r.snapshot.clienti.length, 1);
  assert.deepEqual(r.orphans, [{ store: 'clienti', id: 'c9', userId: 'ghost' }]);
});

// --- potatura ---------------------------------------------------------------

test('tombstones older than 90 days are pruned, younger ones kept', () => {
  const old = '2026-06-01T00:00:00.000Z'; // 103 giorni prima di NOW
  const young = '2026-07-01T00:00:00.000Z'; // 73 giorni
  const a = snap((s) => {
    s.tombstones.push(
      { store: 'workLogs', id: 'w1', deletedAt: old, deletedBy: 'app-1' },
      { store: 'workLogs', id: 'w2', deletedAt: young, deletedBy: 'app-1' },
    );
  });
  const r = merged(a, snap());
  assert.deepEqual(r.snapshot.tombstones.map((t) => t.id), ['w2']);
});

// --- proposte ---------------------------------------------------------------

function proposal(overrides: Partial<Proposal>): Proposal {
  return {
    id: 'prop_1', userId: 'u1', kind: 'workLog', payload: {}, status: 'pending',
    createdAt: T0, updatedAt: T0, expiresAt: '2026-09-15T00:00:00.000Z',
    createdBy: { writerId: 'mcp-1' }, result: null, rejectReason: null,
    ...overrides,
  };
}

test('proposal only on one side stays', () => {
  const b = snap((s) => { s.proposals.push(proposal({})); });
  assert.equal(merged(snap(), b).snapshot.proposals.length, 1);
});

test('proposal with same status on both sides: newer updatedAt wins', () => {
  const a = snap((s) => { s.proposals.push(proposal({ motivazione: 'prima', updatedAt: T1 })); });
  const b = snap((s) => { s.proposals.push(proposal({ motivazione: 'dopo', updatedAt: T2 })); });
  assert.equal(merged(a, b).snapshot.proposals[0].motivazione, 'dopo');
});

test('pending on one side and terminal on the other: terminal wins even if older', () => {
  const a = snap((s) => { s.proposals.push(proposal({ status: 'pending', updatedAt: T2 })); });
  const b = snap((s) => { s.proposals.push(proposal({ status: 'rejected', rejectReason: 'no', updatedAt: T1 })); });
  assert.equal(merged(a, b).snapshot.proposals[0].status, 'rejected');
  assert.equal(merged(b, a).snapshot.proposals[0].status, 'rejected');
});

test('two different terminal states: applied wins over any other', () => {
  const a = snap((s) => { s.proposals.push(proposal({ status: 'withdrawn', updatedAt: T2 })); });
  const b = snap((s) => { s.proposals.push(proposal({ status: 'applied', result: { recordId: 'w9' }, updatedAt: T1 })); });
  assert.equal(merged(a, b).snapshot.proposals[0].status, 'applied');
  assert.equal(merged(b, a).snapshot.proposals[0].status, 'applied');
});

test('two different terminal states without applied: newer updatedAt wins', () => {
  const a = snap((s) => { s.proposals.push(proposal({ status: 'withdrawn', updatedAt: T2 })); });
  const b = snap((s) => { s.proposals.push(proposal({ status: 'rejected', updatedAt: T1 })); });
  assert.equal(merged(a, b).snapshot.proposals[0].status, 'withdrawn');
});

test('pending proposal past expiresAt becomes expired at merge time', () => {
  const a = snap((s) => { s.proposals.push(proposal({ expiresAt: '2026-09-10T00:00:00.000Z' })); });
  const r = merged(a, snap());
  assert.equal(r.snapshot.proposals[0].status, 'expired');
  assert.equal(r.snapshot.proposals[0].updatedAt, NOW);
});

test('terminal proposals older than 30 days are removed', () => {
  const a = snap((s) => {
    s.proposals.push(
      proposal({ id: 'p_old', status: 'applied', result: { recordId: 'x' }, updatedAt: '2026-08-01T00:00:00.000Z' }),
      proposal({ id: 'p_recent', status: 'applied', result: { recordId: 'y' }, updatedAt: '2026-09-01T00:00:00.000Z' }),
      proposal({ id: 'p_pending_old', status: 'pending', updatedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z' }),
    );
  });
  const ids = merged(a, snap()).snapshot.proposals.map((p) => p.id).sort();
  assert.deepEqual(ids, ['p_pending_old', 'p_recent']);
});

// --- busta ------------------------------------------------------------------

test('envelope takes now and writer from options and the greater restoredAt', () => {
  const a = snap((s) => { s.restoredAt = T1; s.restoredFrom = 'old.json'; });
  const b = snap((s) => { s.restoredAt = T2; s.restoredFrom = 'new.json'; });
  const r = mergeSnapshots(a, b, { now: NOW, writer: MCP });
  assert.equal(r.snapshot.updatedAt, NOW);
  assert.deepEqual(r.snapshot.writer, MCP);
  assert.equal(r.snapshot.restoredAt, T2);
  assert.equal(r.snapshot.restoredFrom, 'new.json');
});

test('changes describe the diff relative to A: upserted and deleted per store', () => {
  const a = snap((s) => { s.clienti.push(cliente('c1', 'A', T1), cliente('c2', 'B', T1)); });
  const b = snap((s) => {
    s.clienti.push(cliente('c1', 'A', T1), cliente('c3', 'C', T1));
    s.tombstones.push({ store: 'clienti', id: 'c2', deletedAt: T2, deletedBy: 'mcp-1' });
  });
  const r = merged(a, b);
  assert.deepEqual(r.changes.clienti, { upserted: ['c3'], deleted: ['c2'] });
  assert.deepEqual(r.changes.users, { upserted: [], deleted: [] });
  assert.equal(r.hasChanges, true);
});
