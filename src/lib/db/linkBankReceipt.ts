import type { BankTransaction, Fattura } from '../../types';
import { invoiceReceipts, withReceipts } from '../utils/receipts';
import type { IndexedDBManager } from './IndexedDBManager';

export interface ReceiptAllocation { invoiceId: string; amountCents: number }

/** Replace all allocations for one bank movement atomically; concurrent tabs cannot overspend it. */
export async function allocateBankReceipt(db: IndexedDBManager, userId: string, transactionId: string, allocations: ReceiptAllocation[]): Promise<Fattura[]> {
  if (!db.db || !userId) throw new Error('Database o profilo non disponibile.');
  return new Promise((resolve, reject) => {
    const tx = db.db!.transaction(['fatture', 'bankTransactions'], 'readwrite');
    const saved: Fattura[] = [];
    let failure: Error | undefined;
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Collegamento annullato.'));
    const bankRequest = tx.objectStore('bankTransactions').get(transactionId);
    bankRequest.onsuccess = () => {
      const invoices = tx.objectStore('fatture').getAll();
      invoices.onsuccess = () => {
        try {
          const t = bankRequest.result as BankTransaction | undefined;
          const all = (invoices.result as Fattura[]).filter(f => f.userId === userId);
          if (!t || t.userId !== userId) throw new Error('Movimento non disponibile.');
          if (t.amountCents <= 0) throw new Error('Puoi collegare solo movimenti in entrata.');
          const ids = new Set<string>();
          let total = 0;
          for (const a of allocations) {
            if (ids.has(a.invoiceId)) throw new Error('Fattura ripetuta nella ripartizione.');
            ids.add(a.invoiceId);
            if (!Number.isSafeInteger(a.amountCents) || a.amountCents <= 0) throw new Error('Inserisci importi positivi con al massimo due decimali.');
            total += a.amountCents;
            if (!Number.isSafeInteger(total) || total > t.amountCents) throw new Error('La ripartizione supera l’importo del movimento.');
            const f = all.find(f => f.id === a.invoiceId);
            if (!f) throw new Error('Fattura non disponibile.');
            const otherReceipts = invoiceReceipts(f).filter(r => r.bankTransactionId !== t.id);
            if (otherReceipts.reduce((sum, r) => sum + r.amountCents, a.amountCents) > Math.round(f.importo * 100)) throw new Error(`La quota supera il residuo della fattura ${f.numero || f.id}.`);
          }
          for (const f of all) {
            const original = invoiceReceipts(f);
            if (!ids.has(f.id) && !original.some(r => r.bankTransactionId === t.id)) continue;
            const receipts = original.filter(r => r.bankTransactionId !== t.id);
            const a = allocations.find(a => a.invoiceId === f.id);
            if (a) receipts.push({ amountCents: a.amountCents, date: t.date, bankTransactionId: t.id });
            const record = db.stamp(withReceipts(f, receipts));
            tx.objectStore('fatture').put(record); saved.push(record);
          }
        } catch (error) { failure = error as Error; tx.abort(); }
      };
    };
  });
}

