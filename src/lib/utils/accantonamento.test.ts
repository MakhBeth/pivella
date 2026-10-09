import test from 'node:test';
import assert from 'node:assert/strict';

import type { Config, Fattura, Scadenza } from '../../types';
import { DEFAULT_CONFIG } from '../constants/fiscali';
import { calcolaAccantonamento, calcolaFiscaleAnno } from './accantonamento';

// Profilo aperto nel 2025, Gestione Separata, ATECO 62.01 (coefficiente 67%), aliquota agevolata 5%.
const config: Config = { ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', annoApertura: 2025, codiciAteco: ['62.01'] };
let seq = 0;
const fattura = (data: string, importo: number): Fattura => ({ id: `f${++seq}`, userId: 'u1', clienteId: 'c1', clienteNome: 'Cliente', data, importo });
const fatture = [fattura('2025-05-10', 82485), fattura('2026-04-10', 69248)];

const accantona = (anno: number, scadenze: Scadenza[] = []) => {
  const { fiscale } = calcolaFiscaleAnno(config, anno, fatture, scadenze);
  return calcolaAccantonamento(config, anno, fiscale, fatture, scadenze);
};

test('first year: no acconti yet, so the saldo plus next year acconti is almost double the amount due', () => {
  const a = accantona(2025);
  assert.deepEqual(a.dovuto, { imposta: 2763.25, inps: 14407.57, totale: 17170.82 });
  assert.equal(a.acconti.totale, 0);
  assert.equal(a.acconti.fonte, 'nessuno');
  assert.deepEqual(a.saldo, a.dovuto);
  // Acconti d'imposta in due metà arrotondate (1.381,63 × 2), come nel piano Scadenze.
  assert.deepEqual(a.accontiSuccessivi, { imposta: 2763.26, inps: 11526.06, totale: 14289.32 });
  assert.equal(a.totale, 31460.14); // uguale al totale del piano 2026 in Scadenze
});

test('second year: the acconti already paid cover the amount due and the saldo can be a credit', () => {
  const a = accantona(2026);
  // Deduzione INPS 2026 stimata: saldo 2025 + acconti 2026 = 25.933,63.
  assert.deepEqual(a.dovuto, { imposta: 1023.13, inps: 12095.48, totale: 13118.61 });
  assert.deepEqual([a.acconti.imposta, a.acconti.inps, a.acconti.fonte, a.acconti.stimato], [2763.26, 11526.06, 'stima', true]);
  assert.deepEqual(a.saldo, { imposta: -1740.13, inps: 569.42, totale: -1170.71 });
  assert.deepEqual(a.accontiSuccessivi, { imposta: 1023.14, inps: 9676.38, totale: 10699.52 });
  assert.equal(a.totale, 9528.81);
});

test('a saved plan provides the acconti of the year, and marks them as an estimate until paid', () => {
  const riga = (tipo: Scadenza['tipo'], importo: number, pagato: boolean): Scadenza => ({
    id: `s${++seq}`, userId: 'u1', visibleId: `v${seq}`, annoRiferimento: 2025, annoVersamento: 2026, date: '2026-06-30',
    tipo, label: tipo, importo, interessi: 5, totale: importo + 5, pagato, ...(pagato ? { dataPagamento: '2026-06-30' } : {}),
  });
  const piano = [riga('saldo_irpef', 2763.25, true), riga('acconto_irpef', 1500, true), riga('acconto_irpef', 1500, false), riga('acconto_inps', 6000, true), riga('acconto_inps', 6000, false)];
  const a = accantona(2026, piano);
  assert.deepEqual([a.acconti.imposta, a.acconti.inps, a.acconti.fonte, a.acconti.stimato], [3000, 12000, 'piano', true]);

  const tuttoPagato = piano.map(s => ({ ...s, pagato: true, dataPagamento: '2026-06-30' }));
  assert.equal(accantona(2026, tuttoPagato).acconti.stimato, false);
});

test('a year without invoices the year before has no acconti to subtract', () => {
  const vuoto: Config = { ...config, annoApertura: 2020 };
  const { fiscale } = calcolaFiscaleAnno(vuoto, 2025, fatture, []);
  const a = calcolaAccantonamento(vuoto, 2025, fiscale, fatture, []);
  assert.equal(a.acconti.fonte, 'nessuno');
  assert.equal(a.acconti.totale, 0);
});
