import test from 'node:test';
import assert from 'node:assert/strict';

import type { PaymentScheduleInput, Scadenza } from '../../types';
import { generatePaymentSchedule } from './paymentScheduler';
import { convertScheduleToScadenze } from './scheduleToScadenze';
import { rigeneraPreservandoPagate } from './rigeneraScadenze';

const round2 = (v: number) => Math.round(v * 100) / 100;
const input = (overrides: Partial<PaymentScheduleInput>): PaymentScheduleInput => ({
  totalTaxSaldo: 0, totalTax1stAcconto: 0, totalTax2ndAcconto: 0,
  totalInpsSaldo: 0, totalInps1stAcconto: 0, totalInps2ndAcconto: 0,
  numberOfTranches: 1, fiscalYear: 2026, ...overrides,
});
const scadenzeDi = (overrides: Partial<PaymentScheduleInput>) =>
  convertScheduleToScadenze(generatePaymentSchedule(input(overrides)), { annoRiferimento: 2025, annoVersamento: 2026, accontiIrpef: 0, accontiInps: 0 });
const capitale = (items: { importo: number }[]) => round2(items.reduce((sum, s) => sum + s.importo, 0));

test('the scheduler never produces negative instalments and keeps the total', () => {
  for (const [total, n] of [[0.03, 6], [0.05, 6], [100.01, 3], [1000, 3], [7.77, 4]] as const) {
    const schedule = generatePaymentSchedule(input({ totalInpsSaldo: total, numberOfTranches: n }));
    const quote = schedule.map(i => i.components.inpsSaldo);
    assert.ok(quote.every(q => q >= 0), `${total}/${n}: ${quote}`);
    assert.equal(round2(quote.reduce((a, b) => a + b, 0)), total);
  }
});

test('scheduler, conversion and regeneration keep the saved capital equal to the amount due', () => {
  const prima = scadenzeDi({ totalInpsSaldo: 0.03, numberOfTranches: 6 });
  assert.equal(capitale(prima), 0.03);

  // 0,01 già pagati: rigenerando con lo stesso dovuto restano da pianificare 0,02, non 0,04.
  const esistenti: Scadenza[] = [
    { ...prima[0], id: 'pagata', userId: 'u1', visibleId: '2026-saldo-inps-0', trancheIndex: 0, importo: 0.01, interessi: 0, totale: 0.01, pagato: true, dataPagamento: '2026-06-30' },
  ];
  const piano = rigeneraPreservandoPagate(esistenti, scadenzeDi({ totalInpsSaldo: 0.03, numberOfTranches: 6 }));
  assert.deepEqual(piano.blocchi, []);
  assert.equal(capitale(piano.daSalvare), 0.02);
  assert.ok(piano.daSalvare.every(s => s.importo > 0));

  const normale = scadenzeDi({ totalInpsSaldo: 1200, totalInps1stAcconto: 480, totalInps2ndAcconto: 480, numberOfTranches: 3 });
  assert.equal(capitale(normale), 2160);
});
