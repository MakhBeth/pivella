import test from 'node:test';
import assert from 'node:assert/strict';

import type { Scadenza, ScadenzaTipo } from '../../types';
import { accontiUsatiDalPiano, rigeneraPreservandoPagate } from './rigeneraScadenze';
import { risolviDeduzioneInps } from './deduzioneInps';
import { DEFAULT_CONFIG } from '../constants/fiscali';

const round2 = (v: number) => Math.round(v * 100) / 100;
const DATE = ['2026-06-30', '2026-07-16', '2026-08-20', '2026-09-16', '2026-10-16', '2026-11-16'];

// Rate di una voce come le crea Scadenze: capitale diviso in parti uguali, interessi 0,33% al mese dalla 2ª.
function rate(tipo: ScadenzaTipo, gruppo: string, totale: number, n: number, idPrefix: string): Scadenza[] {
  const quota = round2(totale / n);
  return Array.from({ length: n }, (_, i) => {
    const importo = i === n - 1 ? round2(totale - quota * (n - 1)) : quota;
    const interessi = round2(importo * i * 0.0033);
    return {
      id: `${idPrefix}-${gruppo}-${i}`, userId: 'u1', visibleId: `2026-${gruppo}-${i}`, annoRiferimento: 2025, annoVersamento: 2026,
      date: DATE[i], tipo, label: n > 1 ? `Saldo INPS (${i + 1}/${n})` : 'Saldo INPS',
      importo, interessi, totale: round2(importo + interessi), pagato: false, trancheIndex: i, totalTranches: n,
    };
  });
}

const paga = (s: Scadenza, dataPagamento: string): Scadenza => ({ ...s, pagato: true, dataPagamento });

test('paid instalments are never deleted nor changed, unpaid ones are replaced', () => {
  const esistenti = rate('saldo_inps', 'saldo-inps', 3000, 3, 'old');
  esistenti[0] = paga(esistenti[0], '2026-06-28');
  const generate = rate('saldo_inps', 'saldo-inps', 3600, 3, 'new');
  const piano = rigeneraPreservandoPagate(esistenti, generate);

  assert.deepEqual(piano.daEliminare, ['old-saldo-inps-1', 'old-saldo-inps-2']);
  assert.ok(!piano.daSalvare.some(s => s.visibleId === esistenti[0].visibleId), 'la rata pagata non viene riscritta');
  // Nuovo dovuto 3600, già pagati 1000: il resto sulle due rate libere.
  assert.deepEqual(piano.daSalvare.map(s => s.importo), [1300, 1300]);
  assert.equal(round2(esistenti[0].importo + piano.daSalvare.reduce((sum, s) => sum + s.importo, 0)), 3600);
  assert.deepEqual(piano.daSalvare.map(s => s.interessi), [4.29, 8.58]);
  assert.deepEqual(piano.avvisi, []);
});

test('changing the number of instalments keeps paid ones intact and replans only the remainder', () => {
  const esistenti = rate('saldo_inps', 'saldo-inps', 3000, 3, 'old').map((s, i) => i < 2 ? paga(s, `2026-0${6 + i}-30`) : s);
  const snapshotPagate = JSON.stringify(esistenti.filter(s => s.pagato));

  const seiRate = rigeneraPreservandoPagate(esistenti, rate('saldo_inps', 'saldo-inps', 3000, 6, 'new'));
  assert.deepEqual(seiRate.daEliminare, ['old-saldo-inps-2']);
  assert.deepEqual(seiRate.daSalvare.map(s => s.trancheIndex), [2, 3, 4, 5]);
  assert.equal(round2(seiRate.daSalvare.reduce((sum, s) => sum + s.importo, 0)), 1000);

  const unaRata = rigeneraPreservandoPagate(esistenti, rate('saldo_inps', 'saldo-inps', 3000, 1, 'new'));
  assert.match(unaRata.blocchi[0], /restano 1\.000 € da versare/);

  assert.equal(JSON.stringify(esistenti.filter(s => s.pagato)), snapshotPagate, 'gli oggetti pagati non sono mutati');
});

test('paying more than the new amount due adds nothing and warns', () => {
  const esistenti = [paga(rate('saldo_inps', 'saldo-inps', 3000, 1, 'old')[0], '2026-06-30')];
  const piano = rigeneraPreservandoPagate(esistenti, rate('saldo_inps', 'saldo-inps', 2000, 1, 'new'));
  assert.deepEqual(piano.daEliminare, []);
  assert.deepEqual(piano.daSalvare, []);
  assert.match(piano.avvisi[0], /più del nuovo dovuto/);
});

test('groups without payments are regenerated as is, other groups keep their payments', () => {
  const inps = paga(rate('saldo_inps', 'saldo-inps', 1000, 1, 'old')[0], '2026-06-30');
  const irpef = rate('saldo_irpef', 'saldo-irpef', 500, 1, 'old')[0];
  const generate = [...rate('saldo_inps', 'saldo-inps', 1000, 1, 'new'), ...rate('saldo_irpef', 'saldo-irpef', 800, 1, 'new')];
  const piano = rigeneraPreservandoPagate([inps, irpef], generate);
  assert.deepEqual(piano.daEliminare, [irpef.id]);
  assert.deepEqual(piano.daSalvare.map(s => [s.visibleId, s.importo]), [['2026-saldo-irpef-0', 800]]);
});

test('regenerating does not change the cash deduction of payments already made', () => {
  const config = { ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1' };
  const esistenti = rate('saldo_inps', 'saldo-inps', 3000, 3, 'old');
  esistenti[0] = paga(esistenti[0], '2026-06-30');
  const prima = risolviDeduzioneInps(config, 2026, esistenti).contributiVersati;

  const piano = rigeneraPreservandoPagate(esistenti, rate('saldo_inps', 'saldo-inps', 9000, 2, 'new'));
  const dopo = [...esistenti.filter(s => !piano.daEliminare.includes(s.id)), ...piano.daSalvare.map(s => ({ ...s, userId: 'u1' }))];
  assert.equal(prima, 1000);
  assert.equal(risolviDeduzioneInps(config, 2026, dopo).contributiVersati, 1000);
});

test('the remainder is split in whole cents, never negative, and zero-cent instalments are dropped', () => {
  const esistenti = rate('saldo_inps', 'saldo-inps', 6, 6, 'old');
  esistenti[0] = paga({ ...esistenti[0], importo: 5.97, totale: 5.97 }, '2026-06-30');
  const piano = rigeneraPreservandoPagate(esistenti, rate('saldo_inps', 'saldo-inps', 6, 6, 'new'));
  // Residuo 0,03 su 5 rate libere: tre rate da un centesimo, nessuna negativa o a zero.
  assert.deepEqual(piano.daSalvare.map(s => s.importo), [0.01, 0.01, 0.01]);
  assert.ok(piano.daSalvare.every(s => s.importo > 0 && s.totale > 0));

  const altro = rigeneraPreservandoPagate([paga(rate('saldo_inps', 'saldo-inps', 100, 3, 'old')[0], '2026-06-30')], rate('saldo_inps', 'saldo-inps', 133.36, 3, 'new'));
  assert.deepEqual(altro.daSalvare.map(s => s.importo), [50.02, 50.01]);
  assert.equal(round2(33.33 + altro.daSalvare.reduce((sum, s) => sum + s.importo, 0)), 133.36); // pagata + nuove = nuovo dovuto
});

test('from 2 to 1 instalment with the first paid, the plan is blocked before any write', () => {
  const esistenti = rate('saldo_inps', 'saldo-inps', 1000, 2, 'old');
  esistenti[0] = paga(esistenti[0], '2026-06-30');
  const piano = rigeneraPreservandoPagate(esistenti, rate('saldo_inps', 'saldo-inps', 1000, 1, 'new'));
  assert.equal(piano.blocchi.length, 1);
  assert.match(piano.blocchi[0], /restano 500 € da versare/);
  // Chi usa il piano non scrive nulla quando ci sono blocchi (vedi Scadenze.handleRegenerateScadenze).
});

test('paid capital of a line missing from the new plan is reported and kept', () => {
  const pagata = paga(rate('acconto_inps', 'acconto-inps-2', 400, 1, 'old')[0], '2026-11-30');
  const piano = rigeneraPreservandoPagate([pagata], rate('saldo_irpef', 'saldo-irpef', 100, 1, 'new'));
  assert.deepEqual(piano.daEliminare, []);
  assert.match(piano.avvisi[0], /già versati 400 €/);
  assert.equal(piano.blocchi.length, 0);
});

test('legacy paid scadenze without trancheIndex never collide with a regenerated visibleId', () => {
  const legacy = rate('saldo_inps', 'saldo-inps', 900, 3, 'old').map(({ trancheIndex: _t, totalTranches: _n, ...s }) => s as Scadenza);
  legacy[1] = paga(legacy[1], '2026-07-16');
  const piano = rigeneraPreservandoPagate(legacy, rate('saldo_inps', 'saldo-inps', 900, 3, 'new'));
  const ids = [legacy[1].visibleId, ...piano.daSalvare.map(s => s.visibleId)];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(piano.daSalvare.map(s => [s.trancheIndex, s.importo]), [[0, 300], [2, 300]]);
});

test('plan metadata stay coherent on paid scadenze across reopen and a second regeneration', () => {
  const generaCon = (irpef: number, inps: number, prefix: string) =>
    rate('saldo_inps', 'saldo-inps', 1000, 2, prefix).map(s => ({ ...s, accontiIrpefUsed: irpef, accontiInpsUsed: inps }));
  let salvate: Scadenza[] = generaCon(100, 50, 'a');
  salvate[0] = paga(salvate[0], '2026-06-30');
  const pagataOriginale = { ...salvate[0] };

  const applica = (piano: ReturnType<typeof rigeneraPreservandoPagate>) => {
    assert.deepEqual(piano.blocchi, []);
    const aggiornate = new Map(piano.pagateDaAggiornare.map(s => [s.id, s]));
    return [
      ...salvate.filter(s => !piano.daEliminare.includes(s.id)).map(s => aggiornate.get(s.id) ?? s),
      ...piano.daSalvare.map(s => ({ ...s, userId: 'u1' })),
    ];
  };

  salvate = applica(rigeneraPreservandoPagate(salvate, generaCon(300, 80, 'b'), { accontiIrpefUsed: 300, accontiInpsUsed: 80 }));
  // Riapertura: la pagina rilegge gli acconti dal piano, anche se il primo record è la rata pagata.
  assert.equal(salvate[0].id, pagataOriginale.id);
  assert.deepEqual(accontiUsatiDalPiano(salvate), { irpef: 300, inps: 80 });
  const { accontiIrpefUsed: _i, accontiInpsUsed: _p, updatedAt: _u, ...fissi } = salvate[0];
  const { accontiIrpefUsed: _i0, accontiInpsUsed: _p0, updatedAt: _u0, ...fissiOriginali } = pagataOriginale;
  assert.deepEqual(fissi, fissiOriginali, 'importo, interessi, date e dataPagamento invariati');

  salvate = applica(rigeneraPreservandoPagate(salvate, generaCon(0, 0, 'c'), { accontiIrpefUsed: 0, accontiInpsUsed: 0 }));
  assert.deepEqual(accontiUsatiDalPiano(salvate), { irpef: 0, inps: 0 });
  assert.equal(salvate.find(s => s.id === pagataOriginale.id)!.importo, pagataOriginale.importo);
});
