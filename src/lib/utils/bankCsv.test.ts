import test from 'node:test';
import assert from 'node:assert/strict';
import { bankAmount, csvHeaders, parseCsv, previewBankCsv } from './bankCsv';
import type { BankCsvFormat } from '../../types';

export const format: BankCsvFormat = { id: 'format', userId: 'u', name: 'Banca', delimiter: ';', encoding: 'utf-8', headerRow: 1, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', amountMode: 'signed', columns: { date: 'Data', description: 'Descrizione', amount: 'Importo' } };
const preview = (text: string, f = format) => previewBankCsv(text, f, 'Conto', 'movimenti.csv');
test('quoted delimiters, escaped quotes, multiline descriptions, BOM and CRLF', () => {
  const result = preview('\uFEFFData;Descrizione;Importo\r\n17/10/2026;"Bonifico; ""Acme""\nSaldo";1.234,56\r\n');
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].description, 'Bonifico; "Acme"\nSaldo');
  assert.equal(result.rows[0].amountCents, 123456);
});
test('strict decimal parsing avoids ambiguous amounts and truncation', () => {
  assert.equal(bankAmount('-1.234,56', ','), -123456);
  assert.equal(bankAmount('+1,234.56', '.'), 123456);
  for (const v of ['', '12x', '1,234', '12.34', '1.23.456', 'NaN']) assert.throws(() => bankAmount(v, ','));
});
test('split amounts, metadata lines, optional reference and value date', () => {
  const f: BankCsvFormat = { ...format, headerRow: 2, amountMode: 'split', columns: { date: 'Data', description: 'Descrizione', credit: 'Entrate', debit: 'Uscite', valueDate: 'Valuta', reference: 'ID' } };
  const r = preview('Estratto conto\nData;Descrizione;Entrate;Uscite;Valuta;ID\n17/10/2026;Spesa;;42,10;18/10/2026;A\n', f);
  assert.deepEqual(r.errors, []); assert.equal(r.rows[0].amountCents, -4210); assert.equal(r.rows[0].valueDate, '2026-10-18');
  assert.equal(preview('Estratto\nData;Descrizione;Entrate;Uscite;Valuta;ID\n17/10/2026;X;10;20;;A', f).errors.length, 1);
});
test('impossible dates, missing headers, malformed CSV and short rows are rejected', () => {
  assert.match(preview('Data;Descrizione;Importo\n31/02/2026;X;10').errors[0], /Riga 2/);
  assert.match(preview('Data;Descrizione;Importo\n17/10/2026;X').errors[0], /colonne/);
  assert.throws(() => preview('Giorno;Descrizione;Importo\n17/10/2026;X;10'), /assente/);
  assert.throws(() => parseCsv('A;"broken', ';'), /non chiuso/);
  assert.throws(() => csvHeaders('A;A\n1;2', format), /univoche/);
});
test('duplicate identities survive file renaming and column reordering; repeated legitimate rows remain distinct', () => {
  const a = preview('Data;Descrizione;Importo\n17/10/2026;X;10\n17/10/2026;X;10');
  const b = previewBankCsv('Importo;Data;Descrizione\n10;17/10/2026;X\n10;17/10/2026;X', format, ' Conto ', 'renamed.csv');
  assert.deepEqual(a.rows.map(r => r.importKey), b.rows.map(r => r.importKey));
  assert.notEqual(a.rows[0].importKey, a.rows[1].importKey);
});
test('bank references identify transactions independently of mutable descriptions', () => {
  const f = { ...format, columns: { ...format.columns, reference: 'ID' } };
  const a = preview('Data;Descrizione;Importo;ID\n17/10/2026;X;10;123', f);
  const b = preview('Data;Descrizione;Importo;ID\n17/10/2026;Changed;10;123', f);
  assert.equal(a.rows[0].importKey, b.rows[0].importKey);
  assert.match(preview('Data;Descrizione;Importo;ID\n17/10/2026;X;10;123\n17/10/2026;Y;20;123', f).errors[0], /duplicato/);
});
test('ISO and US date formats', () => {
  assert.equal(preview('Data;Descrizione;Importo\n2024-02-29;X;10', { ...format, dateFormat: 'YYYY-MM-DD' }).rows[0].date, '2024-02-29');
  assert.equal(preview('Data;Descrizione;Importo\n10/17/2026;X;10', { ...format, dateFormat: 'MM/DD/YYYY' }).rows[0].date, '2026-10-17');
});
