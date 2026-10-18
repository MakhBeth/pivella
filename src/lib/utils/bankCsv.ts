import type { BankCsvFormat, BankTransaction } from '../../types';

/** RFC-style quoted fields, including embedded delimiters, newlines and escaped quotes. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === delimiter || c === '\n' || c === '\r') {
      row.push(field.trim()); field = ''; closed = false;
      if (c !== delimiter) {
        rows.push(row); row = [];
        if (c === '\r' && input[i + 1] === '\n') i++;
      }
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else if (closed || c === '"') throw new Error('CSV non valido: virgolette o caratteri dopo la chiusura di un campo.');
    else field += c;
  }
  if (quoted) throw new Error('CSV non valido: campo tra virgolette non chiuso.');
  if (field || row.length || closed) { row.push(field.trim()); rows.push(row); }
  return rows;
}

export function validateBankFormat(f: BankCsvFormat): void {
  if (![f.id, f.userId].every(v => typeof v === 'string' && v.trim())) throw new Error('Identificativo o profilo del formato mancante.');
  if (typeof f.name !== 'string' || !f.name.trim()) throw new Error('Inserisci il nome del formato.');
  if (![';', ',', '\t', '|'].includes(f.delimiter)) throw new Error('Separatore non valido.');
  if (!['utf-8', 'windows-1252'].includes(f.encoding)) throw new Error('Codifica non valida.');
  if (!Number.isInteger(f.headerRow) || f.headerRow < 1) throw new Error('La riga delle intestazioni deve essere almeno 1.');
  if (!['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(f.dateFormat)) throw new Error('Formato data non valido.');
  if (![',', '.'].includes(f.decimalSeparator)) throw new Error('Separatore decimale non valido.');
  if (!['signed', 'split'].includes(f.amountMode)) throw new Error('Modalità importi non valida.');
  const required = [f.columns?.date, f.columns?.description, ...(f.amountMode === 'signed' ? [f.columns?.amount] : [f.columns?.credit, f.columns?.debit])];
  if (required.some(c => typeof c !== 'string' || !c.trim())) throw new Error('Mappa data, descrizione e importi.');
  if ([f.columns.valueDate, f.columns.reference].some(v => v !== undefined && typeof v !== 'string')) throw new Error('Mappatura opzionale non valida.');
  const selected = [...required, f.columns.valueDate, f.columns.reference].filter(Boolean);
  if (new Set(selected).size !== selected.length) throw new Error('Ogni campo deve usare una colonna diversa.');
}

export function csvHeaders(text: string, f: Pick<BankCsvFormat, 'delimiter' | 'headerRow'>): string[] {
  const headers = parseCsv(text, f.delimiter)[f.headerRow - 1];
  if (!headers || headers.length < 2 || headers.some(h => !h)) throw new Error('Intestazioni mancanti: verifica separatore e numero di riga.');
  if (new Set(headers).size !== headers.length) throw new Error('Le intestazioni delle colonne devono essere univoche.');
  return headers;
}

function dateValue(value: string, format: BankCsvFormat['dateFormat']): string {
  const match = format === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Data non valida: «${value}» (atteso ${format}).`);
  const [, a, b, c] = match;
  const iso = format === 'YYYY-MM-DD' ? `${a}-${b}-${c}` : format === 'DD/MM/YYYY' ? `${c}-${b}-${a}` : `${c}-${a}-${b}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new Error(`Data inesistente: «${value}».`);
  return iso;
}

export function bankAmount(value: string, decimal: ',' | '.'): number {
  const raw = value.replace(/[\s\u00a0]/g, '');
  const pattern = decimal === ',' ? /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/ : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  if (!pattern.test(raw)) throw new Error(`Importo non valido: «${value}».`);
  const normalized = decimal === ',' ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error('Importo fuori intervallo.');
  return cents;
}

export type BankImportRow = Omit<BankTransaction, 'id' | 'userId' | 'updatedAt' | 'updatedBy'>;
export interface BankPreview { rows: BankImportRow[]; errors: string[] }

export function previewBankCsv(text: string, f: BankCsvFormat, account: string, sourceFile: string): BankPreview {
  validateBankFormat(f);
  if (!account.trim()) throw new Error('Indica il conto corrente.');
  const headers = csvHeaders(text, f);
  const mapped = [f.columns.date, f.columns.description, f.columns.valueDate, f.columns.reference,
    ...(f.amountMode === 'signed' ? [f.columns.amount] : [f.columns.credit, f.columns.debit])].filter(Boolean);
  for (const col of mapped) if (!headers.includes(col!)) throw new Error(`Colonna «${col}» assente nel file.`);
  const rows: BankImportRow[] = [], errors: string[] = [];
  const occurrences = new Map<string, number>();
  const references = new Set<string>();
  for (const [index, values] of parseCsv(text, f.delimiter).entries()) {
    if (index < f.headerRow || values.every(v => !v)) continue;
    try {
      if (values.length !== headers.length) throw new Error(`Attese ${headers.length} colonne, trovate ${values.length}.`);
      const get = (col?: string) => col ? values[headers.indexOf(col)] : '';
      const date = dateValue(get(f.columns.date), f.dateFormat);
      const description = get(f.columns.description);
      if (!description) throw new Error('Descrizione vuota.');
      const valueDate = get(f.columns.valueDate) ? dateValue(get(f.columns.valueDate), f.dateFormat) : undefined;
      let amountCents: number;
      if (f.amountMode === 'signed') amountCents = bankAmount(get(f.columns.amount), f.decimalSeparator);
      else {
        const credit = get(f.columns.credit) ? bankAmount(get(f.columns.credit), f.decimalSeparator) : 0;
        const debit = get(f.columns.debit) ? bankAmount(get(f.columns.debit), f.decimalSeparator) : 0;
        if (credit < 0 || debit < 0 || (credit !== 0 && debit !== 0)) throw new Error('Entrate/uscite: usa valori positivi e una sola colonna valorizzata.');
        amountCents = credit - debit;
      }
      if (amountCents === 0) throw new Error('Importo nullo.');
      const reference = get(f.columns.reference) || undefined;
      if (reference && references.has(reference)) throw new Error(`Riferimento bancario duplicato: ${reference}.`);
      if (reference) references.add(reference);
      const key = JSON.stringify([account.trim().toLocaleLowerCase('it'), reference ? ['ref', reference] : ['row', date, description, amountCents, valueDate ?? '']]);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      rows.push({ account: account.trim(), date, valueDate, description, amountCents, reference, sourceFile, formatId: f.id,
        importKey: JSON.stringify([key, occurrence]) });
    } catch (error) { errors.push(`Riga ${index + 1}: ${(error as Error).message}`); }
  }
  if (!rows.length && !errors.length) errors.push('Il file non contiene movimenti.');
  return { rows, errors };
}
