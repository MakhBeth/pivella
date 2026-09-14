import test from 'node:test';
import assert from 'node:assert/strict';

import { createProposal, isPending, PROPOSAL_EXPIRY_DAYS, ProposalNotPendingError, withdrawProposal, withExpiry } from './proposals';
import type { Proposal } from './schema';

const NOW = '2026-09-14T10:00:00.000Z';
const input = { userId: 'u1', kind: 'workLog' as const, payload: { clienteId: 'c1' }, motivazione: 'perché sì', client: 'claude-desktop' };

test('createProposal builds a pending proposal that expires after 14 days', () => {
  const p = createProposal(input, { now: NOW, writerId: 'mcp-1', id: 'prop_x' });
  assert.equal(PROPOSAL_EXPIRY_DAYS, 14);
  assert.deepEqual(p, {
    id: 'prop_x', userId: 'u1', kind: 'workLog', payload: { clienteId: 'c1' }, motivazione: 'perché sì',
    status: 'pending', createdAt: NOW, updatedAt: NOW, expiresAt: '2026-09-28T10:00:00.000Z',
    createdBy: { writerId: 'mcp-1', client: 'claude-desktop' }, result: null, rejectReason: null,
  });
});

test('createProposal generates a prop_ id and omits empty optional fields', () => {
  const p = createProposal({ userId: 'u1', kind: 'cliente', payload: { nome: 'X' } }, { now: NOW, writerId: 'mcp-1' });
  assert.match(p.id, /^prop_[0-9a-f-]{8,}$/);
  assert.equal('motivazione' in p, false);
  assert.deepEqual(p.createdBy, { writerId: 'mcp-1' });
});

test('withExpiry marks pending proposals past expiresAt as expired, in memory only', () => {
  const fresh = createProposal(input, { now: NOW, writerId: 'mcp-1', id: 'a' });
  const old = createProposal(input, { now: '2026-08-01T00:00:00.000Z', writerId: 'mcp-1', id: 'b' });
  const applied: Proposal = { ...old, id: 'c', status: 'applied', result: { recordId: 'r1' } };
  const out = withExpiry([fresh, old, applied], NOW);
  assert.deepEqual(out.map((p) => [p.id, p.status]), [['a', 'pending'], ['b', 'expired'], ['c', 'applied']]);
  assert.equal(out[1].updatedAt, NOW);
  assert.equal(old.status, 'pending');
});

test('withExpiry treats expiresAt equal to now as expired, like the merge', () => {
  const p = createProposal(input, { now: '2026-08-31T10:00:00.000Z', writerId: 'mcp-1', id: 'a' });
  assert.equal(p.expiresAt, NOW);
  assert.equal(withExpiry([p], NOW)[0].status, 'expired');
  assert.equal(isPending(p, NOW), false);
});

test('withdrawProposal moves a pending proposal to withdrawn', () => {
  const p = createProposal(input, { now: NOW, writerId: 'mcp-1', id: 'a' });
  const later = '2026-09-15T10:00:00.000Z';
  assert.deepEqual(withdrawProposal(p, later), { ...p, status: 'withdrawn', updatedAt: later });
});

test('withdrawProposal rejects terminal and expired proposals with PROPOSAL_NOT_PENDING', () => {
  const p = createProposal(input, { now: NOW, writerId: 'mcp-1', id: 'a' });
  assert.throws(() => withdrawProposal({ ...p, status: 'applied' }, NOW), (e: unknown) => e instanceof ProposalNotPendingError && e.code === 'PROPOSAL_NOT_PENDING' && e.details?.status === 'applied');
  assert.throws(() => withdrawProposal(p, '2026-10-01T00:00:00.000Z'), (e: unknown) => e instanceof ProposalNotPendingError && e.details?.status === 'expired');
});
