import test from 'node:test';
import assert from 'node:assert/strict';

import type { Cliente, Config, Fattura, Scadenza } from '../../types';
import { DEFAULT_CONFIG } from '../constants/fiscali';
import { fatturaPreview, ProposalValidationError, validateProposalPayload, type ValidationContext } from './validate';

const TODAY = '2026-09-14';
const config: Config = {
  ...DEFAULT_CONFIG,
  id: 'config_u1',
  userId: 'u1',
  partitaIva: '01234567890',
  valute: [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }],
  emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
};
const clienti: Cliente[] = [{ id: 'c1', userId: 'u1', nome: 'Acme Srl' }];
const fatture: Fattura[] = [
  { id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme Srl', data: '2026-09-01', importo: 100, incassato: false },
  { id: 'f2', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme Srl', data: '2026-09-01', dataIncasso: '2026-09-01', importo: 100 },
];
const scadenze: Scadenza[] = [
  { id: 's1', userId: 'u1', visibleId: 'v1', annoRiferimento: 2025, annoVersamento: 2026, date: '2026-06-30', tipo: 'saldo_irpef', label: 'Saldo', importo: 10, interessi: 0, totale: 10, pagato: false },
  { id: 's2', userId: 'u1', visibleId: 'v2', annoRiferimento: 2025, annoVersamento: 2026, date: '2026-06-30', tipo: 'saldo_inps', label: 'Saldo', importo: 10, interessi: 0, totale: 10, pagato: true },
];
const ctx: ValidationContext = { config, clienti, fatture, scadenze, today: TODAY };

function fieldsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ProposalValidationError) return err.fields.map((f) => f.field);
    throw err;
  }
  assert.fail('expected a ProposalValidationError');
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ProposalValidationError) return err.code;
    throw err;
  }
  assert.fail('expected a ProposalValidationError');
}

// workLog

test('workLog: accepts a day for an existing client', () => {
  const out = validateProposalPayload('workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1 }, ctx);
  assert.deepEqual(out, { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1 });
});

test('workLog: accepts the special vacation client and keeps note', () => {
  const out = validateProposalPayload('workLog', { clienteId: '__vacation__', data: '2026-09-10', tipo: 'giornata', quantita: 0.5, note: 'mezza' }, ctx);
  assert.equal(out.clienteId, '__vacation__');
  assert.equal((out as { note?: string }).note, 'mezza');
});

test('workLog: rejects unknown client, bad date, bad tipo, non positive quantita', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('workLog', { clienteId: 'zz', data: '10/09/2026', tipo: 'minuti', quantita: 0 }, ctx)).sort(), ['clienteId', 'data', 'quantita', 'tipo']);
});

test('workLog: caps quantita at 24 hours and 1 day, and data at 30 days in the future', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'ore', quantita: 25 }, ctx)), ['quantita']);
  assert.deepEqual(fieldsOf(() => validateProposalPayload('workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1.5 }, ctx)), ['quantita']);
  assert.deepEqual(fieldsOf(() => validateProposalPayload('workLog', { clienteId: 'c1', data: '2026-10-15', tipo: 'giornata', quantita: 1 }, ctx)), ['data']);
  validateProposalPayload('workLog', { clienteId: 'c1', data: '2026-10-14', tipo: 'giornata', quantita: 1 }, ctx);
});

test('workLog: rejects unknown extra fields', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1, fatturaId: 'f1' }, ctx)), ['fatturaId']);
});

// fattura

const righe = [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500 }];

test('fattura: accepts an existing client and defaults valuta to EUR', () => {
  const out = validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe }, ctx);
  assert.deepEqual(out, { clienteId: 'c1', data: '2026-09-10', righe, valuta: 'EUR' });
});

test('fattura: requires exactly one of clienteId and nuovoCliente', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { data: '2026-09-10', righe }, ctx)), ['clienteId']);
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', nuovoCliente: { denominazione: 'X' }, data: '2026-09-10', righe }, ctx)), ['clienteId']);
});

test('fattura: rejects special clients and unknown clients', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: '__misc__', data: '2026-09-10', righe }, ctx)), ['clienteId']);
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'zz', data: '2026-09-10', righe }, ctx)), ['clienteId']);
});

test('fattura: nuovoCliente needs a denominazione', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { nuovoCliente: { partitaIva: '1' }, data: '2026-09-10', righe }, ctx)), ['nuovoCliente.denominazione']);
});

test('fattura: rejects when the issuer is not configured', () => {
  const noEmittente = { ...ctx, config: { ...config, emittente: undefined } };
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe }, noEmittente)), ['emittente']);
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe }, { ...ctx, config: null })), ['emittente']);
});

test('fattura: needs at least one valid line', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe: [] }, ctx)), ['righe']);
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe: [{ descrizione: '', quantita: 0, prezzoUnitario: -1 }] }, ctx)).sort(), ['righe[0].descrizione', 'righe[0].prezzoUnitario', 'righe[0].quantita']);
});

test('fattura: foreign currency must be configured and needs a positive rate', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe, valuta: 'USD', tassoCambio: 1.1 }, ctx)), ['valuta']);
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe, valuta: 'GBP' }, ctx)), ['tassoCambio']);
  const out = validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe, valuta: 'GBP', tassoCambio: 0.85, dataCambio: '2026-09-09' }, ctx);
  assert.equal(out.valuta, 'GBP');
});

test('fattura: dataIncasso must be a date not before data', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('fattura', { clienteId: 'c1', data: '2026-09-10', righe, dataIncasso: '2026-09-09' }, ctx)), ['dataIncasso']);
});

test('fatturaPreview computes totals in the invoice currency and in EUR', () => {
  assert.deepEqual(fatturaPreview({ righe, valuta: 'EUR' }), {
    totaleImponibile: 1000, totaleEUR: 1000, righe: [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500, totale: 1000 }],
  });
  const gbp = fatturaPreview({ righe, valuta: 'GBP', tassoCambio: 0.8 });
  assert.equal(gbp.totaleImponibile, 1000);
  assert.equal(gbp.totaleEUR, 1250);
});

// cliente

test('cliente: accepts a new name and defaults nazione to IT', () => {
  const out = validateProposalPayload('cliente', { nome: 'Beta Spa', rate: 400, billingUnit: 'giornata' }, ctx);
  assert.deepEqual(out, { nome: 'Beta Spa', rate: 400, billingUnit: 'giornata', nazione: 'IT' });
});

test('cliente: rejects a duplicate name ignoring case and spaces, with the existing id', () => {
  try {
    validateProposalPayload('cliente', { nome: ' acme  SRL ' }, ctx);
    assert.fail('expected error');
  } catch (err) {
    assert.ok(err instanceof ProposalValidationError);
    assert.deepEqual(err.fields.map((f) => f.field), ['nome']);
    assert.equal(err.details?.clienteEsistenteId, 'c1');
  }
});

test('cliente: rejects empty name, negative rate, bad billingUnit and bad date', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('cliente', { nome: '  ', rate: -1, billingUnit: 'mesi', billingStartDate: 'ieri' }, ctx)).sort(), ['billingStartDate', 'billingUnit', 'nome', 'rate']);
});

// incasso

test('incasso: accepts an unpaid invoice with a date not before issue', () => {
  assert.deepEqual(validateProposalPayload('incasso', { fatturaId: 'f1', dataIncasso: '2026-09-05' }, ctx), { fatturaId: 'f1', dataIncasso: '2026-09-05' });
});

test('incasso: unknown invoice is NOT_FOUND', () => {
  assert.equal(codeOf(() => validateProposalPayload('incasso', { fatturaId: 'zz', dataIncasso: '2026-09-05' }, ctx)), 'NOT_FOUND');
});

test('incasso: an invoice without the incassato flag counts as already paid', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('incasso', { fatturaId: 'f2', dataIncasso: '2026-09-05' }, ctx)), ['fatturaId']);
});

test('incasso: dataIncasso before the invoice date is rejected', () => {
  assert.deepEqual(fieldsOf(() => validateProposalPayload('incasso', { fatturaId: 'f1', dataIncasso: '2026-08-31' }, ctx)), ['dataIncasso']);
});

// scadenzaPagata

test('scadenzaPagata: accepts an unpaid deadline', () => {
  assert.deepEqual(validateProposalPayload('scadenzaPagata', { scadenzaId: 's1', dataPagamento: '2026-06-30' }, ctx), { scadenzaId: 's1', dataPagamento: '2026-06-30' });
});

test('scadenzaPagata: unknown deadline is NOT_FOUND, paid one is VALIDATION', () => {
  assert.equal(codeOf(() => validateProposalPayload('scadenzaPagata', { scadenzaId: 'zz', dataPagamento: '2026-06-30' }, ctx)), 'NOT_FOUND');
  assert.deepEqual(fieldsOf(() => validateProposalPayload('scadenzaPagata', { scadenzaId: 's2', dataPagamento: '2026-06-30' }, ctx)), ['scadenzaId']);
});

test('payload must be an object', () => {
  assert.equal(codeOf(() => validateProposalPayload('workLog', null, ctx)), 'VALIDATION');
});
