import type { Fattura, InvoiceReceipt } from '../../types';

/** Explicit receipts are authoritative; legacy paid invoices retain their original semantics. */
export function invoiceReceipts(f: Fattura): InvoiceReceipt[] {
  return f.receipts ?? (f.incassato === false ? [] : [{ amountCents: Math.round(f.importo * 100), date: f.dataIncasso || f.data, ...(f.bankTransactionId ? { bankTransactionId: f.bankTransactionId } : {}) }]);
}
export function receivedCents(f: Fattura): number {
  return invoiceReceipts(f).reduce((sum, r) => sum + r.amountCents, 0);
}
export function remainingCents(f: Fattura): number {
  return Math.max(0, Math.round(f.importo * 100) - receivedCents(f));
}
export function withReceipts(f: Fattura, receipts: InvoiceReceipt[]): Fattura {
  const total = receipts.reduce((sum, r) => sum + r.amountCents, 0);
  const date = receipts.map(r => r.date).sort().slice(-1)[0];
  return { ...f, receipts, bankTransactionId: undefined, incassato: total >= Math.round(f.importo * 100), dataIncasso: date };
}
/** One row per invoice, importo is only the amount actually received in the requested period. */
export function collectedInvoices(fatture: readonly Fattura[], year: number, month?: number): Fattura[] {
  const prefix = `${year}${month === undefined ? '' : `-${String(month + 1).padStart(2, '0')}`}`;
  return fatture.flatMap(f => {
    const receipts = invoiceReceipts(f).filter(r => r.date.startsWith(prefix));
    return receipts.length ? [{ ...f, importo: receipts.reduce((sum, r) => sum + r.amountCents, 0) / 100 }] : [];
  });
}
