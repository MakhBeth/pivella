import test from 'node:test';
import assert from 'node:assert/strict';

import { SYNC_FILENAME } from '../../../src/lib/sync/backup';
import { createEmptySnapshot, parseSyncFile, type Proposal } from '../../../src/lib/sync/schema';
import { fromBytes, memoryFileSystem, text, type MemoryFileSystem } from '../../../src/lib/sync/testing/memoryFileSystem';
import { DEFAULT_CONFIG } from '../../../src/lib/constants/fiscali';
import { FileDataSource } from '../fileDataSource';
import { TOOLS, runTool, type ToolContext, type ToolOutcome } from './index';

const T0 = '2026-09-01T00:00:00.000Z';
const NOW = '2026-09-14T10:00:00.000Z';
const OLD = '2026-08-01T00:00:00.000Z';

function seed() {
  const s = createEmptySnapshot({ now: T0, writer: { id: 'app-1', kind: 'app' } });
  s.users.push({ id: 'u1', nome: 'Davide', createdAt: T0, color: '#123456' }, { id: 'u2', nome: 'Altro', createdAt: T0 });
  s.config.push({
    ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', partitaIva: '01234567890', annoApertura: 2020, codiciAteco: ['62.01'],
    valute: [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }],
    emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
    courtesyInvoice: { ...DEFAULT_CONFIG.courtesyInvoice!, logoBase64: 'AAAA', logoMimeType: 'image/png' },
  });
  s.clienti.push(
    { id: 'c1', userId: 'u1', nome: 'Acme', rate: 400, billingUnit: 'giornata' },
    { id: 'c2', userId: 'u1', nome: 'Beta' },
    { id: 'c9', userId: 'u2', nome: 'Altrui' },
  );
  s.fatture.push(
    { id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', numero: '01', data: '2026-01-10', dataIncasso: '2026-01-20', importo: 1000 },
    { id: 'f2', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', numero: '02', data: '2026-03-10', importo: 500, incassato: false },
    { id: 'f3', userId: 'u1', clienteId: 'c2', clienteNome: 'Beta', numero: '03', data: '2026-12-28', dataIncasso: '2027-01-05', importo: 300 },
    { id: 'f4', userId: 'u1', clienteId: 'c2', clienteNome: 'Beta', numero: '05', data: '2025-06-01', dataIncasso: '2025-06-01', importo: 200 },
    { id: 'f9', userId: 'u2', clienteId: 'c9', clienteNome: 'Altrui', data: '2026-02-01', importo: 999 },
  );
  s.workLogs.push(
    { id: 'w1', userId: 'u1', clienteId: 'c1', data: '2026-09-01', tipo: 'giornata', quantita: 1 },
    { id: 'w2', userId: 'u1', clienteId: 'c1', data: '2026-09-02', tipo: 'giornata', quantita: 0.5 },
    { id: 'w3', userId: 'u1', clienteId: 'c2', data: '2026-09-03', tipo: 'ore', ore: '3' },
    { id: 'w4', userId: 'u1', clienteId: '__vacation__', data: '2026-09-04', tipo: 'giornata', quantita: 1 },
    { id: 'w5', userId: 'u1', clienteId: 'c1', data: '2026-08-15', tipo: 'giornata', quantita: 1 },
    { id: 'w9', userId: 'u2', clienteId: 'c9', data: '2026-09-01', tipo: 'giornata', quantita: 1 },
  );
  s.scadenze.push(
    { id: 's1', userId: 'u1', visibleId: 'v1', annoRiferimento: 2025, annoVersamento: 2026, date: '2026-06-30', tipo: 'saldo_irpef', label: 'Saldo IRPEF', importo: 100, interessi: 0, totale: 100, pagato: false },
    { id: 's2', userId: 'u1', visibleId: 'v2', annoRiferimento: 2025, annoVersamento: 2026, date: '2026-06-30', tipo: 'saldo_inps', label: 'Saldo INPS', importo: 50, interessi: 1, totale: 51, pagato: true, dataPagamento: '2026-06-30' },
    { id: 's3', userId: 'u1', visibleId: 'v3', annoRiferimento: 2024, annoVersamento: 2025, date: '2025-06-30', tipo: 'saldo_irpef', label: 'Vecchia', importo: 10, interessi: 0, totale: 10, pagato: false },
  );
  return s;
}

function pending(id: string, userId: string, createdAt: string): Proposal {
  const expiresAt = new Date(Date.parse(createdAt) + 14 * 86_400_000).toISOString();
  return { id, userId, kind: 'cliente', payload: { nome: 'X' }, status: 'pending', createdAt, updatedAt: createdAt, expiresAt, createdBy: { writerId: 'mcp-1' }, result: null, rejectReason: null };
}

async function setup(proposals: Proposal[] = []) {
  const fs = memoryFileSystem({ withMove: true });
  const s = seed();
  s.proposals = proposals;
  await fs.write(SYNC_FILENAME, text(JSON.stringify(s)));
  const ds = new FileDataSource(fs, { writerId: 'mcp-1', now: () => new Date(NOW), lock: { sleep: async () => {}, timeoutMs: 0 } });
  const ctx: ToolContext = { ds, principal: { kind: 'local', writerId: 'mcp-1' }, now: () => new Date(NOW), client: 'test-client' };
  return { fs, ds, ctx };
}

const parsedFile = (fs: MemoryFileSystem) => parseSyncFile(fromBytes(fs.files.get(SYNC_FILENAME) ?? null) ?? '', { now: NOW, writer: { id: 'x', kind: 'mcp' } }).snapshot;

async function call(ctx: ToolContext, name: string, args: unknown): Promise<ToolOutcome> {
  const def = TOOLS.find((t) => t.name === name);
  assert.ok(def, `tool ${name} registered`);
  return runTool(def, ctx, args);
}

async function ok(ctx: ToolContext, name: string, args: unknown): Promise<Record<string, unknown>> {
  const out = await call(ctx, name, args);
  assert.equal(out.isError, false, `${name} should succeed: ${JSON.stringify(out.error)}`);
  assert.equal(typeof out.text, 'string');
  return out.structured!;
}

async function fails(ctx: ToolContext, name: string, args: unknown): Promise<{ code: string; message: string; details?: Record<string, unknown> }> {
  const out = await call(ctx, name, args);
  assert.equal(out.isError, true, `${name} should fail`);
  return out.error!;
}

test('the registry exposes the seventeen tools of the contract', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), [
    'list_users', 'get_config', 'list_clienti', 'list_fatture', 'get_fattura', 'list_work_logs', 'list_scadenze',
    'get_riepilogo_anno', 'get_giornate_per_cliente', 'list_proposals', 'get_proposal',
    'propose_work_log', 'propose_fattura', 'propose_cliente', 'propose_incasso', 'propose_scadenza_pagata', 'withdraw_proposal',
  ]);
  for (const t of TOOLS) assert.ok(t.description.length > 10, `${t.name} has a description`);
});

test('invalid arguments fail with VALIDATION and the offending fields', async () => {
  const { ctx } = await setup();
  const err = await fails(ctx, 'get_config', { userId: 42 });
  assert.equal(err.code, 'VALIDATION');
  assert.ok(Array.isArray(err.details?.fields));
});

test('list_users returns the profiles without extra fields', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'list_users', {});
  assert.deepEqual(out.users, [{ id: 'u1', nome: 'Davide', color: '#123456', createdAt: T0 }, { id: 'u2', nome: 'Altro', createdAt: T0 }]);
});

test('get_config strips the logo and reports emittenteConfigurato and valute', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'get_config', { userId: 'u1' });
  const config = out.config as Record<string, unknown>;
  assert.equal(config.partitaIva, '01234567890');
  const courtesy = config.courtesyInvoice as Record<string, unknown>;
  assert.equal('logoBase64' in courtesy, false);
  assert.equal('logoMimeType' in courtesy, false);
  assert.equal(out.emittenteConfigurato, true);
  assert.deepEqual(out.valute, [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }]);
});

test('get_config for a profile without config returns null config and EUR', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'get_config', { userId: 'u2' });
  assert.equal(out.config, null);
  assert.equal(out.emittenteConfigurato, false);
  assert.deepEqual(out.valute, [{ codice: 'EUR', simbolo: '€' }]);
  assert.equal((await fails(ctx, 'get_config', { userId: 'zz' })).code, 'USER_NOT_FOUND');
});

test('list_clienti hides special clients unless asked, and paginates', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'list_clienti', { userId: 'u1' });
  assert.deepEqual((out.clienti as { id: string }[]).map((c) => c.id), ['c1', 'c2']);
  assert.equal(out.total, 2);
  assert.equal(out.hasMore, false);
  const withSpecial = await ok(ctx, 'list_clienti', { userId: 'u1', includeSpeciali: true, limit: 3 });
  assert.deepEqual((withSpecial.clienti as { id: string; nome: string; speciale?: boolean }[]).map((c) => [c.id, c.nome, c.speciale]), [['c1', 'Acme', undefined], ['c2', 'Beta', undefined], ['__vacation__', 'Ferie', true]]);
  assert.equal(withSpecial.total, 4);
  assert.equal(withSpecial.hasMore, true);
});

test('list_fatture filters by issue date and exposes emesso, incassato and daIncassare', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'list_fatture', { userId: 'u1', anno: 2026 });
  assert.deepEqual((out.fatture as { id: string; clienteNome: string }[]).map((f) => f.id), ['f1', 'f2', 'f3']);
  assert.deepEqual(out.totali, { importo: 1800, incassato: 1300, daIncassare: 500 });
  const unpaid = await ok(ctx, 'list_fatture', { userId: 'u1', incassata: false });
  assert.deepEqual((unpaid.fatture as { id: string }[]).map((f) => f.id), ['f2']);
  const paid = await ok(ctx, 'list_fatture', { userId: 'u1', incassata: true, clienteId: 'c2' });
  assert.deepEqual((paid.fatture as { id: string }[]).map((f) => f.id), ['f4', 'f3']);
  const range = await ok(ctx, 'list_fatture', { userId: 'u1', da: '2026-03-10', a: '2026-12-28' });
  assert.deepEqual((range.fatture as { id: string }[]).map((f) => f.id), ['f2', 'f3']);
  assert.equal((await fails(ctx, 'list_fatture', { userId: 'u1', da: '2026-03-10', a: '2026-03-09' })).code, 'VALIDATION');
});

test('fatture expose incassata and dataIncassoEffettiva with the app semantics', async () => {
  const { ctx } = await setup();
  const senzaData = (await ok(ctx, 'get_fattura', { userId: 'u2', fatturaId: 'f9' })).fattura as Record<string, unknown>;
  assert.equal(senzaData.incassata, true, 'dataIncasso assente vale incassata alla data di emissione');
  assert.equal(senzaData.dataIncassoEffettiva, '2026-02-01');
  const list = await ok(ctx, 'list_fatture', { userId: 'u1' });
  const byId = new Map((list.fatture as Array<Record<string, unknown>>).map((f) => [f.id, f]));
  assert.deepEqual([byId.get('f1')?.incassata, byId.get('f1')?.dataIncassoEffettiva], [true, '2026-01-20']);
  assert.deepEqual([byId.get('f2')?.incassata, byId.get('f2')?.dataIncassoEffettiva], [false, null]);
});

test('get_fattura resolves clienteNome and fails with NOT_FOUND across profiles', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'get_fattura', { userId: 'u1', fatturaId: 'f2' });
  assert.equal((out.fattura as { clienteNome: string }).clienteNome, 'Acme');
  assert.equal((await fails(ctx, 'get_fattura', { userId: 'u1', fatturaId: 'f9' })).code, 'NOT_FOUND');
});

test('list_work_logs sums per client, converting legacy ore and naming special clients', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'list_work_logs', { userId: 'u1', da: '2026-09-01', a: '2026-09-30' });
  assert.deepEqual((out.workLogs as { id: string }[]).map((w) => w.id), ['w1', 'w2', 'w3', 'w4']);
  assert.deepEqual(out.totaliPerCliente, [
    { clienteId: 'c1', clienteNome: 'Acme', giornate: 1.5, ore: 0 },
    { clienteId: 'c2', clienteNome: 'Beta', giornate: 0, ore: 3 },
    { clienteId: '__vacation__', clienteNome: 'Ferie', giornate: 1, ore: 0 },
  ]);
  const one = await ok(ctx, 'list_work_logs', { userId: 'u1', da: '2026-09-01', a: '2026-09-30', clienteId: 'c2' });
  assert.equal(one.total, 1);
  assert.equal((await fails(ctx, 'list_work_logs', { userId: 'u1', da: '2025-01-01', a: '2026-09-30' })).code, 'VALIDATION');
});

test('list_scadenze filters by year and unpaid and totals daPagare and pagato', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'list_scadenze', { userId: 'u1', annoVersamento: 2026 });
  assert.deepEqual((out.scadenze as { id: string }[]).map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(out.totali, { daPagare: 100, pagato: 51 });
  const unpaid = await ok(ctx, 'list_scadenze', { userId: 'u1', soloNonPagate: true });
  assert.deepEqual((unpaid.scadenze as { id: string }[]).map((s) => s.id), ['s3', 's1']);
});

test('get_riepilogo_anno is computed on a cash basis and says so', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'get_riepilogo_anno', { userId: 'u1', anno: 2026 });
  assert.equal(out.criterio, 'cassa');
  assert.equal(out.anno, 2026);
  // f1 incassata nel 2026; f2 da incassare; f3 incassata nel 2027; f4 nel 2025.
  assert.equal(out.fatturato, 1000);
  assert.equal(out.numeroFatture, 1);
  assert.equal(out.coefficienteRedditivita, 67);
  assert.equal(out.redditoImponibile, 670);
  assert.equal(out.aliquotaApplicata, 0.15);
  const soglia = out.soglia as Record<string, unknown>;
  assert.equal(soglia.limite, 85000);
  assert.equal(soglia.stato, 'within_limit');
  assert.equal(soglia.rimanente, 84000);
  assert.ok(typeof out.impostaSostitutiva === 'number' && out.impostaSostitutiva > 0);
  assert.ok(typeof out.contributiPrevidenziali === 'number' && out.contributiPrevidenziali > 0);
  assert.equal(out.totaleStimato, Math.round(((out.impostaSostitutiva as number) + (out.contributiPrevidenziali as number)) * 100) / 100);
  assert.deepEqual(Object.keys(out.acconti as object), ['irpef', 'inps']);
  assert.match(out.nota as string, /per cassa/);
  const next = await ok(ctx, 'get_riepilogo_anno', { userId: 'u1', anno: 2027 });
  assert.equal(next.fatturato, 300);
  assert.equal((await fails(ctx, 'get_riepilogo_anno', { userId: 'u1', anno: 2026.5 })).code, 'VALIDATION');
});

test('get_riepilogo_anno without a config still answers with defaults', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'get_riepilogo_anno', { userId: 'u2', anno: 2026 });
  assert.equal(out.fatturato, 999);
  assert.equal(out.criterio, 'cassa');
});

test('get_giornate_per_cliente returns quantities only, with ids and totals', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'get_giornate_per_cliente', { userId: 'u1', da: '2026-09-01', a: '2026-09-30' });
  assert.deepEqual(out.perCliente, [
    { clienteId: 'c1', clienteNome: 'Acme', giornate: 1.5, ore: 0, workLogIds: ['w1', 'w2'] },
    { clienteId: 'c2', clienteNome: 'Beta', giornate: 0, ore: 3, workLogIds: ['w3'] },
    { clienteId: '__vacation__', clienteNome: 'Ferie', speciale: true, giornate: 1, ore: 0, workLogIds: ['w4'] },
  ]);
  assert.deepEqual(out.periodo, { da: '2026-09-01', a: '2026-09-30' });
  assert.deepEqual(out.totale, { giornate: 2.5, ore: 3 });
  for (const row of out.perCliente as Record<string, unknown>[]) {
    for (const key of Object.keys(row)) assert.ok(!/importo|tariffa|rate|amount|fattura/i.test(key), `no amounts: ${key}`);
  }
});

test('list_proposals and get_proposal expose expiry and fail on unknown ids', async () => {
  const { ctx } = await setup([pending('a', 'u1', NOW), pending('b', 'u1', OLD)]);
  const out = await ok(ctx, 'list_proposals', { userId: 'u1', status: 'expired' });
  assert.deepEqual((out.proposals as { id: string }[]).map((p) => p.id), ['b']);
  assert.equal(((await ok(ctx, 'get_proposal', { proposalId: 'a' })).proposal as { status: string }).status, 'pending');
  assert.equal((await fails(ctx, 'get_proposal', { proposalId: 'zz' })).code, 'NOT_FOUND');
});

test('propose_work_log writes a pending proposal with the fixed message and client', async () => {
  const { fs, ctx } = await setup();
  const out = await ok(ctx, 'propose_work_log', { userId: 'u1', clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1, motivazione: 'ieri' });
  assert.equal(out.messaggio, "In attesa di conferma nell'app Pivella.");
  const p = out.proposal as Proposal;
  assert.equal(p.status, 'pending');
  assert.equal(p.kind, 'workLog');
  assert.deepEqual(p.payload, { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1 });
  assert.equal(p.motivazione, 'ieri');
  assert.deepEqual(p.createdBy, { writerId: 'mcp-1', client: 'test-client' });
  assert.deepEqual(parsedFile(fs).proposals.map((x) => x.id), [p.id]);
});

test('propose_work_log rejects a bad payload without writing', async () => {
  const { fs, ctx } = await setup();
  const err = await fails(ctx, 'propose_work_log', { userId: 'u1', clienteId: 'zz', data: '2026-09-10', tipo: 'giornata', quantita: 1 });
  assert.equal(err.code, 'VALIDATION');
  assert.deepEqual((err.details?.fields as { field: string }[]).map((f) => f.field), ['clienteId']);
  assert.equal(parsedFile(fs).proposals.length, 0);
});

test('propose_fattura returns an anteprima and never accepts a numero', async () => {
  const { ctx } = await setup();
  const righe = [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500 }];
  const out = await ok(ctx, 'propose_fattura', { userId: 'u1', clienteId: 'c1', data: '2026-09-10', righe, valuta: 'GBP', tassoCambio: 0.8 });
  assert.deepEqual(out.anteprima, { totaleImponibile: 1000, totaleEUR: 1250, righe: [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500, totale: 1000 }] });
  const p = out.proposal as Proposal;
  assert.equal(p.kind, 'fattura');
  assert.equal('numero' in p.payload, false);
  assert.equal((await fails(ctx, 'propose_fattura', { userId: 'u1', clienteId: 'c1', data: '2026-09-10', righe, numero: '07' })).code, 'VALIDATION');
  const noEmittente = await fails(ctx, 'propose_fattura', { userId: 'u2', clienteId: 'c9', data: '2026-09-10', righe });
  assert.deepEqual((noEmittente.details?.fields as { field: string }[]).map((f) => f.field), ['emittente']);
});

test('propose_cliente rejects duplicates with the existing id', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'propose_cliente', { userId: 'u1', nome: 'Gamma', rate: 300, billingUnit: 'ore' });
  assert.deepEqual((out.proposal as Proposal).payload, { nome: 'Gamma', rate: 300, billingUnit: 'ore', nazione: 'IT' });
  const dup = await fails(ctx, 'propose_cliente', { userId: 'u1', nome: 'ACME ' });
  assert.equal(dup.code, 'VALIDATION');
  assert.equal(dup.details?.clienteEsistenteId, 'c1');
});

test('propose_incasso follows the app semantics of incassato', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'propose_incasso', { userId: 'u1', fatturaId: 'f2', dataIncasso: '2026-09-10' });
  assert.equal((out.proposal as Proposal).kind, 'incasso');
  assert.equal((await fails(ctx, 'propose_incasso', { userId: 'u1', fatturaId: 'f1', dataIncasso: '2026-09-10' })).code, 'VALIDATION');
  assert.equal((await fails(ctx, 'propose_incasso', { userId: 'u1', fatturaId: 'f9', dataIncasso: '2026-09-10' })).code, 'NOT_FOUND');
  assert.equal((await fails(ctx, 'propose_incasso', { userId: 'u1', fatturaId: 'f2', dataIncasso: '2026-03-09' })).code, 'VALIDATION');
});

test('propose_scadenza_pagata accepts unpaid deadlines only', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'propose_scadenza_pagata', { userId: 'u1', scadenzaId: 's1', dataPagamento: '2026-06-30' });
  assert.equal((out.proposal as Proposal).kind, 'scadenzaPagata');
  assert.equal((await fails(ctx, 'propose_scadenza_pagata', { userId: 'u1', scadenzaId: 's2', dataPagamento: '2026-06-30' })).code, 'VALIDATION');
  assert.equal((await fails(ctx, 'propose_scadenza_pagata', { userId: 'u1', scadenzaId: 'zz', dataPagamento: '2026-06-30' })).code, 'NOT_FOUND');
});

test('motivazione longer than 500 characters is rejected', async () => {
  const { ctx } = await setup();
  const err = await fails(ctx, 'propose_scadenza_pagata', { userId: 'u1', scadenzaId: 's1', dataPagamento: '2026-06-30', motivazione: 'x'.repeat(501) });
  assert.equal(err.code, 'VALIDATION');
});

test('withdraw_proposal withdraws pending proposals and reports the rest', async () => {
  const { fs, ctx } = await setup([pending('a', 'u1', NOW), pending('b', 'u1', OLD)]);
  const out = await ok(ctx, 'withdraw_proposal', { proposalId: 'a' });
  assert.equal((out.proposal as Proposal).status, 'withdrawn');
  assert.equal(parsedFile(fs).proposals.find((p) => p.id === 'a')?.status, 'withdrawn');
  assert.equal((await fails(ctx, 'withdraw_proposal', { proposalId: 'b' })).code, 'PROPOSAL_NOT_PENDING');
  assert.equal((await fails(ctx, 'withdraw_proposal', { proposalId: 'zz' })).code, 'NOT_FOUND');
});

test('a missing sync file is SOURCE_UNAVAILABLE for every tool', async () => {
  const ds = new FileDataSource(memoryFileSystem(), { writerId: 'mcp-1' });
  const ctx: ToolContext = { ds, principal: { kind: 'local', writerId: 'mcp-1' }, now: () => new Date(NOW) };
  assert.equal((await fails(ctx, 'list_users', {})).code, 'SOURCE_UNAVAILABLE');
  assert.equal((await fails(ctx, 'withdraw_proposal', { proposalId: 'a' })).code, 'SOURCE_UNAVAILABLE');
});
