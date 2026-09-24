import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { DEFAULT_CONFIG } from '../../src/lib/constants/fiscali';
import { buildCourtesyInvoice, buildPdfOptions } from '../../src/lib/fatturaDocumento';
import type { Config } from '../../src/types';
import { renderCourtesyPdf, resolveFontPath } from './pdf';

test('resolveFontPath finds the bundled or repo font', () => {
  assert.ok(existsSync(resolveFontPath()));
});

test('renderCourtesyPdf produces a PDF in Node', async () => {
  const config: Config = { ...DEFAULT_CONFIG, id: 'c', userId: 'u1', partitaIva: '01234567890', emittente: { codiceFiscale: 'X', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' } };
  const invoice = buildCourtesyInvoice({ id: 'f', userId: 'u1', numero: '01', data: '2026-03-10', clienteId: 'c1', clienteNome: 'Acme', importo: 100, righe: [{ descrizione: 'A', quantita: 1, prezzoUnitario: 100 }] }, undefined, config);
  const pdf = await renderCourtesyPdf(invoice, buildPdfOptions(config));
  assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF');
});
