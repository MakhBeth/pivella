import type { BankTransaction } from '../../types';
import type { BankImportRow } from '../utils/bankCsv';
import type { IndexedDBManager } from './IndexedDBManager';

export async function bankTransactionId(userId: string, importKey: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([userId, importKey])));
  return 'bank_' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

export async function importBankRows(db: IndexedDBManager, userId: string, rows: BankImportRow[]): Promise<BankTransaction[]> {
  if (!db.db || !userId) throw new Error('Database o profilo non disponibile.');
  // Stable identities also avoid duplicates when two devices import the same document.
  const ids = new Map(await Promise.all(rows.map(async row =>
    [row.importKey, await bankTransactionId(userId, row.importKey)] as const,
  )));
  // One transaction: duplicates are checked against committed data, including other tabs.
  return await new Promise<BankTransaction[]>((resolve, reject) => {
    const tx = db.db!.transaction('bankTransactions', 'readwrite');
    const store = tx.objectStore('bankTransactions');
    const added: BankTransaction[] = [];
    tx.oncomplete = () => resolve(added);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Importazione annullata.'));
    const req = store.getAll();
    req.onsuccess = () => {
      const keys = new Set((req.result as BankTransaction[]).filter(t => t.userId === userId).map(t => t.importKey));
      for (const row of rows) {
        if (keys.has(row.importKey)) continue;
        keys.add(row.importKey);
        const record = db.stamp({ ...row, id: ids.get(row.importKey)!, userId });
        store.add(record); added.push(record);
      }
    };
  });
}
