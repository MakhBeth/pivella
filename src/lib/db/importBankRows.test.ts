import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBManager } from './IndexedDBManager';
import { importBankRows } from './importBankRows';
import { previewBankCsv } from '../utils/bankCsv';
import { parseSyncFile, serializeSnapshot, createEmptySnapshot } from '../sync/schema';
import { mergeSnapshots } from '../sync/merge';
import { DB_NAME } from '../constants/fiscali';
import type { BankCsvFormat } from '../../types';
const format: BankCsvFormat = { id: 'fmt', userId: 'u', name: 'Bank', delimiter: ';', encoding: 'utf-8', headerRow: 1, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', amountMode: 'signed', columns: { date: 'Data', description: 'Descrizione', amount: 'Importo' } };
const rows = previewBankCsv('Data;Descrizione;Importo\n17/10/2026;Bonifico;100\n18/10/2026;Spesa;-20', format, 'Conto', 'file.csv').rows;
const stamp = { now: '2026-10-17T12:00:00.000Z', writer: { id: 'app-test', kind: 'app' as const } };

test('v3 database upgrades without losing records, bank stores persist across restart', async () => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const req = factory.open(DB_NAME, 3);
    req.onupgradeneeded = () => { for (const name of ['config', 'clienti', 'fatture', 'workLogs', 'scadenze', 'users']) req.result.createObjectStore(name, { keyPath: 'id' }); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('clienti', 'readwrite'); tx.objectStore('clienti').put({ id: 'old', userId: 'u', nome: 'Cliente' });
      tx.oncomplete = () => { req.result.close(); resolve(); };
    };
  });
  const db = new IndexedDBManager({ factory }); await db.init();
  assert.equal((await db.get('clienti', 'old')).nome, 'Cliente');
  await db.put('bankFormats', format); await importBankRows(db, 'u', rows); db.close();
  const reopened = new IndexedDBManager({ factory }); await reopened.init();
  assert.equal((await reopened.getAll('bankTransactions')).length, 2);
  assert.equal((await reopened.getAll('bankFormats')).length, 1); reopened.close();
});
test('concurrent imports skip duplicates and isolate profiles', async () => {
  const db = new IndexedDBManager({ factory: new IDBFactory() }); await db.init();
  const result = await Promise.all([importBankRows(db, 'u', rows), importBankRows(db, 'u', rows)]);
  assert.equal(result.flat().length, 2);
  assert.equal((await importBankRows(db, 'u', rows)).length, 0);
  assert.equal((await importBankRows(db, 'other', rows)).length, 2);
  assert.equal((await db.getAllForUser('bankTransactions', 'u')).length, 2);
  db.close();
});
test('bank data round-trips through snapshots, backups and merge; IDs match on separate devices', async () => {
  const a = new IndexedDBManager({ factory: new IDBFactory() }); const b = new IndexedDBManager({ factory: new IDBFactory() });
  await a.init(); await b.init(); await a.put('bankFormats', format);
  await importBankRows(a, 'u', rows); await importBankRows(b, 'u', rows);
  const snapshot = parseSyncFile(serializeSnapshot(await a.exportSnapshot()), stamp).snapshot;
  const merged = mergeSnapshots(snapshot, await b.exportSnapshot(), stamp);
  assert.equal(merged.snapshot.bankTransactions.length, 2);
  await b.restoreFromSnapshot(snapshot);
  assert.deepEqual(await b.getAll('bankFormats'), await a.getAll('bankFormats'));
  assert.equal((await b.exportForUser('u')).bankTransactions.length, 2);
  a.close(); b.close();
});
test('older sync schemas get empty bank stores; v4 requires and validates them', () => {
  for (const version of [2, 3]) {
    const old: Record<string, unknown> = { ...createEmptySnapshot(stamp), schemaVersion: version };
    delete old.bankFormats; delete old.bankTransactions;
    const result = parseSyncFile(JSON.stringify(old), stamp).snapshot;
    assert.deepEqual(result.bankFormats, []); assert.deepEqual(result.bankTransactions, []); assert.equal(result.schemaVersion, 4);
  }
  const missing: Record<string, unknown> = { ...createEmptySnapshot(stamp) }; delete missing.bankTransactions;
  assert.throws(() => parseSyncFile(JSON.stringify(missing), stamp), /bankTransactions/);
  const malformed = createEmptySnapshot(stamp); malformed.bankFormats.push({ ...format, columns: { date: '', description: '' } });
  assert.throws(() => parseSyncFile(serializeSnapshot(malformed), stamp), /Mappa/);
});
