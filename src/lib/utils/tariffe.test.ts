import test from 'node:test';
import assert from 'node:assert/strict';
import type { Cliente, WorkLog } from '../../types';
import { conStoricoTariffe, getStoricoTariffe, riepilogoPerCliente, tariffaAllaData, unitaAllaData, validaStoricoTariffe } from './tariffe';

const log = (id: string, clienteId: string, data: string, quantita: number, tipo: WorkLog['tipo'] = 'giornata'): WorkLog =>
  ({ id, userId: 'u', clienteId, data, tipo, quantita });

const acme: Cliente = {
  id: 'acme',
  userId: 'u',
  nome: 'Acme',
  rate: 450,
  billingUnit: 'giornata',
  rateHistory: [
    { dal: '2026-10-15', rate: 450, billingUnit: 'giornata' },
    { rate: 400, billingUnit: 'giornata' },
  ],
};

test('legacy clients become a single open-ended tariff', () => {
  assert.deepEqual(getStoricoTariffe({ rate: 50, billingUnit: 'ore' }), [{ rate: 50, billingUnit: 'ore' }]);
  assert.deepEqual(getStoricoTariffe({ rate: 50 }), [{ rate: 50, billingUnit: 'ore' }]);
  assert.deepEqual(getStoricoTariffe({ billingUnit: 'giornata' }), []);
  assert.deepEqual(getStoricoTariffe({ rate: 0, billingUnit: 'ore' }), []);
});

test('the tariff in force is the last one starting on or before the date', () => {
  assert.equal(tariffaAllaData(acme, '2020-01-01')?.rate, 400);
  assert.equal(tariffaAllaData(acme, '2026-10-14')?.rate, 400);
  assert.equal(tariffaAllaData(acme, '2026-10-15')?.rate, 450);
  assert.equal(tariffaAllaData(acme, '2027-01-01')?.rate, 450);
});

test('days before the first dated tariff have no tariff when nothing is open-ended', () => {
  const cliente: Cliente = { id: 'x', userId: 'u', nome: 'X', rateHistory: [{ dal: '2026-10-01', rate: 300, billingUnit: 'ore' }] };
  assert.equal(tariffaAllaData(cliente, '2026-09-30'), null);
  assert.equal(unitaAllaData(cliente, '2026-09-30'), 'ore');
});

test('the unit follows the tariff in force at the date', () => {
  const cliente: Cliente = { id: 'x', userId: 'u', nome: 'X', billingUnit: 'giornata', rateHistory: [{ rate: 50, billingUnit: 'ore' }, { dal: '2026-10-01', rate: 400, billingUnit: 'giornata' }] };
  assert.equal(unitaAllaData(cliente, '2026-09-30'), 'ore');
  assert.equal(unitaAllaData(cliente, '2026-10-01'), 'giornata');
  assert.equal(unitaAllaData(undefined, '2026-10-01'), 'ore');
});

test('a raise does not reprice the days already worked', () => {
  const logs = [log('1', 'acme', '2026-10-01', 1), log('2', 'acme', '2026-10-14', 1), log('3', 'acme', '2026-10-15', 1), log('4', 'acme', '2026-10-20', 0.5)];
  const mese = riepilogoPerCliente([acme], logs, '2026-10-01', '2026-10-31', { perTariffa: true });
  assert.deepEqual(mese.map(r => [r.rate, r.totalQuantita, r.amount, r.unit]), [[400, 2, 800, 'giornata'], [450, 1.5, 675, 'giornata']]);

  const anno = riepilogoPerCliente([acme], logs, '2026-01-01', '2026-12-31', { perTariffa: false });
  assert.equal(anno.length, 1);
  assert.equal(anno[0].totalQuantita, 3.5);
  assert.equal(anno[0].amount, 1475);
  assert.equal(anno[0].rate, null);
});

test('the summary ignores the old billing start date and other periods', () => {
  const cliente: Cliente = { id: 'c', userId: 'u', nome: 'C', rate: 50, billingUnit: 'ore', billingStartDate: '2026-10-10' };
  const logs = [log('1', 'c', '2026-09-30', 8, 'ore'), log('2', 'c', '2026-10-01', 4, 'ore'), log('3', 'c', '2026-10-20', 2, 'ore'), log('4', 'altro', '2026-10-02', 1)];
  const mese = riepilogoPerCliente([cliente], logs, '2026-10-01', '2026-10-31', { perTariffa: true });
  assert.deepEqual(mese.map(r => [r.rate, r.totalQuantita, r.amount, r.unit]), [[50, 6, 300, 'ore']]);
});

test('clients without a tariff still show quantities with no amount', () => {
  const cliente: Cliente = { id: 'c', userId: 'u', nome: 'C', billingUnit: 'giornata' };
  const mese = riepilogoPerCliente([cliente], [log('1', 'c', '2026-10-01', 1)], '2026-10-01', '2026-10-31', { perTariffa: true });
  assert.deepEqual(mese.map(r => [r.rate, r.totalQuantita, r.amount, r.unit]), [[null, 1, null, 'giornata']]);
});

test('saving the history sorts it, mirrors the latest tariff and drops billingStartDate', () => {
  const salvato = conStoricoTariffe({ ...acme, billingStartDate: '2026-01-01' }, acme.rateHistory!);
  assert.deepEqual(salvato.rateHistory!.map(t => t.dal), [undefined, '2026-10-15']);
  assert.equal(salvato.rate, 450);
  assert.equal(salvato.billingUnit, 'giornata');
  assert.equal('billingStartDate' in salvato, false);

  const vuoto = conStoricoTariffe({ ...acme }, []);
  assert.equal(vuoto.rate, undefined);
  assert.deepEqual(getStoricoTariffe(vuoto), []);
  assert.equal(vuoto.billingUnit, 'giornata');
});

test('history validation flags bad rows', () => {
  assert.deepEqual(validaStoricoTariffe(acme.rateHistory!), []);
  const errori = validaStoricoTariffe([
    { rate: 400, billingUnit: 'giornata' },
    { rate: NaN, billingUnit: 'giornata' },
    { rate: 300, billingUnit: 'ore' },
    { dal: '2026-10-01', rate: 1, billingUnit: 'ore' },
    { dal: '2026-10-01', rate: 2, billingUnit: 'ore' },
    { dal: '2026-02-30', rate: 2, billingUnit: 'ore' },
  ]);
  assert.deepEqual(errori.map(e => e.index), [1, 1, 2, 4, 5]);
});
