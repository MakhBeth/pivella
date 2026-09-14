import test from 'node:test';
import assert from 'node:assert/strict';

import type { Cliente, Config, Fattura, Scadenza } from '../../types';
import { DEFAULT_CONFIG } from '../constants/fiscali';
import { finishProposal, nextInvoiceNumber, planProposal, proposalTitle, type PlanContext } from './applyProposal';
import { createProposal } from './proposals';
import { ProposalValidationError } from './validate';

const NOW = '2026-09-14T10:00:00.000Z';
const config: Config = {
  ...DEFAULT_CONFIG,
  id: 'config_u1',
  userId: 'u1',
  partitaIva: '01234567890',
  valute: [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }],
  emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
};
const clienti: Cliente[] = [{ id: 'c1', userId: 'u1', nome: 'Acme' }];
const fatture: Fattura[] = [
  { id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', numero: '01', data: '2026-01-10', importo: 100 },
  { id: 'f2', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', numero: '07', data: '2026-03-10', importo: 500, incassato: false },
  { id: 'f3', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', numero: '12', data: '2025-06-01', importo: 200 },
];
const scadenze: Scadenza[] = [
  { id: 's1', userId: 'u1', visibleId: 'v1', annoRiferimento: 2025, annoVersamento: 2026, date: '2026-06-30', tipo: 'saldo_irpef', label: 'Saldo', importo: 10, interessi: 0, totale: 10, pagato: false },
];

let counter = 0;
const ctx: PlanContext = { userId: 'u1', config, clienti, fatture, scadenze, today: '2026-09-14', now: NOW, newId: () => `id_${++counter}` };
const proposal = (kind: Parameters<typeof createProposal>[0]['kind'], payload: Record<string, unknown>) =>
  createProposal({ userId: 'u1', kind, payload }, { now: NOW, writerId: 'mcp-1', id: `prop_${kind}` });

test('nextInvoiceNumber is max + 1 within the year of the invoice, two digits, restarting each year', () => {
  assert.equal(nextInvoiceNumber(fatture, 2026), '08');
  assert.equal(nextInvoiceNumber(fatture, 2025), '13');
  assert.equal(nextInvoiceNumber(fatture, 2027), '01');
  assert.equal(nextInvoiceNumber([], 2026), '01');
});

test('planProposal workLog produces one work log record for the user', () => {
  counter = 0;
  const plan = planProposal(proposal('workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1, note: 'x' }), ctx);
  assert.deepEqual(plan.puts, [{ store: 'workLogs', record: { id: 'id_1', userId: 'u1', clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1, note: 'x' } }]);
  assert.deepEqual(plan.result, { recordId: 'id_1' });
});

test('planProposal cliente produces one client record with nazione default', () => {
  counter = 0;
  const plan = planProposal(proposal('cliente', { nome: 'Beta', rate: 300 }), ctx);
  assert.deepEqual(plan.puts, [{ store: 'clienti', record: { id: 'id_1', userId: 'u1', nome: 'Beta', rate: 300, nazione: 'IT' } }]);
});

test('planProposal incasso updates the invoice keeping every other field', () => {
  const plan = planProposal(proposal('incasso', { fatturaId: 'f2', dataIncasso: '2026-09-10' }), ctx);
  assert.deepEqual(plan.puts, [{ store: 'fatture', record: { ...fatture[1], incassato: true, dataIncasso: '2026-09-10' } }]);
  assert.deepEqual(plan.result, { recordId: 'f2' });
});

test('planProposal scadenzaPagata marks the deadline paid', () => {
  const plan = planProposal(proposal('scadenzaPagata', { scadenzaId: 's1', dataPagamento: '2026-06-30' }), ctx);
  assert.deepEqual(plan.puts, [{ store: 'scadenze', record: { ...scadenze[0], pagato: true, dataPagamento: '2026-06-30' } }]);
});

test('planProposal fattura assigns the number for the year of the invoice and builds the record like the modal', () => {
  counter = 0;
  const righe = [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500 }];
  const plan = planProposal(proposal('fattura', { clienteId: 'c1', data: '2027-01-05', righe, valuta: 'EUR' }), ctx);
  assert.deepEqual(plan.puts, [{
    store: 'fatture',
    record: { id: 'id_1', userId: 'u1', numero: '01', importo: 1000, data: '2027-01-05', dataIncasso: '2027-01-05', clienteId: 'c1', clienteNome: 'Acme', duplicateKey: '01-2027-01-05-1000', valuta: 'EUR', valutaSimbolo: '€' },
  }]);
  assert.deepEqual(plan.result, { recordId: 'id_1', numero: '01' });
});

test('planProposal fattura in a foreign currency stores EUR importo, importoValuta and tassoCambio', () => {
  counter = 0;
  const righe = [{ descrizione: 'Consulenza', quantita: 1, prezzoUnitario: 1000 }];
  const plan = planProposal(proposal('fattura', { clienteId: 'c1', data: '2026-09-10', righe, valuta: 'GBP', tassoCambio: 0.8, dataIncasso: '2026-09-20' }), ctx);
  const record = plan.puts[0].record as Fattura;
  assert.equal(record.numero, '08');
  assert.equal(record.importo, 1250);
  assert.equal(record.importoValuta, 1000);
  assert.equal(record.tassoCambio, 0.8);
  assert.equal(record.valutaSimbolo, '£');
  assert.equal(record.dataIncasso, '2026-09-20');
});

test('planProposal fattura with nuovoCliente creates the client first and links the invoice to it', () => {
  counter = 0;
  const righe = [{ descrizione: 'Consulenza', quantita: 1, prezzoUnitario: 100 }];
  const plan = planProposal(proposal('fattura', { nuovoCliente: { denominazione: 'Nuova Srl', partitaIva: '123', comune: 'Roma' }, data: '2026-09-10', righe }), ctx);
  assert.equal(plan.puts.length, 2);
  assert.deepEqual(plan.puts[0], { store: 'clienti', record: { id: 'id_1', userId: 'u1', nome: 'Nuova Srl', piva: '123', comune: 'Roma', nazione: 'IT' } });
  const record = plan.puts[1].record as Fattura;
  assert.equal(record.clienteId, 'id_1');
  assert.equal(record.clienteNome, 'Nuova Srl');
  assert.equal(plan.result.recordId, 'id_2');
});

test('planProposal revalidates: a stale proposal fails instead of being applied', () => {
  assert.throws(() => planProposal(proposal('incasso', { fatturaId: 'f1', dataIncasso: '2026-09-10' }), ctx), (e: unknown) => e instanceof ProposalValidationError && e.code === 'VALIDATION');
  assert.throws(() => planProposal(proposal('workLog', { clienteId: 'zz', data: '2026-09-10', tipo: 'giornata', quantita: 1 }), ctx), ProposalValidationError);
  assert.throws(() => planProposal({ ...proposal('workLog', {}), userId: 'u2' }, ctx), /profilo/);
});

test('finishProposal moves to applied with result or rejected with reason, never from a terminal state', () => {
  const p = proposal('cliente', { nome: 'X' });
  const later = '2026-09-15T00:00:00.000Z';
  assert.deepEqual(finishProposal(p, { status: 'applied', result: { recordId: 'r1' } }, later), { ...p, status: 'applied', result: { recordId: 'r1' }, updatedAt: later });
  assert.deepEqual(finishProposal(p, { status: 'rejected', rejectReason: 'no' }, later), { ...p, status: 'rejected', rejectReason: 'no', updatedAt: later });
  assert.throws(() => finishProposal({ ...p, status: 'withdrawn' }, { status: 'rejected', rejectReason: null }, later), /PROPOSAL_NOT_PENDING|non è in attesa/);
});

test('proposalTitle describes each kind in Italian with client names resolved', () => {
  const resolve = (id: string) => (id === 'c1' ? 'Acme' : id);
  assert.equal(proposalTitle(proposal('workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'giornata', quantita: 1 }), resolve), 'Giornata per Acme il 10/09/2026: 1 giornata');
  assert.equal(proposalTitle(proposal('workLog', { clienteId: 'c1', data: '2026-09-10', tipo: 'ore', quantita: 3 }), resolve), 'Ore per Acme il 10/09/2026: 3 ore');
  assert.equal(proposalTitle(proposal('cliente', { nome: 'Beta' }), resolve), 'Nuovo cliente Beta');
  assert.equal(proposalTitle(proposal('incasso', { fatturaId: 'f2', dataIncasso: '2026-09-10' }), resolve, fatture), 'Incasso della fattura 07 il 10/09/2026');
  assert.equal(proposalTitle(proposal('scadenzaPagata', { scadenzaId: 's1', dataPagamento: '2026-06-30' }), resolve, fatture, scadenze), 'Scadenza Saldo pagata il 30/06/2026');
  assert.equal(proposalTitle(proposal('fattura', { clienteId: 'c1', data: '2026-09-10', righe: [{ descrizione: 'a', quantita: 2, prezzoUnitario: 500 }], valuta: 'EUR' }), resolve), 'Fattura a Acme del 10/09/2026: 1000.00 EUR');
});
