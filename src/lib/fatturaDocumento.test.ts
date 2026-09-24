import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG } from './constants/fiscali';
import type { Cliente, Config, Fattura } from '../types';
import { buildCourtesyInvoice, buildFatturaXMLData, buildPdfOptions, clienteXMLData, DatiEmittenteMancantiError, emittenteMancante, righeOrFallback } from './fatturaDocumento';
import { generateFatturaXML } from './xml/generator';

const config: Config = {
  ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', partitaIva: '01234567890', iban: 'IT60X0542811101000000123456',
  valute: [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }],
  emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via Roma', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
  courtesyInvoice: { ...DEFAULT_CONFIG.courtesyInvoice!, primaryColor: '#112233', textColor: '#000000', locale: 'en', includeFooter: false, logoBase64: 'data:image/png;base64,AAAA' },
};
const cliente: Cliente = { id: 'c1', userId: 'u1', nome: 'Acme Srl', piva: '09876543210', indirizzo: 'Via Milano', numeroCivico: '2', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT' };
const conRighe: Fattura = { id: 'f1', userId: 'u1', numero: '07', data: '2026-03-10', clienteId: 'c1', clienteNome: 'Acme Srl', importo: 1000, valuta: 'EUR', valutaSimbolo: '€', righe: [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }] };
const senzaRighe: Fattura = { id: 'f2', userId: 'u1', numero: '08', data: '2026-03-11', clienteId: 'c1', clienteNome: 'Acme Srl', importo: 50 };
const gbp: Fattura = { id: 'f3', userId: 'u1', numero: '09', data: '2026-04-01', clienteId: 'c1', clienteNome: 'Acme Srl', importo: 1190.48, importoValuta: 1000, valuta: 'GBP', valutaSimbolo: '£', tassoCambio: 0.84, dataCambio: '2026-03-31', righe: [{ descrizione: 'Workshop', quantita: 1, prezzoUnitario: 1000 }] };

test('righeOrFallback returns saved righe or a single line with the original-currency total', () => {
  assert.deepEqual(righeOrFallback(conRighe), { righe: conRighe.righe, fallback: false });
  assert.deepEqual(righeOrFallback(senzaRighe), { righe: [{ descrizione: 'Prestazione professionale', quantita: 1, prezzoUnitario: 50 }], fallback: true });
  const { righe, ...gbpSenza } = gbp;
  assert.deepEqual(righeOrFallback(gbpSenza).righe, [{ descrizione: 'Prestazione professionale', quantita: 1, prezzoUnitario: 1000 }]);
  assert.ok(righe);
});

test('clienteXMLData maps the anagrafica and falls back to the saved name', () => {
  assert.deepEqual(clienteXMLData(cliente, 'x'), { denominazione: 'Acme Srl', partitaIva: '09876543210', nazione: 'IT', indirizzo: 'Via Milano', numeroCivico: '2', cap: '20100', comune: 'Milano', provincia: 'MI' });
  assert.deepEqual(clienteXMLData(undefined, 'Cliente sparito'), { denominazione: 'Cliente sparito', nazione: 'IT' });
});

test('emittenteMancante lists the missing fields', () => {
  assert.deepEqual(emittenteMancante(config), []);
  assert.deepEqual(emittenteMancante({ ...config, partitaIva: '', emittente: { ...config.emittente!, codiceFiscale: '', comune: '' } }), ['partitaIva', 'emittente.codiceFiscale', 'emittente.comune']);
  assert.ok(emittenteMancante(null).length > 0);
});

test('buildFatturaXMLData carries righe, iban, currency and exchange date', () => {
  const eur = buildFatturaXMLData(conRighe, cliente, config);
  assert.equal(eur.numero, '07');
  assert.equal(eur.iban, config.iban);
  assert.equal(eur.beneficiario, 'Mario Rossi');
  assert.equal(eur.valuta, undefined);
  const g = buildFatturaXMLData(gbp, cliente, config);
  assert.equal(g.valuta, 'GBP');
  assert.equal(g.tassoCambio, 0.84);
  assert.equal(g.dataCambio, '2026-03-31');
  const xml = generateFatturaXML(g);
  assert.match(xml, /<ImportoTotaleDocumento>1190\.48<\/ImportoTotaleDocumento>/);
  assert.match(xml, /<RiferimentoData>2026-03-31<\/RiferimentoData>/);
});

test('buildFatturaXMLData throws DatiEmittenteMancantiError when the emittente is incomplete', () => {
  assert.throws(() => buildFatturaXMLData(conRighe, cliente, { ...config, partitaIva: '' }), (e: unknown) => e instanceof DatiEmittenteMancantiError && e.campi.includes('partitaIva'));
});

test('buildCourtesyInvoice builds lines, stamp duty over 77.47 EUR and payment', () => {
  const inv = buildCourtesyInvoice(conRighe, cliente, config);
  const inst = inv.installments[0];
  assert.equal(inv.invoicee.name, 'Acme Srl');
  assert.equal(inv.invoicer.vat, '01234567890');
  assert.equal(inst.number, '07');
  assert.equal(inst.currency, 'EUR');
  assert.equal(inst.totalAmount, 1000);
  assert.equal(inst.stampDuty, 2);
  assert.deepEqual(inst.lines.map((l) => [l.description, l.quantity, l.singlePrice, l.amount, l.tax]), [['Sviluppo', 2, 500, 1000, 0]]);
  assert.equal(inst.payment?.iban, config.iban);
  assert.equal(buildCourtesyInvoice(senzaRighe, cliente, config).installments[0].stampDuty, undefined);
  const g = buildCourtesyInvoice(gbp, cliente, config).installments[0];
  assert.equal(g.currency, 'GBP');
  assert.equal(g.totalAmount, 1000);
  assert.equal(g.stampDuty, 2);
});

test('F3: buildCourtesyInvoice totals fractional lines like fatturaPreview and generateFatturaXML (aggregate rounding)', () => {
  const f: Fattura = { id: 'f4', userId: 'u1', numero: '10', data: '2026-04-02', clienteId: 'c1', clienteNome: 'Acme Srl', importo: 0.67, righe: [{ descrizione: 'A', quantita: 0.33, prezzoUnitario: 1.01 }, { descrizione: 'B', quantita: 0.33, prezzoUnitario: 1.01 }] };
  const inv = buildCourtesyInvoice(f, cliente, config);
  const inst = inv.installments[0];
  assert.equal(inst.totalAmount, 0.67);
  assert.equal(inst.payment?.amount, 0.67);
  assert.equal(inst.taxSummary.paymentAmount, 0.67);
  const xml = generateFatturaXML(buildFatturaXMLData(f, cliente, config));
  assert.match(xml, /<ImponibileImporto>0\.67</);
});

test('buildPdfOptions reads the courtesy settings and allows a locale override', () => {
  const o = buildPdfOptions(config);
  assert.equal(o.colors?.primary, '#112233');
  assert.equal(o.locale, 'en');
  assert.equal(o.footer, false);
  assert.equal(o.logoSrc, 'data:image/png;base64,AAAA');
  assert.deepEqual(o.currencyMap, { EUR: '€', GBP: '£' });
  assert.equal(buildPdfOptions(config, { locale: 'it' }).locale, 'it');
});
