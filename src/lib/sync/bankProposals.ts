/** Shared, untrusted-payload validation for banking proposals. No file access. */
import type { BankCsvFormat, BankTransaction } from '../../types';
import { previewBankCsv, validateBankFormat, type BankImportRow } from '../utils/bankCsv';

export const BANK_CSV_MAX_BYTES = 1024 * 1024;
export const BANK_IMPORT_MAX_ROWS = 1000;
export type BankFormatPayload = Pick<BankCsvFormat, 'name' | 'delimiter' | 'encoding' | 'headerRow' | 'dateFormat' | 'decimalSeparator' | 'amountMode' | 'columns'>;
export interface BankImportPayload {
  formatId: string;
  /** Copy of the mapping reviewed when proposing; never silently use a changed format. */
  format: BankFormatPayload;
  account: string;
  sourceFile: string;
  csv: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Oggetto richiesto.');
  return value as Record<string, unknown>;
}
function keys(raw: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(raw).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`Campi sconosciuti: ${unknown.join(', ')}.`);
}
function required(raw: Record<string, unknown>, key: string, max: number): string {
  const value = raw[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${key}: stringa obbligatoria, massimo ${max} caratteri.`);
  return value.trim();
}

export function validateBankFormatPayload(value: unknown): BankFormatPayload {
  const raw = object(value);
  keys(raw, ['name', 'delimiter', 'encoding', 'headerRow', 'dateFormat', 'decimalSeparator', 'amountMode', 'columns']);
  const columns = object(raw.columns);
  keys(columns, ['date', 'description', 'amount', 'credit', 'debit', 'valueDate', 'reference']);
  const normalizedColumns: Record<string, string> = {};
  for (const [key, value] of Object.entries(columns)) {
    if (typeof value !== 'string' || value.length > 200) throw new Error(`Colonna ${key} non valida.`);
    if (value.trim()) normalizedColumns[key] = value.trim();
  }
  const f = { ...raw, name: required(raw, 'name', 200), columns: normalizedColumns } as unknown as BankFormatPayload;
  validateBankFormat({ ...f, id: 'validation', userId: 'validation' });
  // Only active amount mappings are persisted, to make comparisons independent of hidden fields.
  const { date, description, valueDate, reference, amount, credit, debit } = f.columns;
  return {
    name: f.name, delimiter: f.delimiter, encoding: f.encoding, headerRow: f.headerRow,
    dateFormat: f.dateFormat, decimalSeparator: f.decimalSeparator, amountMode: f.amountMode,
    columns: { date, description, ...(valueDate ? { valueDate } : {}), ...(reference ? { reference } : {}),
      ...(f.amountMode === 'signed' ? { amount } : { credit, debit }) },
  };
}

export function bankFormatPayload(f: BankCsvFormat): BankFormatPayload {
  return validateBankFormatPayload({ name: f.name, delimiter: f.delimiter, encoding: f.encoding,
    headerRow: f.headerRow, dateFormat: f.dateFormat, decimalSeparator: f.decimalSeparator,
    amountMode: f.amountMode, columns: f.columns });
}

export function validateBankImportPayload(value: unknown, formats: BankCsvFormat[]): BankImportPayload {
  const raw = object(value);
  keys(raw, ['formatId', 'format', 'account', 'sourceFile', 'csv']);
  const formatId = required(raw, 'formatId', 200);
  const current = formats.find(f => f.id === formatId);
  if (!current) throw new Error('Formato inesistente per questo profilo.');
  const format = validateBankFormatPayload(raw.format);
  if (JSON.stringify(format) !== JSON.stringify(bankFormatPayload(current))) {
    throw new Error('Il formato è cambiato: genera una nuova anteprima e una nuova proposta.');
  }
  if (typeof raw.csv !== 'string' || new TextEncoder().encode(raw.csv).byteLength > BANK_CSV_MAX_BYTES) {
    throw new Error('CSV richiesto, massimo 1 MB per proposta MCP.');
  }
  const payload: BankImportPayload = { formatId, format, account: required(raw, 'account', 200), sourceFile: required(raw, 'sourceFile', 255), csv: raw.csv };
  const preview = previewBankCsv(payload.csv, current, payload.account, payload.sourceFile);
  if (preview.errors.length) throw new Error(preview.errors.slice(0, 20).join('\n'));
  if (preview.rows.length > BANK_IMPORT_MAX_ROWS) throw new Error(`Massimo ${BANK_IMPORT_MAX_ROWS} movimenti per proposta MCP.`);
  bankTotals(preview.rows);
  return payload;
}

export function bankImportRows(payload: BankImportPayload, userId: string): BankImportRow[] {
  if (typeof payload.csv !== 'string' || new TextEncoder().encode(payload.csv).byteLength > BANK_CSV_MAX_BYTES) throw new Error('CSV richiesto, massimo 1 MB.');
  const preview = previewBankCsv(payload.csv, { ...payload.format, id: payload.formatId, userId }, payload.account, payload.sourceFile);
  if (preview.errors.length) throw new Error(preview.errors.slice(0, 20).join('\n'));
  if (preview.rows.length > BANK_IMPORT_MAX_ROWS) throw new Error(`Massimo ${BANK_IMPORT_MAX_ROWS} movimenti.`);
  return preview.rows;
}

export function bankTotals(rows: ReadonlyArray<Pick<BankTransaction, 'amountCents'>>) {
  const entrateCentesimi = rows.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
  const usciteCentesimi = rows.reduce((sum, row) => sum + Math.max(0, -row.amountCents), 0);
  const nettoCentesimi = entrateCentesimi - usciteCentesimi;
  if (![entrateCentesimi, usciteCentesimi, nettoCentesimi].every(Number.isSafeInteger)) throw new Error('Totali fuori intervallo.');
  return { valuta: 'EUR', entrate: entrateCentesimi / 100, uscite: usciteCentesimi / 100, netto: nettoCentesimi / 100 };
}
