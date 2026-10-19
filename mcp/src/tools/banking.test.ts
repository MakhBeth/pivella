import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BankCsvFormat, BankTransaction } from '../../../src/types';
import { createEmptySnapshot, parseSyncFile, type Proposal } from '../../../src/lib/sync/schema';
import { SYNC_FILENAME } from '../../../src/lib/sync/backup';
import { memoryFileSystem, text, fromBytes } from '../../../src/lib/sync/testing/memoryFileSystem';
import { bankFormatPayload, BANK_CSV_MAX_BYTES } from '../../../src/lib/sync/bankProposals';
import { previewBankCsv } from '../../../src/lib/utils/bankCsv';
import { IndexedDBManager } from '../../../src/lib/db/IndexedDBManager';
import { importBankRows } from '../../../src/lib/db/importBankRows';
import { decideProposal } from '../../../src/lib/sync/proposalFlow';
import { FileDataSource } from '../fileDataSource';
import { createServer } from '../server';
import { TOOLS, runTool, type ToolContext } from './index';

const NOW = '2026-10-18T12:00:00.000Z';
const stamp = { now: NOW, writer: { id: 'app', kind: 'app' as const } };
const format: BankCsvFormat = { id: 'fmt', userId: 'u1', name: 'Banca', delimiter: ';', encoding: 'utf-8', headerRow: 1, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', amountMode: 'signed', columns: { date: 'Data', description: 'Descrizione', amount: 'Importo', reference: 'ID' } };
const csv = 'Data;Descrizione;Importo;ID\n16/10/2026;Bonifico;1.250,50;A\n17/10/2026;Commissioni;-2,50;B';
const args = { userId: 'u1', formatId: 'fmt', account: 'Conto', sourceFile: 'conto.csv', csv };

async function setup() {
  const fs = memoryFileSystem({ withMove: true });
  const initial = createEmptySnapshot(stamp);
  initial.users.push({ id: 'u1', nome: 'Uno', createdAt: NOW }, { id: 'u2', nome: 'Due', createdAt: NOW });
  initial.bankFormats.push(format, { ...format, id: 'foreign', userId: 'u2' });
  const row = previewBankCsv(csv, format, 'Conto', 'conto.csv').rows[0];
  initial.bankTransactions.push({ ...row, id: 'existing', userId: 'u1' }, { ...row, id: 'foreign-transaction', userId: 'u2', amountCents: 999999 });
  await fs.write(SYNC_FILENAME, text(JSON.stringify(initial)));
  const ds = new FileDataSource(fs, { writerId: 'mcp-test', now: () => new Date(NOW), lock: { sleep: async () => {}, timeoutMs: 0 } });
  const ctx: ToolContext = { ds, principal: { kind: 'local', writerId: 'mcp-test' }, now: () => new Date(NOW) };
  const call = (name: string, input: unknown) => runTool(TOOLS.find(t => t.name === name)!, ctx, input);
  const read = async () => parseSyncFile(fromBytes(await fs.read(SYNC_FILENAME))!, stamp).snapshot;
  const db = new IndexedDBManager({ factory: new IDBFactory(), now: () => NOW });
  await db.init();
  // The file contents serve as a generation token for this in-memory test source.
  const source = { fs, lastModified: async () => fromBytes(await fs.read(SYNC_FILENAME)) };
  const decide = (id: string, kind: 'apply' | 'reject' = 'apply') => decideProposal({ db, source, writer: { id: db.writerId!, kind: 'app' }, proposalId: id, decision: { kind }, now: () => new Date(NOW) });
  return { fs, ds, ctx, call, read, db, decide };
}

async function proposalFrom(result: Awaited<ReturnType<typeof runTool>>): Promise<Proposal> {
  assert.equal(result.isError, false, result.text);
  return result.structured!.proposal as Proposal;
}

test('banking tools are callable through MCP transport and isolate profiles', async () => {
  const { ds, db } = await setup();
  const server = createServer(ds, { writerId: 'mcp-test', version: '1.3.0', now: () => new Date(NOW) });
  const client = new Client({ name: 'banking-test', version: '1.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const formats = await client.callTool({ name: 'list_bank_formats', arguments: { userId: 'u1' } });
    assert.equal(formats.isError ?? false, false);
    assert.equal((formats.structuredContent as Record<string, unknown>)?.total, 1);
    assert.equal(((formats.structuredContent as Record<string, unknown>)?.formats as BankCsvFormat[])[0].id, 'fmt');
    const transactions = await client.callTool({ name: 'list_bank_transactions', arguments: { userId: 'u1' } });
    assert.equal((transactions.structuredContent as Record<string, unknown>)?.total, 1);
    assert.deepEqual((transactions.structuredContent as Record<string, unknown>)?.totali, { valuta: 'EUR', entrate: 1250.5, uscite: 0, netto: 1250.5 });
  } finally { await client.close(); await server.close(); db.close(); }
});

test('preview paginates, reports duplicates and totals for all new rows without writes', async () => {
  const { fs, call, db } = await setup();
  try {
    const before = fromBytes(await fs.read(SYNC_FILENAME));
    const out = await call('preview_bank_import', { ...args, limit: 1 });
    assert.equal(out.isError, false, out.text);
    assert.equal(out.structured!.total, 2);
    assert.equal(out.structured!.hasMore, true);
    assert.equal(out.structured!.newCount, 1);
    assert.equal(out.structured!.duplicateCount, 1);
    assert.deepEqual(out.structured!.totaliNuovi, { valuta: 'EUR', entrate: 0, uscite: 2.5, netto: -2.5 });
    assert.equal(fromBytes(await fs.read(SYNC_FILENAME)), before);
  } finally { db.close(); }
});

test('format proposals become usable only after app confirmation', async () => {
  const { call, read, db, decide } = await setup();
  try {
    const proposed = await proposalFrom(await call('propose_bank_format', { userId: 'u1', ...bankFormatPayload({ ...format, name: 'Nuova banca' }) }));
    assert.equal((await read()).bankFormats.length, 2);
    const outcome = await decide(proposed.id);
    assert.equal(outcome.proposal.status, 'applied');
    const saved = await db.get('bankFormats', outcome.proposal.result!.recordId);
    assert.equal(saved.name, 'Nuova banca'); assert.equal(saved.userId, 'u1');
    assert.equal((await read()).bankFormats.length, 3);
  } finally { db.close(); }
});

test('import proposal preserves stores until confirmation, then deduplicates and publishes result', async () => {
  const { call, read, db, decide } = await setup();
  try {
    const proposed = await proposalFrom(await call('propose_bank_import', args));
    assert.equal((await read()).bankTransactions.length, 2);
    const outcome = await decide(proposed.id);
    assert.equal(outcome.proposal.status, 'applied');
    assert.equal(outcome.proposal.result!.imported, 1);
    assert.equal(outcome.proposal.result!.skipped, 1);
    const all: BankTransaction[] = await db.getAllForUser('bankTransactions', 'u1');
    assert.equal(all.length, 2);
    assert.equal(all.find(t => t.reference === 'B')!.amountCents, -250);
    assert.equal((await read()).bankTransactions.length, 3);
    assert.equal((await read()).fatture.length, 0);
    const listed = await call('list_bank_transactions', { userId: 'u1', limit: 1, account: 'conto', da: '2026-10-16', a: '2026-10-17' });
    assert.equal(listed.structured!.total, 2);
    assert.equal(listed.structured!.hasMore, true);
    assert.deepEqual(listed.structured!.totali, { valuta: 'EUR', entrate: 1250.5, uscite: 2.5, netto: 1248 });
    const out = await call('list_bank_transactions', { userId: 'u1', direction: 'out' });
    assert.equal(out.structured!.total, 1);
    assert.equal((await call('propose_bank_import', args)).error?.code, 'VALIDATION');
  } finally { db.close(); }
});

test('duplicate check runs again at confirmation, including manual imports made in the meantime', async () => {
  const { call, read, db, decide } = await setup();
  try {
    const proposed = await proposalFrom(await call('propose_bank_import', args));
    await importBankRows(db, 'u1', previewBankCsv(csv, format, 'Conto', 'other-name.csv').rows.slice(1));
    const outcome = await decide(proposed.id);
    assert.equal(outcome.proposal.result!.imported, 0);
    assert.equal(outcome.proposal.result!.skipped, 2);
    assert.equal((await read()).bankTransactions.filter(t => t.userId === 'u1').length, 2);
  } finally { db.close(); }
});

test('changed or deleted format blocks confirmation and keeps the proposal pending', async () => {
  for (const change of ['edit', 'delete']) {
    const { call, read, fs, db, decide } = await setup();
    try {
      const proposed = await proposalFrom(await call('propose_bank_import', args));
      const snapshot = await read();
      if (change === 'edit') snapshot.bankFormats[0].decimalSeparator = '.';
      else snapshot.bankFormats = snapshot.bankFormats.filter(f => f.id !== format.id);
      await fs.write(SYNC_FILENAME, text(JSON.stringify(snapshot)));
      await assert.rejects(decide(proposed.id), /formato|Formato/);
      assert.equal((await read()).proposals[0].status, 'pending');
      assert.equal((await read()).bankTransactions.length, 2);
    } finally { db.close(); }
  }
});

test('invalid rows, foreign formats, oversized files and extra fields never create proposals', async () => {
  const { call, read, db } = await setup();
  try {
    for (const input of [
      { ...args, csv: csv + '\n31/02/2026;Errata;10;C' },
      { ...args, formatId: 'foreign' },
      { ...args, csv: 'x'.repeat(BANK_CSV_MAX_BYTES + 1) },
      { ...args, csv: 'Data;Descrizione;Importo;ID\n17/10/2026;X;50000000000000,00;X\n17/10/2026;Y;50000000000000,00;Y' },
      { ...args, csv: 'Data;Descrizione;Importo;ID\n' + Array.from({ length: 1001 }, (_, i) => `17/10/2026;X;10;R${i}`).join('\n') },
      { ...args, userId: 'u2', formatId: 'fmt' },
      { ...args, rows: [] },
    ]) assert.equal((await call('propose_bank_import', input)).isError, true);
    assert.equal((await read()).proposals.length, 0);
    assert.equal((await read()).bankTransactions.length, 2);
    assert.equal((await call('list_bank_transactions', { userId: 'u1', da: '2026-10-18', a: '2026-10-01' })).error?.code, 'VALIDATION');
  } finally { db.close(); }
});

test('rejecting a banking proposal leaves bank records unchanged', async () => {
  const { call, read, db, decide } = await setup();
  try {
    const proposed = await proposalFrom(await call('propose_bank_import', args));
    const before = (await read()).bankTransactions;
    assert.equal((await decide(proposed.id, 'reject')).proposal.status, 'rejected');
    assert.deepEqual((await read()).bankTransactions, before);
  } finally { db.close(); }
});
