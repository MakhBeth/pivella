import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { IndexedDBManager } from '../db/IndexedDBManager';
import { DEFAULT_CONFIG } from '../constants/fiscali';
import { SYNC_FILENAME } from './backup';
import { LOCK_FILE } from './lock';
import { decideProposal, ProposalNotFoundError } from './proposalFlow';
import { createProposal, ProposalNotPendingError } from './proposals';
import { createEmptySnapshot, parseSyncFile, type Proposal, type SyncSnapshot, type Writer } from './schema';
import type { AppliedChanges, SyncSource } from './syncCycle';
import { fromBytes, memoryFileSystem, text, type MemoryFileSystem } from './testing/memoryFileSystem';
import { ProposalValidationError } from './validate';

console.log = () => {};

const T0 = '2026-09-01T00:00:00.000Z';
const NOW = '2026-09-14T10:00:00.000Z';
const MCP: Writer = { id: 'mcp-1', kind: 'mcp' };

function memorySource(fs: MemoryFileSystem): SyncSource {
  let version = 0;
  const write = fs.write.bind(fs);
  fs.write = async (path, bytes) => {
    if (path === SYNC_FILENAME) version++;
    return write(path, bytes);
  };
  const move = fs.move?.bind(fs);
  if (move) fs.move = async (from, to) => { if (to === SYNC_FILENAME) version++; return move(from, to); };
  return { fs, lastModified: async () => ((await fs.read(SYNC_FILENAME)) ? `current:${version}` : null) };
}

const proposalOf = (id: string, kind: Proposal['kind'], payload: Record<string, unknown>, createdAt = NOW) =>
  createProposal({ userId: 'u1', kind, payload, motivazione: 'perché' }, { now: createdAt, writerId: 'mcp-1', id });

async function setup(proposals: Proposal[]) {
  const factory = new IDBFactory();
  const db = new IndexedDBManager({ factory, now: () => NOW });
  await db.init();
  await db.put('users', { id: 'u1', nome: 'Davide', createdAt: T0, updatedAt: T0, updatedBy: 'app-x' });
  await db.put('config', { ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', partitaIva: '01234567890', emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'M', cognome: 'R', indirizzo: 'V', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' }, updatedAt: T0, updatedBy: 'app-x' });
  await db.put('clienti', { id: 'c1', userId: 'u1', nome: 'Acme', updatedAt: T0, updatedBy: 'app-x' });
  await db.put('fatture', { id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', numero: '03', data: '2026-02-01', importo: 100, incassato: false, updatedAt: T0, updatedBy: 'app-x' });
  const fs = memoryFileSystem({ withMove: true });
  const source = memorySource(fs);
  const remote: SyncSnapshot = { ...createEmptySnapshot({ now: T0, writer: MCP }), proposals };
  await fs.write(SYNC_FILENAME, text(JSON.stringify(remote)));
  const writer: Writer = { id: db.writerId!, kind: 'app' };
  const applied: AppliedChanges[] = [];
  let ids = 0;
  const decide = (proposalId: string, decision: Parameters<typeof decideProposal>[0]['decision']) =>
    decideProposal({ db, source, writer, proposalId, decision, now: () => new Date(NOW), newId: () => `new_${++ids}`, onApplied: (a) => { applied.push(a); } });
  const fileProposals = () => parseSyncFile(fromBytes(fs.files.get(SYNC_FILENAME) ?? null) ?? '', { now: NOW, writer: MCP }).snapshot.proposals;
  return { db, fs, decide, applied, fileProposals };
}

test('applying a work log proposal writes the record to IndexedDB and marks the proposal applied in the file, under one lock', async () => {
  const { db, fs, decide, applied, fileProposals } = await setup([proposalOf('p1', 'workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1 })]);
  const outcome = await decide('p1', { kind: 'apply' });
  assert.equal(outcome.proposal.status, 'applied');
  assert.deepEqual(outcome.proposal.result, { recordId: 'new_1' });
  const stored = await db.get('workLogs', 'new_1');
  assert.equal(stored.clienteId, 'c1');
  assert.equal(stored.updatedBy, db.writerId);
  const inFile = fileProposals().find((p) => p.id === 'p1')!;
  assert.equal(inFile.status, 'applied');
  assert.deepEqual(inFile.result, { recordId: 'new_1' });
  const written = parseSyncFile(fromBytes(fs.files.get(SYNC_FILENAME) ?? null) ?? '', { now: NOW, writer: MCP }).snapshot;
  assert.ok(written.workLogs.some((w) => w.id === 'new_1'), 'the record is in the file too');
  assert.equal(fs.files.has(LOCK_FILE), false);
  assert.deepEqual(applied[applied.length - 1]?.workLogs, { upserted: ['new_1'], deleted: [] });
});

test('applying an invoice proposal assigns the number for its year and links the client', async () => {
  const { db, decide } = await setup([proposalOf('p1', 'fattura', { clienteId: 'c1', data: '2026-09-10', righe: [{ descrizione: 'x', quantita: 1, prezzoUnitario: 200 }], valuta: 'EUR' })]);
  const outcome = await decide('p1', { kind: 'apply' });
  assert.deepEqual(outcome.proposal.result, { recordId: 'new_1', numero: '04' });
  const fattura = await db.get('fatture', 'new_1');
  assert.equal(fattura.clienteNome, 'Acme');
  assert.equal(fattura.importo, 200);
});

test('rejecting marks the proposal rejected with the reason and writes nothing else', async () => {
  const { db, decide, fileProposals, applied } = await setup([proposalOf('p1', 'incasso', { fatturaId: 'f1', dataIncasso: '2026-09-10' })]);
  const outcome = await decide('p1', { kind: 'reject', reason: 'non ancora' });
  assert.equal(outcome.proposal.status, 'rejected');
  assert.equal(outcome.proposal.rejectReason, 'non ancora');
  assert.equal(fileProposals()[0].status, 'rejected');
  assert.equal((await db.get('fatture', 'f1')).incassato, false);
  assert.equal(applied.length, 0);
});

test('a proposal that no longer validates is not applied and stays pending', async () => {
  const { db, decide, fileProposals } = await setup([proposalOf('p1', 'workLog', { clienteId: 'zz', data: '2026-09-10', tipo: 'giornata', quantita: 1 })]);
  await assert.rejects(decide('p1', { kind: 'apply' }), ProposalValidationError);
  assert.equal(fileProposals()[0].status, 'pending');
  assert.deepEqual(await db.getAll('workLogs'), []);
});

test('terminal, expired and unknown proposals are refused', async () => {
  const { decide } = await setup([
    proposalOf('done', 'cliente', { nome: 'X' }),
    proposalOf('old', 'cliente', { nome: 'Y' }, '2026-08-01T00:00:00.000Z'),
  ]);
  await decide('done', { kind: 'reject' });
  await assert.rejects(decide('done', { kind: 'apply' }), ProposalNotPendingError);
  await assert.rejects(decide('old', { kind: 'apply' }), ProposalNotPendingError);
  await assert.rejects(decide('nope', { kind: 'apply' }), ProposalNotFoundError);
});

test('applying twice cannot duplicate the record', async () => {
  const { db, decide } = await setup([proposalOf('p1', 'cliente', { nome: 'Beta' })]);
  await decide('p1', { kind: 'apply' });
  await assert.rejects(decide('p1', { kind: 'apply' }), ProposalNotPendingError);
  assert.equal((await db.getAll('clienti')).filter((c) => c.nome === 'Beta').length, 1);
});
