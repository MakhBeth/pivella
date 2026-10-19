import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBManager } from './IndexedDBManager';
import { allocateBankReceipt } from './linkBankReceipt';
import { cashflowProjection, expectedReceipts, cashflowPreset } from '../utils/cashflow';
import { invoiceReceipts, remainingCents, collectedInvoices } from '../utils/receipts';
import { parseSyncFile, serializeSnapshot } from '../sync/schema';
import { calcolaFiscaleAnno } from '../utils/accantonamento';
import { DEFAULT_CONFIG } from '../constants/fiscali';
import type { BankTransaction, Fattura } from '../../types';
const invoice: Fattura = { id: 'invoice', userId: 'u', clienteId: 'c', clienteNome: 'Cliente', data: '2026-09-01', importo: 100, incassato: false, dataIncassoPrevista: '2027-01-10' };
const transaction: BankTransaction = { id: 'bank', userId: 'u', account: 'Main', date: '2026-10-18', amountCents: 10000, description: 'Bonifico', importKey: 'key', sourceFile: 'bank.csv', formatId: 'fmt' };
const stamp = { now: '2026-10-18T12:00:00.000Z', writer: { id: 'test', kind: 'app' as const } };
async function setup() {
  const db = new IndexedDBManager({ factory: new IDBFactory() }); await db.init();
  await db.put('fatture', invoice); await db.put('bankTransactions', transaction); return db;
}
test('partial payment and next-year balance keep dated fiscal receipts and project only residual', async () => {
  const db = await setup();
  try {
    let [saved] = await allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'invoice', amountCents: 4000 }]);
    assert.equal(saved.incassato, false); assert.equal(remainingCents(saved), 6000);
    assert.equal(collectedInvoices([saved], 2026)[0].importo, 40);
    assert.equal(calcolaFiscaleAnno({ ...DEFAULT_CONFIG, userId: 'u' }, 2026, [saved], []).fatturato, 40);
    assert.equal(cashflowProjection([], [saved])[0].expected, 6000);
    await db.put('bankTransactions', { ...transaction, id: 'balance', date: '2027-01-10', amountCents: 6000 });
    [saved] = await allocateBankReceipt(db, 'u', 'balance', [{ invoiceId: 'invoice', amountCents: 6000 }]);
    assert.equal(saved.incassato, true); assert.equal(saved.dataIncasso, '2027-01-10');
    assert.equal(collectedInvoices([saved], 2026)[0].importo, 40);
    assert.equal(collectedInvoices([saved], 2027)[0].importo, 60);
    assert.deepEqual(expectedReceipts([saved]), []);
    const snapshot = parseSyncFile(serializeSnapshot(await db.exportSnapshot()), stamp).snapshot;
    await db.restoreFromSnapshot(snapshot);
    assert.deepEqual((await db.get('fatture', invoice.id)).receipts, saved.receipts);
  } finally { db.close(); }
});
test('cumulative payment is atomic; editing or removing quotas reopens the right residual', async () => {
  const db = await setup();
  try {
    await db.put('fatture', { ...invoice, id: 'second', importo: 80 });
    await allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'invoice', amountCents: 4000 }, { invoiceId: 'second', amountCents: 6000 }]);
    assert.equal(remainingCents(await db.get('fatture', 'invoice')), 6000);
    assert.equal(remainingCents(await db.get('fatture', 'second')), 2000);
    const before = await db.getAll('fatture');
    await assert.rejects(allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'invoice', amountCents: 5000 }, { invoiceId: 'second', amountCents: 6000 }]), /supera/);
    assert.deepEqual(await db.getAll('fatture'), before);
    await allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'second', amountCents: 8000 }]);
    assert.equal(remainingCents(await db.get('fatture', 'invoice')), 10000);
    assert.equal(remainingCents(await db.get('fatture', 'second')), 0);
    await allocateBankReceipt(db, 'u', 'bank', []);
    assert.equal(remainingCents(await db.get('fatture', 'second')), 8000);
  } finally { db.close(); }
});
test('reject invalid, foreign, outgoing, duplicate, excessive quotas without partial writes', async () => {
  const db = await setup();
  try {
    await assert.rejects(allocateBankReceipt(db, 'other', 'bank', []), /non disponibile/);
    await assert.rejects(allocateBankReceipt(db, 'u', 'missing', []), /non disponibile/);
    for (const amountCents of [-1, 0, NaN, 1.5, 10001]) await assert.rejects(allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'invoice', amountCents }]));
    await assert.rejects(allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'invoice', amountCents: 1 }, { invoiceId: 'invoice', amountCents: 1 }]), /ripetuta/);
    await db.put('fatture', { ...invoice, id: 'foreign', userId: 'other' });
    await assert.rejects(allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'foreign', amountCents: 1 }]), /non disponibile/);
    await db.put('bankTransactions', { ...transaction, amountCents: -10000 });
    await assert.rejects(allocateBankReceipt(db, 'u', 'bank', []), /entrata/);
    assert.equal((await db.get('fatture', invoice.id)).incassato, false);
  } finally { db.close(); }
});
test('concurrent movements cannot overpay the same invoice', async () => {
  const db = await setup();
  try {
    await db.put('bankTransactions', { ...transaction, id: 'bank2' });
    const results = await Promise.allSettled(['bank', 'bank2'].map(id => allocateBankReceipt(db, 'u', id, [{ invoiceId: 'invoice', amountCents: 7000 }])));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(remainingCents(await db.get('fatture', 'invoice')), 3000);
  } finally { db.close(); }
});
test('legacy bank links can be repartitioned; paid manual invoices cannot be counted twice', async () => {
  const db = await setup();
  try {
    await db.put('fatture', { ...invoice, incassato: true, bankTransactionId: 'bank', dataIncasso: transaction.date });
    const [saved] = await allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'invoice', amountCents: 3000 }]);
    assert.equal(invoiceReceipts(saved).length, 1); assert.equal(remainingCents(saved), 7000);
    assert.equal(saved.bankTransactionId, undefined);
    await db.put('fatture', { ...invoice, id: 'manual', incassato: true });
    await assert.rejects(allocateBankReceipt(db, 'u', 'bank', [{ invoiceId: 'manual', amountCents: 100 }]), /residuo/);
  } finally { db.close(); }
});
test('date range is inclusive, excludes partial boundary months and fills empty months', () => {
  const rows = cashflowProjection([
    transaction,
    { ...transaction, id: 'before', date: '2026-10-17' },
    { ...transaction, id: 'last', date: '2027-01-10', amountCents: -250 },
    { ...transaction, id: 'after', date: '2027-01-11' },
  ], [invoice, { ...invoice, id: 'undated', dataIncassoPrevista: undefined }, { ...invoice, id: 'legacy', incassato: undefined }], { from: '2026-10-18', to: '2027-01-10' });
  assert.deepEqual(rows, [
    { month: '2026-10', incoming: 10000, outgoing: 0, expected: 0 },
    { month: '2026-11', incoming: 0, outgoing: 0, expected: 0 },
    { month: '2026-12', incoming: 0, outgoing: 0, expected: 0 },
    { month: '2027-01', incoming: 0, outgoing: 250, expected: 10000 },
  ]);
  assert.deepEqual(cashflowProjection([transaction], [invoice], { from: '2027-01-10', to: '2026-01-01' }), []);
  assert.equal(cashflowProjection([transaction], [], { from: '', to: '2026-10-18' })[0].incoming, 10000);
});
test('one-year presets use local dates and clamp leap days', () => {
  const today = new Date(2024, 1, 29, 12);
  assert.deepEqual(cashflowPreset('both', today), { from: '2023-02-28', to: '2025-02-28' });
  assert.deepEqual(cashflowPreset('past', today), { from: '2023-02-28', to: '2024-02-29' });
  assert.deepEqual(cashflowPreset('future', today), { from: '2024-02-29', to: '2025-02-28' });
});
test('sync rejects malformed receipt arrays and excessive invoice totals', async () => {
  const db = await setup();
  try {
    const snapshot = await db.exportSnapshot();
    for (const receipts of [[{ amountCents: 10001, date: '2026-10-18' }], [{ amountCents: 1, date: 'bad' }], [{ amountCents: 0, date: '2026-10-18' }]]) {
      snapshot.fatture = [{ ...invoice, receipts }];
      assert.throws(() => parseSyncFile(serializeSnapshot(snapshot), stamp), /incass/);
    }
  } finally { db.close(); }
});

test('unbounded chart periods retain zero months between sparse movements', () => {
  const rows = cashflowProjection([transaction, { ...transaction, date: '2027-01-01' }], [], { from: '', to: '' });
  assert.deepEqual(rows.map(r => r.month), ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.equal(rows[1].incoming, 0);
});
