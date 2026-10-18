import type { BankTransaction, Fattura } from '../../types';
import { remainingCents } from './receipts';

export interface CashflowRange { from: string; to: string }
export type CashflowPreset = 'past' | 'future' | 'both';
export function dateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function cashflowPreset(preset: CashflowPreset, today = new Date()): CashflowRange {
  const shift = (years: number) => {
    const d = new Date(today.getFullYear() + years, today.getMonth(), 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(today.getDate(), lastDay));
    return dateIso(d);
  };
  return { from: preset === 'future' ? dateIso(today) : shift(-1), to: preset === 'past' ? dateIso(today) : shift(1) };
}
export function inCashflowRange(date: string, range?: CashflowRange): boolean {
  return !range || ((!range.from || date >= range.from) && (!range.to || date <= range.to));
}
export function expectedReceipts(fatture: Fattura[]) {
  return fatture.filter(f => remainingCents(f) > 0);
}
export interface CashflowMonth { month: string; incoming: number; outgoing: number; expected: number }
export function cashflowProjection(transactions: BankTransaction[], fatture: Fattura[], range?: CashflowRange): CashflowMonth[] {
  if (range?.from && range.to && range.from > range.to) return [];
  const months = new Map<string, CashflowMonth>();
  const at = (date: string) => {
    const month = date.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, incoming: 0, outgoing: 0, expected: 0 });
    return months.get(month)!;
  };
  for (const t of transactions) {
    if (!inCashflowRange(t.date, range)) continue;
    const row = at(t.date);
    row.incoming += Math.max(0, t.amountCents);
    row.outgoing += Math.max(0, -t.amountCents);
  }
  for (const f of expectedReceipts(fatture)) {
    if (f.dataIncassoPrevista && inCashflowRange(f.dataIncassoPrevista, range)) at(f.dataIncassoPrevista).expected += remainingCents(f);
  }
  const knownMonths = [...months.keys()].sort();
  const start = range?.from?.slice(0, 7) || knownMonths[0];
  const end = range?.to?.slice(0, 7) || knownMonths[knownMonths.length - 1];
  if (start && end) {
    let cursor = start;
    // Date inputs are bounded to 1900–2100 in the UI; protect callers against unbounded ranges.
    for (let i = 0; cursor <= end && i < 2412; i++) {
      at(cursor);
      const [y, m] = cursor.split('-').map(Number);
      cursor = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
    }
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
