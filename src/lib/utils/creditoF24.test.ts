import test from 'node:test';
import assert from 'node:assert/strict';

import type { Config, Fattura } from '../../types';
import { DEFAULT_CONFIG } from '../constants/fiscali';
import { creditoDaCompensare, ripartisciCredito } from './creditoF24';
import { calcolaAccantonamento, calcolaFiscaleAnno } from './accantonamento';
import { calcolaAccontiForfettario } from './forfettario';
import { calculateScheduleTotals, generatePaymentSchedule } from './paymentScheduler';

test('credit is the part of acconti paid above what is due, per voce, never negative', () => {
  assert.equal(creditoDaCompensare([{ accontiPagati: 2763.26, dovuto: 1023.13 }, { accontiPagati: 11526.06, dovuto: 12095.48 }]), 1740.13);
  assert.equal(creditoDaCompensare([{ accontiPagati: 100, dovuto: 500 }]), 0);
});

test('credit is used from the first deadline on until it runs out', () => {
  assert.deepEqual(ripartisciCredito([5919.18, 5349.76], 1740.13), [1740.13, 0]);
  assert.deepEqual(ripartisciCredito([1000, 800, 500], 1500), [1000, 500, 0]);
  assert.deepEqual(ripartisciCredito([100], 0), [0]);
});

test('plan total minus compensated credit equals the Dashboard set-aside', () => {
  const config: Config = { ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', annoApertura: 2025, codiciAteco: ['62.01'] };
  const fatture: Fattura[] = [
    { id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'Cliente', data: '2025-05-10', importo: 82485 },
    { id: 'f2', userId: 'u1', clienteId: 'c1', clienteNome: 'Cliente', data: '2026-04-10', importo: 69248 },
  ];
  const { fiscale } = calcolaFiscaleAnno(config, 2026, fatture, []);
  const accantonamento = calcolaAccantonamento(config, 2026, fiscale, fatture, []);

  // Piano 2027 come lo costruisce Scadenze per l'anno 2026, con gli stessi acconti 2026.
  const t = calcolaAccontiForfettario({
    gestionePrevidenziale: 'gestione_separata', impostaSostitutiva: fiscale.irpef, inps: fiscale.inps,
    accontiImpostaPagati: accantonamento.acconti.imposta, accontiInpsPagati: accantonamento.acconti.inps,
  });
  const schedule = generatePaymentSchedule({
    totalTaxSaldo: t.taxSaldo, totalTax1stAcconto: t.tax1stAcconto, totalTax2ndAcconto: t.tax2ndAcconto,
    totalInpsSaldo: t.inpsSaldo, totalInps1stAcconto: t.inps1stAcconto, totalInps2ndAcconto: t.inps2ndAcconto,
    numberOfTranches: 1, fiscalYear: 2027,
  });
  const credito = creditoDaCompensare([
    { accontiPagati: t.accontiIrpefPagati, dovuto: t.taxSaldoLordo },
    { accontiPagati: t.accontiInpsPagati, dovuto: t.inpsSaldoLordo },
  ]);
  const usato = ripartisciCredito(schedule.map(i => i.totalAmount), credito).reduce((a, b) => a + b, 0);
  assert.equal(credito, 1740.13);
  assert.equal(Math.round((calculateScheduleTotals(schedule).grandTotal - usato) * 100) / 100, accantonamento.totale);
});
