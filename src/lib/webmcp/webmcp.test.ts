import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/IndexedDBManager';
import { DB_NAME, DEFAULT_CONFIG, STORES, WEBMCP_PROPOSALS_STORE } from '../constants/fiscali';
import { BrowserDataSource } from './browserDataSource';
import { registerBrowserTools, type BrowserTool, type ModelContext } from './register';
import type { NewProposal } from '../sync/proposals';
import type { Proposal } from '../sync/schema';

const NOW = '2026-10-19T10:00:00.000Z';
const principal = { kind: 'local' as const, writerId: 'test-webmcp' };
const invoice: NewProposal = {
  userId: 'u1', kind: 'fattura', payload: {
    clienteId: 'c1', data: '2026-10-19', righe: [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 400 }],
  },
};

async function fixture(t: test.TestContext) {
  const factory = new IDBFactory();
  const db = new IndexedDBManager({ factory, now: () => NOW });
  await db.init();
  t.after(() => db.close());
  await db.put('users', { id: 'u1', nome: 'Uno', createdAt: NOW });
  await db.put('users', { id: 'u2', nome: 'Due', createdAt: NOW });
  await db.put('config', {
    ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', partitaIva: '01234567890',
    emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
  });
  await db.put('clienti', { id: 'c1', userId: 'u1', nome: 'Acme' });
  await db.put('clienti', { id: 'c2', userId: 'u2', nome: 'Altro profilo' });
  let userId: string | null = 'u1';
  let now = NOW;
  const active = () => userId;
  const clock = () => new Date(now);
  const ds = new BrowserDataSource(db, active, clock);
  return { db, factory, ds, active, clock, switchUser: (id: string | null) => { userId = id; }, setNow: (value: string) => { now = value; } };
}

test('v3 database upgrades without losing records; browser drafts stay out of sync snapshots', async t => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const open = factory.open(DB_NAME, 3);
    open.onupgradeneeded = () => {
      for (const store of STORES) open.result.createObjectStore(store, { keyPath: 'id' });
      open.transaction!.objectStore('clienti').put({ id: 'old', userId: 'u1', nome: 'Conservato' });
    };
    open.onsuccess = () => { open.result.close(); resolve(); };
    open.onerror = () => reject(open.error);
  });
  const db = new IndexedDBManager({ factory });
  t.after(() => db.close());
  await db.init();
  assert.ok(db.db!.objectStoreNames.contains(WEBMCP_PROPOSALS_STORE));
  assert.equal((await db.get('clienti', 'old')).nome, 'Conservato');
  assert.deepEqual((await db.exportSnapshot()).proposals, []);
});

test('a blocked schema upgrade preserves the existing database', async () => {
  const factory = new IDBFactory();
  const held = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(DB_NAME, 3);
    open.onupgradeneeded = () => {
      for (const store of STORES) open.result.createObjectStore(store, { keyPath: 'id' });
      open.transaction!.objectStore('clienti').put({ id: 'old', userId: 'u1', nome: 'Conservato' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  let deletions = 0;
  const originalDelete = factory.deleteDatabase.bind(factory);
  factory.deleteDatabase = name => { deletions++; return originalDelete(name); };
  const db = new IndexedDBManager({ factory });
  try {
    await assert.rejects(db.init(), /I dati sono conservati/);
    assert.equal(deletions, 0);
    const record = await new Promise<{ nome: string }>((resolve, reject) => {
      const req = held.transaction('clienti').objectStore('clienti').get('old');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    assert.equal(record.nome, 'Conservato');
  } finally {
    held.close();
    // Lascia terminare l'open rimasto in attesa prima di chiudere il manager.
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    db.close();
  }
});

test('a proposal is durable across connections and creates no invoice until UI confirmation', async t => {
  const f = await fixture(t);
  const proposal = await f.ds.addProposal(principal, invoice);
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.createdBy.client, 'WebMCP');
  assert.equal((await f.db.getAll('fatture')).length, 0);
  assert.deepEqual((await f.db.exportSnapshot()).proposals, []);
  f.db.close();
  const reopened = new IndexedDBManager({ factory: f.factory, now: () => NOW });
  await reopened.init();
  t.after(() => reopened.close());
  const source = new BrowserDataSource(reopened, f.active, f.clock);
  assert.equal((await source.getProposal(principal, proposal.id))?.status, 'pending');
  const outcome = await source.decideProposal(proposal.id, 'apply');
  assert.equal(outcome.proposal.status, 'applied');
  const saved = await reopened.get('fatture', outcome.proposal.result!.recordId);
  assert.equal(saved.numero, '01');
  assert.equal(saved.importo, 800);
  assert.equal(saved.righe.length, 1);
  assert.equal(saved.updatedBy, reopened.writerId);
});

test('active-profile isolation applies to reads, proposal creation and decisions', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.ds.listUsers(principal)).map(u => u.id), ['u1']);
  assert.deepEqual((await f.ds.getSnapshot(principal, 'u1')).clienti.map(c => c.id), ['c1']);
  await assert.rejects(f.ds.getSnapshot(principal, 'u2'), { code: 'PERMISSION_DENIED' });
  await assert.rejects(f.ds.addProposal(principal, { ...invoice, userId: 'u2' }), { code: 'PERMISSION_DENIED' });
  const reading = f.ds.getSnapshot(principal, 'u1');
  f.switchUser('u2');
  await assert.rejects(reading, { code: 'PERMISSION_DENIED' });
  f.switchUser('u1');
  const p = await f.ds.addProposal(principal, invoice);
  f.switchUser('u2');
  await assert.rejects(f.ds.getProposal(principal, p.id), { code: 'PERMISSION_DENIED' });
  await assert.rejects(f.ds.decideProposal(p.id, 'apply'), { code: 'PERMISSION_DENIED' });
  f.switchUser(null);
  await assert.rejects(f.ds.listUsers(principal), { code: 'PERMISSION_DENIED' });
  assert.equal((await f.db.getAll('fatture')).length, 0);
});

test('confirmation revalidates current data and does not consume an invalid proposal', async t => {
  const f = await fixture(t);
  const p = await f.ds.addProposal(principal, invoice);
  await f.db.delete('clienti', 'c1');
  await assert.rejects(f.ds.decideProposal(p.id, 'apply'), { code: 'VALIDATION' });
  assert.equal((await f.ds.getProposal(principal, p.id))?.status, 'pending');
  assert.equal((await f.db.getAll('fatture')).length, 0);
});

test('rejecting and expiring proposals leaves accounting records untouched', async t => {
  const f = await fixture(t);
  const rejected = await f.ds.addProposal(principal, invoice);
  assert.equal((await f.ds.decideProposal(rejected.id, 'reject')).proposal.status, 'rejected');
  await assert.rejects(f.ds.decideProposal(rejected.id, 'apply'), { code: 'PROPOSAL_NOT_PENDING' });
  const expired = await f.ds.addProposal(principal, invoice);
  f.setNow(expired.expiresAt);
  assert.equal((await f.ds.getProposal(principal, expired.id))?.status, 'expired');
  await assert.rejects(f.ds.decideProposal(expired.id, 'apply'), { code: 'PROPOSAL_NOT_PENDING' });
  assert.equal((await f.db.getAll('fatture')).length, 0);
});

test('concurrent confirmations across connections apply once and assign distinct numbers', async t => {
  const f = await fixture(t);
  const secondDb = new IndexedDBManager({ factory: f.factory, now: () => NOW });
  await secondDb.init();
  t.after(() => secondDb.close());
  const other = new BrowserDataSource(secondDb, f.active, f.clock);
  const p = await f.ds.addProposal(principal, invoice);
  const results = await Promise.allSettled([f.ds.decideProposal(p.id, 'apply'), other.decideProposal(p.id, 'apply')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await f.db.getAll('fatture')).length, 1);
  const next = await f.ds.addProposal(principal, invoice);
  const last = await other.addProposal(principal, invoice);
  await Promise.all([f.ds.decideProposal(next.id, 'apply'), other.decideProposal(last.id, 'apply')]);
  assert.deepEqual((await f.db.getAll('fatture')).map(f => f.numero).sort(), ['01', '02', '03']);
});

test('failure after planning a new client rolls back the client, invoice and proposal together', async t => {
  const f = await fixture(t);
  const p = await f.ds.addProposal(principal, { ...invoice, payload: { ...invoice.payload, clienteId: undefined, nuovoCliente: { denominazione: 'Nuovo' } } });
  const stamp = f.db.stamp.bind(f.db);
  let writes = 0;
  f.db.stamp = record => {
    if (++writes === 2) throw new Error('Simulated storage failure');
    return stamp(record);
  };
  await assert.rejects(f.ds.decideProposal(p.id, 'apply'), /Simulated storage failure/);
  assert.equal((await f.db.getAll('clienti')).length, 2);
  assert.equal((await f.db.getAll('fatture')).length, 0);
  assert.equal((await f.ds.getProposal(principal, p.id))?.status, 'pending');
});

function fakeModel(legacy = false) {
  const registered = new Map<string, BrowserTool>();
  const model: ModelContext = {
    registerTool(tool, options) {
      if (registered.has(tool.name)) throw new Error('Duplicate tool');
      registered.set(tool.name, tool);
      options?.signal.addEventListener('abort', () => registered.delete(tool.name), { once: true });
      return legacy ? undefined : Promise.resolve();
    },
    ...(legacy ? { unregisterTool: (name: string) => { registered.delete(name); } } : {}),
  };
  return { model, registered };
}

for (const legacy of [false, true]) test(`WebMCP tools use shared validation and unregister on cleanup (${legacy ? 'legacy' : 'draft'})`, async t => {
  const f = await fixture(t);
  const { model, registered } = fakeModel(legacy);
  let refreshed = 0;
  const registration = registerBrowserTools(model, { ds: f.ds, principal, now: f.clock }, async () => { refreshed++; });
  await registration.ready;
  assert.deepEqual([...registered.keys()], ['list_users', 'list_clienti', 'list_fatture', 'get_riepilogo_anno', 'list_proposals', 'get_proposal', 'propose_fattura']);
  const propose = registered.get('propose_fattura')!;
  assert.equal(propose.annotations.readOnlyHint, false);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(propose.execute({ userId: 'u1', ...invoice.payload }, { signal: cancelled.signal }), { name: 'AbortError' });
  assert.equal((await f.ds.listProposals(principal, { userId: 'u1' })).total, 0);
  // L'API legacy passa un ModelContextClient senza signal come secondo argomento.
  const client = { requestUserInteraction: async () => undefined } as { signal?: AbortSignal };
  const users = await registered.get('list_users')!.execute({}, client) as { isError: boolean };
  assert.equal(users.isError, false);
  const invalid = await propose.execute({ userId: 'u1', ...invoice.payload, numero: '999' }) as { isError: boolean; error: { code: string } };
  assert.equal(invalid.isError, true);
  assert.equal(invalid.error.code, 'VALIDATION');
  const valid = await propose.execute({ userId: 'u1', ...invoice.payload }) as { isError: boolean; proposal: Proposal };
  assert.equal(valid.isError, false);
  assert.equal(valid.proposal.status, 'pending');
  assert.equal(refreshed, 1);
  assert.equal((await f.db.getAll('fatture')).length, 0);
  registration.cleanup();
  assert.equal(registered.size, 0);
  await assert.rejects(propose.execute({ userId: 'u1', ...invoice.payload }), { name: 'AbortError' });
});

test('registration errors and cleanup during async registration leave no callable tools', async t => {
  const f = await fixture(t);
  const { model, registered } = fakeModel();
  const register = model.registerTool;
  model.registerTool = async (tool, options) => {
    if (tool.name === 'list_fatture') throw new Error('Registration refused');
    await register(tool, options);
  };
  const registration = registerBrowserTools(model, { ds: f.ds, principal, now: f.clock }, async () => {});
  await assert.rejects(registration.ready, /Registration refused/);
  assert.equal(registered.size, 0);
  const another = fakeModel();
  const cancelled = registerBrowserTools(another.model, { ds: f.ds, principal, now: f.clock }, async () => {});
  cancelled.cleanup();
  await cancelled.ready;
  assert.equal(another.registered.size, 0);
});
