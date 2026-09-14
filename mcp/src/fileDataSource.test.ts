import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKUP_DIR, SYNC_FILENAME } from '../../src/lib/sync/backup';
import { LOCK_FILE } from '../../src/lib/sync/lock';
import { createEmptySnapshot, parseSyncFile, type Proposal } from '../../src/lib/sync/schema';
import { fromBytes, memoryFileSystem, text, type MemoryFileSystem } from '../../src/lib/sync/testing/memoryFileSystem';
import { DataSourceError, type Principal } from './datasource';
import { FileDataSource } from './fileDataSource';

const T0 = '2026-09-01T00:00:00.000Z';
const NOW = '2026-09-14T10:00:00.000Z';
const OLD = '2026-08-01T00:00:00.000Z';
const P: Principal = { kind: 'local', writerId: 'mcp-1' };

function seed() {
  const s = createEmptySnapshot({ now: T0, writer: { id: 'app-1', kind: 'app' } });
  s.users.push({ id: 'u1', nome: 'Davide', createdAt: T0 }, { id: 'u2', nome: 'Altro', createdAt: T0 });
  s.config.push({ id: 'config_u1', userId: 'u1', coefficiente: 78, aliquota: 15, ateco: [], aliquotaOverride: null, annoApertura: 2020, codiciAteco: [], gestionePrevidenziale: 'gestione_separata', contributiInpsFissi: null, riduzioneContributiva: false });
  s.clienti.push({ id: 'c1', userId: 'u1', nome: 'Acme' }, { id: 'c2', userId: 'u2', nome: 'Beta' });
  s.fatture.push({ id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', data: '2026-09-01', importo: 100 });
  s.workLogs.push({ id: 'w1', userId: 'u1', clienteId: 'c1', data: '2026-09-01', tipo: 'giornata', quantita: 1 });
  s.scadenze.push({ id: 's1', userId: 'u2', visibleId: 'v', annoRiferimento: 2025, annoVersamento: 2026, date: '2026-06-30', tipo: 'saldo_irpef', label: 'x', importo: 1, interessi: 0, totale: 1, pagato: false });
  return s;
}

function pending(id: string, userId: string, createdAt: string): Proposal {
  const expiresAt = new Date(Date.parse(createdAt) + 14 * 86_400_000).toISOString();
  return { id, userId, kind: 'cliente', payload: { nome: 'X' }, status: 'pending', createdAt, updatedAt: createdAt, expiresAt, createdBy: { writerId: 'mcp-1' }, result: null, rejectReason: null };
}

const stamp = { now: NOW, writer: { id: 'x', kind: 'mcp' as const } };
const fileText = (fs: MemoryFileSystem) => fromBytes(fs.files.get(SYNC_FILENAME) ?? null) ?? '';
const parsed = (fs: MemoryFileSystem) => parseSyncFile(fileText(fs), stamp);

async function setup(proposals: Proposal[] = []) {
  const fs = memoryFileSystem({ withMove: true });
  const s = seed();
  s.proposals = proposals;
  await fs.write(SYNC_FILENAME, text(JSON.stringify(s)));
  const ds = new FileDataSource(fs, { writerId: 'mcp-1', now: () => new Date(NOW), version: '0.0.0', lock: { sleep: async () => {}, timeoutMs: 0 } });
  return { fs, ds };
}

const rejectsWith = (code: string) => (err: unknown) => err instanceof DataSourceError && err.code === code;

test('listUsers fails with SOURCE_UNAVAILABLE when the sync file is missing', async () => {
  const ds = new FileDataSource(memoryFileSystem(), { writerId: 'mcp-1' });
  await assert.rejects(ds.listUsers(P), rejectsWith('SOURCE_UNAVAILABLE'));
});

test('listUsers returns every profile of the file for a local principal', async () => {
  const { ds } = await setup();
  assert.deepEqual((await ds.listUsers(P)).map((u) => u.id), ['u1', 'u2']);
});

test('getSnapshot returns only the records of that profile with its config', async () => {
  const { ds } = await setup();
  const snap = await ds.getSnapshot(P, 'u1');
  assert.equal(snap.user.nome, 'Davide');
  assert.equal(snap.config?.id, 'config_u1');
  assert.deepEqual(snap.clienti.map((c) => c.id), ['c1']);
  assert.deepEqual(snap.fatture.map((f) => f.id), ['f1']);
  assert.deepEqual(snap.workLogs.map((w) => w.id), ['w1']);
  assert.deepEqual(snap.scadenze, []);
  assert.equal(snap.readAt, NOW);
});

test('getSnapshot has a null config for a profile without one', async () => {
  const { ds } = await setup();
  assert.equal((await ds.getSnapshot(P, 'u2')).config, null);
});

test('getSnapshot rejects an unknown profile with USER_NOT_FOUND', async () => {
  const { ds } = await setup();
  await assert.rejects(ds.getSnapshot(P, 'nope'), rejectsWith('USER_NOT_FOUND'));
});

test('listProposals filters by user and status, applies expiry in memory and paginates', async () => {
  const { fs, ds } = await setup([pending('a', 'u1', NOW), pending('b', 'u1', OLD), pending('c', 'u2', NOW), { ...pending('d', 'u1', NOW), status: 'withdrawn' }]);
  const all = await ds.listProposals(P, { userId: 'u1' });
  assert.deepEqual(all.items.map((p) => [p.id, p.status]), [['a', 'pending'], ['b', 'expired'], ['d', 'withdrawn']]);
  assert.equal(all.total, 3);
  const expired = await ds.listProposals(P, { userId: 'u1', status: 'expired' });
  assert.deepEqual(expired.items.map((p) => p.id), ['b']);
  const page = await ds.listProposals(P, { userId: 'u1', limit: 1, offset: 1 });
  assert.deepEqual(page.items.map((p) => p.id), ['b']);
  assert.equal(page.total, 3);
  assert.equal(fs.log.filter((l) => l.startsWith('write')).length, 1, 'expiry never writes');
});

test('getProposal returns null when missing and the expired view otherwise', async () => {
  const { ds } = await setup([pending('b', 'u1', OLD)]);
  assert.equal(await ds.getProposal(P, 'zz'), null);
  assert.equal((await ds.getProposal(P, 'b'))?.status, 'expired');
});

test('addProposal writes only into proposals, after a backup of kind mcp, and releases the lock', async () => {
  const { fs, ds } = await setup();
  const before = fileText(fs);
  const start = fs.log.length;
  const p = await ds.addProposal(P, { userId: 'u1', kind: 'cliente', payload: { nome: 'X' }, motivazione: 'm', client: 'claude' });
  assert.equal(p.status, 'pending');
  assert.deepEqual(p.createdBy, { writerId: 'mcp-1', client: 'claude' });
  assert.equal(p.createdAt, NOW);

  const after = parsed(fs).snapshot;
  assert.deepEqual(after.proposals, [p]);
  assert.equal(after.writer.id, 'mcp-1');
  assert.equal(after.writer.kind, 'mcp');
  const original = JSON.parse(before);
  for (const store of ['users', 'config', 'clienti', 'fatture', 'workLogs', 'scadenze', 'tombstones'] as const) {
    assert.deepEqual(after[store], original[store], `${store} untouched`);
  }
  const backups = (await fs.list(BACKUP_DIR)).filter((n) => n !== 'latest.json');
  assert.equal(backups.length, 1);
  assert.match(backups[0], /\.mcp\.json$/);
  assert.equal(fromBytes(fs.files.get(`${BACKUP_DIR}/${backups[0]}`) ?? null), before, 'backup holds the previous bytes');
  assert.equal(fs.files.has(LOCK_FILE), false);
  const order = fs.log.slice(start).filter((l) => l === `write ${LOCK_FILE}` || l.startsWith(`write ${BACKUP_DIR}/pivella-sync`) || l.startsWith(`write ${SYNC_FILENAME}`) || l === `remove ${LOCK_FILE}`);
  assert.equal(order[0], `write ${LOCK_FILE}`);
  assert.ok(order.findIndex((l) => l.startsWith(`write ${BACKUP_DIR}`)) < order.findIndex((l) => l.startsWith(`write ${SYNC_FILENAME}`)));
  assert.equal(order[order.length - 1], `remove ${LOCK_FILE}`);
});

test('addProposal rejects an unknown profile without writing', async () => {
  const { fs, ds } = await setup();
  await assert.rejects(ds.addProposal(P, { userId: 'nope', kind: 'cliente', payload: {} }), rejectsWith('USER_NOT_FOUND'));
  assert.equal(fs.log.filter((l) => l.startsWith(`write ${SYNC_FILENAME}`)).length, 1);
});

test('addProposal upgrades a v1 file with a backup of kind v1', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text(JSON.stringify({ users: [{ id: 'u1', nome: 'D', createdAt: T0 }], config: [], clienti: [], fatture: [], workLogs: [], scadenze: [] })));
  const ds = new FileDataSource(fs, { writerId: 'mcp-1', now: () => new Date(NOW) });
  await ds.addProposal(P, { userId: 'u1', kind: 'cliente', payload: { nome: 'X' } });
  const backups = (await fs.list(BACKUP_DIR)).filter((n) => n !== 'latest.json');
  assert.deepEqual(backups.map((n) => n.split('.').slice(-2)[0]), ['v1']);
  const after = parsed(fs);
  assert.equal(after.upgradedFromV1, false);
  assert.equal(after.snapshot.users[0].updatedBy, 'mcp-1');
  assert.equal(after.snapshot.proposals.length, 1);
});

test('addProposal fails with BACKUP_FAILED and leaves the file untouched when the backup cannot be written', async () => {
  const fs = memoryFileSystem({ withMove: true, failWrite: (p) => p.startsWith(`${BACKUP_DIR}/`) });
  await fs.write(SYNC_FILENAME, text(JSON.stringify(seed())));
  const before = fileText(fs);
  const ds = new FileDataSource(fs, { writerId: 'mcp-1', now: () => new Date(NOW) });
  await assert.rejects(ds.addProposal(P, { userId: 'u1', kind: 'cliente', payload: { nome: 'X' } }), rejectsWith('BACKUP_FAILED'));
  assert.equal(fileText(fs), before);
  assert.equal(fs.files.has(LOCK_FILE), false, 'lock released after failure');
});

test('addProposal fails with SOURCE_LOCKED when another writer holds a fresh lock', async () => {
  const { fs, ds } = await setup();
  await fs.write(LOCK_FILE, text(JSON.stringify({ writerId: 'app-1', kind: 'app', acquiredAt: NOW })));
  await assert.rejects(ds.addProposal(P, { userId: 'u1', kind: 'cliente', payload: { nome: 'X' } }), rejectsWith('SOURCE_LOCKED'));
  assert.ok((fromBytes(fs.files.get(LOCK_FILE) ?? null) ?? '').includes('app-1'), 'foreign lock untouched');
});

test('withdrawProposal writes the withdrawn status and rejects non pending ones', async () => {
  const { fs, ds } = await setup([pending('a', 'u1', NOW), pending('b', 'u1', OLD)]);
  const w = await ds.withdrawProposal(P, 'a');
  assert.equal(w.status, 'withdrawn');
  assert.equal(parsed(fs).snapshot.proposals.find((p) => p.id === 'a')?.status, 'withdrawn');
  await assert.rejects(ds.withdrawProposal(P, 'zz'), rejectsWith('NOT_FOUND'));
  await assert.rejects(ds.withdrawProposal(P, 'b'), (e: unknown) => rejectsWith('PROPOSAL_NOT_PENDING')(e) && (e as DataSourceError).details?.status === 'expired');
  await assert.rejects(ds.withdrawProposal(P, 'a'), rejectsWith('PROPOSAL_NOT_PENDING'));
});

test('a malformed sync file surfaces as SOURCE_UNAVAILABLE with details', async () => {
  const fs = memoryFileSystem();
  await fs.write(SYNC_FILENAME, text('{ nope'));
  const ds = new FileDataSource(fs, { writerId: 'mcp-1' });
  await assert.rejects(ds.listUsers(P), (e: unknown) => rejectsWith('SOURCE_UNAVAILABLE')(e) && typeof (e as DataSourceError).details?.reason === 'string');
});
