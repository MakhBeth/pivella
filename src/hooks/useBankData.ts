import { invoiceReceipts } from '../lib/utils/receipts';
import { importBankRows } from '../lib/db/importBankRows';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BankCsvFormat, BankTransaction } from '../types';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';
import { validateBankFormat, type BankImportRow } from '../lib/utils/bankCsv';

export function useBankData(db: IndexedDBManager, ready: boolean, userId: string | null) {
  const [bankFormats, setBankFormats] = useState<BankCsvFormat[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const activeUser = useRef(userId);
  activeUser.current = userId;
  useEffect(() => {
    let cancelled = false;
    setBankFormats([]); setBankTransactions([]);
    if (ready && userId) {
      Promise.all([db.getAllForUser('bankFormats', userId), db.getAllForUser('bankTransactions', userId)])
        .then(([formats, transactions]) => { if (!cancelled) { setBankFormats(formats); setBankTransactions(transactions); } })
        .catch(console.error);
    }
    return () => { cancelled = true; };
  }, [db, ready, userId]);

  const saveBankFormat = useCallback(async (format: BankCsvFormat) => {
    if (!userId || !ready || format.userId !== userId) throw new Error('Profilo non disponibile.');
    validateBankFormat(format);
    const saved = db.stamp(format);
    await db.put('bankFormats', saved);
    if (activeUser.current === userId) setBankFormats(prev => [...prev.filter(f => f.id !== saved.id), saved]);
  }, [db, ready, userId]);

  const removeBankFormat = useCallback(async (id: string) => {
    const record = await db.get('bankFormats', id);
    if (!userId || record?.userId !== userId) throw new Error('Formato non disponibile.');
    await db.delete('bankFormats', id);
    if (activeUser.current === userId) setBankFormats(prev => prev.filter(f => f.id !== id));
  }, [db, userId]);

  const importBankTransactions = useCallback(async (rows: BankImportRow[]) => {
    if (!userId || !db.db || !ready) throw new Error('Profilo non disponibile.');
    const saved = await importBankRows(db, userId, rows);
    if (activeUser.current === userId) {
      const all = await db.getAllForUser('bankTransactions', userId);
      if (activeUser.current === userId) setBankTransactions(all);
    }
    return { imported: saved.length, skipped: rows.length - saved.length };
  }, [db, ready, userId]);

  const removeBankTransaction = useCallback(async (id: string) => {
    const record = await db.get('bankTransactions', id);
    if (!userId || record?.userId !== userId) throw new Error('Movimento non disponibile.');
    const invoices = await db.getAllForUser('fatture', userId);
    if (invoices.some(f => invoiceReceipts(f).some(r => r.bankTransactionId === id))) throw new Error('Scollega prima la fattura associata al movimento.');
    await db.delete('bankTransactions', id);
    if (activeUser.current === userId) setBankTransactions(prev => prev.filter(t => t.id !== id));
  }, [db, userId]);

  return { bankFormats, setBankFormats, bankTransactions, setBankTransactions, saveBankFormat, removeBankFormat, importBankTransactions, removeBankTransaction };
}
