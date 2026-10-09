import test from 'node:test';
import assert from 'node:assert/strict';

import type { Config, Scadenza } from '../../types';
import { DEFAULT_CONFIG } from '../constants/fiscali';
import { calcolaFiscale } from './calculations';
import { getInpsCalculationInput } from './forfettario';
import {
  getContributiInpsManuali,
  risolviDeduzioneInps,
  setContributiInpsManuali,
  sommaVersamentiInps,
  stimaVersamentiInps,
  validaDeduzioneInpsConfig,
} from './deduzioneInps';
import type { Fattura } from '../../types';

const config = (overrides: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', annoApertura: 2020, ...overrides });

let seq = 0;
const scadenza = (overrides: Partial<Scadenza>): Scadenza => ({
  id: `s${++seq}`, userId: 'u1', visibleId: `v${seq}`, annoRiferimento: 2025, annoVersamento: 2026,
  date: '2026-06-30', tipo: 'saldo_inps', label: 'Saldo INPS', importo: 100, interessi: 0, totale: 100, pagato: true,
  dataPagamento: '2026-06-30', ...overrides,
});

test('cash basis sums saldo of the previous year and acconti of the current year paid in the chosen year', () => {
  const scadenze = [
    scadenza({ tipo: 'saldo_inps', annoRiferimento: 2025, importo: 1200, dataPagamento: '2026-06-30' }),
    scadenza({ tipo: 'acconto_inps', annoRiferimento: 2025, importo: 800, dataPagamento: '2026-07-16' }),
    scadenza({ tipo: 'acconto_inps', annoRiferimento: 2025, importo: 800, dataPagamento: '2026-12-01' }),
    // Imposta sostitutiva: non è un contributo.
    scadenza({ tipo: 'saldo_irpef', importo: 5000, dataPagamento: '2026-06-30' }),
  ];
  const deduzione = risolviDeduzioneInps(config(), 2026, scadenze);
  assert.equal(deduzione.fonte, 'scadenze');
  assert.equal(deduzione.contributiVersati, 2800);
  assert.equal(deduzione.versamentiConteggiati, 3);
  assert.equal(deduzione.previsionale, false);
  assert.deepEqual(deduzione.avvisi, []);
});

test('only the capital counts: interest on instalments is excluded', () => {
  const s = scadenza({ importo: 500, interessi: 3.3, totale: 503.3, dataPagamento: '2026-07-16' });
  assert.equal(sommaVersamentiInps([s], 2026).totale, 500);
});

test('a payment straddling two years counts in the year of dataPagamento, not of the due date', () => {
  const s = scadenza({ tipo: 'acconto_inps', annoRiferimento: 2025, annoVersamento: 2025, date: '2025-12-01', importo: 700, dataPagamento: '2026-01-12' });
  assert.equal(risolviDeduzioneInps(config(), 2025, [s]).contributiVersati, 0);
  assert.equal(risolviDeduzioneInps(config(), 2026, [s]).contributiVersati, 700);
});

test('a paid scadenza without dataPagamento is not dated from due date or annoRiferimento, it is reported', () => {
  const senzaData = scadenza({ date: '2026-06-30', annoRiferimento: 2026, dataPagamento: undefined, importo: 900 });
  const dataRotta = scadenza({ dataPagamento: '2026-02-30', importo: 50 });
  const valida = scadenza({ importo: 300, dataPagamento: '2026-06-30' });
  const deduzione = risolviDeduzioneInps(config(), 2026, [senzaData, dataRotta, valida]);
  assert.equal(deduzione.contributiVersati, 300);
  assert.equal(deduzione.versamentiSenzaData, 2);
  assert.match(deduzione.avvisi.join(' '), /2 versamenti INPS .* non hanno la data di pagamento/);

  const soloSenzaData = risolviDeduzioneInps(config(), 2026, [senzaData]);
  assert.equal(soloSenzaData.contributiVersati, 0);
  assert.equal(soloSenzaData.fonte, 'nessun_versamento');
  assert.equal(soloSenzaData.avvisi.length, 2);
});

test('unpaid scadenze are never counted as paid; those planned for the year are an estimate', () => {
  const pianoAnno = scadenza({ pagato: false, dataPagamento: '2026-06-30', importo: 1000 });
  assert.equal(sommaVersamentiInps([pianoAnno], 2026).totale, 0);
  const deduzione = risolviDeduzioneInps(config(), 2026, [pianoAnno]);
  assert.equal(deduzione.contributiVersati, 1000);
  assert.equal(deduzione.stimato, true);
  assert.equal(deduzione.versamentiPrevisti, 1);
  assert.match(deduzione.avvisi[0], /previsti nel piano 2026 e non ancora segnati/);
  // Una scadenza non pagata di un altro anno non conta.
  const altroAnno = scadenza({ pagato: false, annoVersamento: 2025, importo: 500 });
  assert.equal(risolviDeduzioneInps(config(), 2026, [altroAnno]).contributiVersati, 0);
});

test('paid and still-planned scadenze of the year add up, so marking a payment does not change the deduction', () => {
  const giugno = scadenza({ tipo: 'saldo_inps', importo: 1200, pagato: false, dataPagamento: undefined });
  const novembre = scadenza({ tipo: 'acconto_inps', importo: 800, date: '2026-11-30', pagato: false, dataPagamento: undefined });
  const prima = risolviDeduzioneInps(config(), 2026, [giugno, novembre]);
  const dopo = risolviDeduzioneInps(config(), 2026, [{ ...giugno, pagato: true, dataPagamento: '2026-06-30' }, novembre]);
  const tutto = risolviDeduzioneInps(config(), 2026, [{ ...giugno, pagato: true, dataPagamento: '2026-06-30' }, { ...novembre, pagato: true, dataPagamento: '2026-11-30' }]);
  assert.deepEqual([prima.contributiVersati, dopo.contributiVersati, tutto.contributiVersati], [2000, 2000, 2000]);
  assert.deepEqual([prima.stimato, dopo.stimato, tutto.stimato], [true, true, false]);
});

test('without known payments the deduction is zero with a warning, never the INPS due', () => {
  const deduzione = risolviDeduzioneInps(config(), 2026, []);
  assert.equal(deduzione.contributiVersati, 0);
  assert.match(deduzione.avvisi[0], /Nessun versamento INPS .* 2026: la deduzione dei contributi è zero/);
  const fiscale = calcolaFiscale(50000, 78, 0.15, getInpsCalculationInput(config(), 2026), deduzione.contributiVersati);
  assert.equal(fiscale.deduzioneContributi, 0);
  assert.equal(fiscale.irpef, 5850);
});

test('manual yearly total replaces the scadenze sum; explicit zero differs from absent', () => {
  const scadenze = [scadenza({ importo: 1000 })];
  const manuale = risolviDeduzioneInps(config({ contributiInpsVersatiManuali: { 2026: 2500 } }), 2026, scadenze);
  assert.equal(manuale.fonte, 'manuale');
  assert.equal(manuale.contributiVersati, 2500); // sostitutivo, non 3500

  const zero = risolviDeduzioneInps(config({ contributiInpsVersatiManuali: { 2026: 0 } }), 2026, scadenze);
  assert.equal(zero.fonte, 'manuale');
  assert.equal(zero.contributiVersati, 0);
  assert.deepEqual(zero.avvisi, []);

  const assente = risolviDeduzioneInps(config({ contributiInpsVersatiManuali: {} }), 2026, scadenze);
  assert.equal(assente.fonte, 'scadenze');
  assert.equal(assente.contributiVersati, 1000);
});

test('manual totals are isolated by year and by profile', () => {
  const c = config({ contributiInpsVersatiManuali: { 2025: 999 } });
  assert.equal(getContributiInpsManuali(c, 2025), 999);
  assert.equal(getContributiInpsManuali(c, 2026), undefined);
  assert.equal(risolviDeduzioneInps(c, 2026, []).fonte, 'nessun_versamento');

  const altrui = scadenza({ userId: 'u2', importo: 4000 });
  assert.equal(risolviDeduzioneInps(config(), 2026, [altrui]).contributiVersati, 0);
  assert.equal(risolviDeduzioneInps(config({ id: 'config_u2', userId: 'u2' }), 2026, [altrui]).contributiVersati, 4000);
});

test('setContributiInpsManuali keeps other years, stores zero, and removes the key for absent', () => {
  const c = config({ contributiInpsVersatiManuali: { 2025: 10 } });
  assert.deepEqual(setContributiInpsManuali(c, 2026, 0), { 2025: 10, 2026: 0 });
  assert.deepEqual(setContributiInpsManuali(c, 2026, 12.345), { 2025: 10, 2026: 12.35 });
  assert.equal(setContributiInpsManuali(c, 2025, undefined), undefined);
});

test('competenza deducts the estimated INPS due, ignores the cash override and is labelled previsionale', () => {
  const c = config({ deduzioneInpsModalita: 'competenza', contributiInpsVersatiManuali: { 2026: 100 } });
  const deduzione = risolviDeduzioneInps(c, 2026, [scadenza({ importo: 1000 })]);
  assert.equal(deduzione.contributiVersati, 'competenza');
  assert.equal(deduzione.previsionale, true);
  assert.match(deduzione.avvisi[0], /previsionale/);
  const fiscale = calcolaFiscale(50000, 78, 0.15, getInpsCalculationInput(c, 2026), deduzione.contributiVersati);
  assert.equal(fiscale.deduzioneContributi, fiscale.inps);
});

test('switching mode never changes the INPS due', () => {
  const scadenze = [scadenza({ importo: 1000 })];
  const inps = (c: Config) => calcolaFiscale(50000, 78, 0.15, getInpsCalculationInput(c, 2026), risolviDeduzioneInps(c, 2026, scadenze).contributiVersati).inps;
  const cassa = config();
  const competenza = config({ deduzioneInpsModalita: 'competenza' });
  const artigiano = config({ gestionePrevidenziale: 'artigiani', contributiInpsFissi: 4500 });
  assert.equal(inps(cassa), inps(competenza));
  assert.equal(inps(cassa), 10167.3); // 39.000 × 26,07%
  assert.equal(inps(artigiano), inps({ ...artigiano, deduzioneInpsModalita: 'competenza' }));
});

test('legacy configs without the new fields deduct on a cash basis', () => {
  const legacy = config();
  assert.equal('deduzioneInpsModalita' in legacy, false);
  assert.equal(risolviDeduzioneInps(legacy, 2026, [scadenza({ importo: 10 })]).modalita, 'cassa');
  // Nessun default nuovo nella config: caricarla non la rende diversa dal salvato.
  assert.equal('deduzioneInpsModalita' in DEFAULT_CONFIG, false);
  assert.equal('contributiInpsVersatiManuali' in DEFAULT_CONFIG, false);
});

test('professional funds ignore the INPS choice and keep their configured deductible amount', () => {
  for (const modalita of ['cassa', 'competenza'] as const) {
    const c = config({
      gestionePrevidenziale: 'cassa_ordinistica', cassaOrdinistica: 'enpap', deduzioneInpsModalita: modalita,
      contributiInpsVersatiManuali: { 2026: 1 },
      contributiCassePerAnno: { enpap: { 2026: { annui: 3000, deducibili: 1000 } } },
    });
    const deduzione = risolviDeduzioneInps(c, 2026, [scadenza({ importo: 777 })]);
    assert.equal(deduzione.fonte, 'cassa_professionale');
    assert.equal(deduzione.contributiVersati, undefined);
    const fiscale = calcolaFiscale(50000, 78, 0.15, getInpsCalculationInput(c, 2026), deduzione.contributiVersati);
    assert.equal(fiscale.deduzioneContributi, 1000);
    assert.equal(fiscale.irpef, 5700);
  }
});

test('validaDeduzioneInpsConfig accepts legacy and well-formed data, rejects malformed', () => {
  assert.equal(validaDeduzioneInpsConfig({}), null);
  assert.equal(validaDeduzioneInpsConfig({ deduzioneInpsModalita: 'competenza', contributiInpsVersatiManuali: { 2025: 0, 2026: 10.5 } }), null);
  assert.match(validaDeduzioneInpsConfig({ deduzioneInpsModalita: 'mista' })!, /deduzioneInpsModalita/);
  assert.match(validaDeduzioneInpsConfig({ contributiInpsVersatiManuali: [1] })!, /non è un oggetto/);
  assert.match(validaDeduzioneInpsConfig({ contributiInpsVersatiManuali: { 2026: -1 } })!, /2026/);
  assert.match(validaDeduzioneInpsConfig({ contributiInpsVersatiManuali: { 2026: '10' } })!, /2026/);
  assert.match(validaDeduzioneInpsConfig({ contributiInpsVersatiManuali: { anno: 10 } })!, /anno/);
});

test('artigiani and commercianti are told their contributions are not in the Scadenze plan', () => {
  for (const gestionePrevidenziale of ['artigiani', 'commercianti'] as const) {
    const deduzione = risolviDeduzioneInps(config({ gestionePrevidenziale, contributiInpsFissi: 4500 }), 2026, []);
    assert.equal(deduzione.contributiVersati, 0);
    assert.match(deduzione.avvisi[0], /non sono nel piano Scadenze: inserisci il totale versato/);
  }
  assert.doesNotMatch(risolviDeduzioneInps(config(), 2026, []).avvisi[0], /Artigiani/);
});

const fattura = (data: string, importo: number, overrides: Partial<Fattura> = {}): Fattura =>
  ({ id: `f${++seq}`, userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', data, importo, ...overrides });
// ATECO 70.22 → coefficiente 78%; Gestione Separata 26,07%.
const cfg = config({ codiciAteco: ['70.22'] });

test('without a plan, saldo of N-1 and acconti of N are estimated from invoices and deducted as an estimate', () => {
  const fatture = [fattura('2024-03-01', 50000), fattura('2023-03-01', 40000), fattura('2024-12-20', 999, { incassato: false })];
  const d2024 = 50000 * 0.78 * 0.2607; // 10.167,30
  const d2023 = 40000 * 0.78 * 0.2607; // 8.133,84
  const atteso = Math.round(((d2024 - 0.8 * d2023) + 0.8 * d2024) * 100) / 100;
  assert.equal(stimaVersamentiInps(cfg, 2025, fatture)!.importo, atteso);
  const deduzione = risolviDeduzioneInps(cfg, 2025, [], fatture);
  assert.deepEqual([deduzione.fonte, deduzione.contributiVersati, deduzione.stimato], ['stima', atteso, true]);
  assert.match(deduzione.avvisi[0], /^Stima: saldo 2024 e acconti 2025 calcolati dalle fatture incassate nel 2023 e nel 2024/);
});

test('without invoices two years back no acconti are assumed paid, and it is said', () => {
  const stima = stimaVersamentiInps(cfg, 2025, [fattura('2024-03-01', 50000)])!;
  assert.equal(stima.importo, 18301.14); // 10.167,30 × 1,8
  assert.match(stima.descrizione, /senza fatture del 2023/);
});

test('priority: manual total, then scadenze, then invoice estimate', () => {
  const fatture = [fattura('2024-03-01', 50000)];
  const piano = [scadenza({ tipo: 'saldo_inps', annoVersamento: 2025, importo: 1200, pagato: false, dataPagamento: undefined })];
  assert.equal(risolviDeduzioneInps(cfg, 2025, piano, fatture).fonte, 'scadenze');
  assert.equal(risolviDeduzioneInps(cfg, 2025, piano, fatture).contributiVersati, 1200);
  assert.equal(risolviDeduzioneInps(cfg, 2025, [], fatture).fonte, 'stima');
  const manuale = config({ codiciAteco: ['70.22'], contributiInpsVersatiManuali: { 2025: 0 } });
  assert.deepEqual([risolviDeduzioneInps(manuale, 2025, piano, fatture).fonte, risolviDeduzioneInps(manuale, 2025, piano, fatture).contributiVersati], ['manuale', 0]);
});

test('no estimate without data, for other profiles, or outside Gestione Separata', () => {
  assert.equal(stimaVersamentiInps(cfg, 2025, []), null);
  assert.equal(stimaVersamentiInps(cfg, 2025, [fattura('2024-03-01', 50000, { userId: 'u2' })]), null);
  assert.equal(stimaVersamentiInps(config({ gestionePrevidenziale: 'artigiani', contributiInpsFissi: 4500 }), 2025, [fattura('2024-03-01', 50000)]), null);
  assert.equal(risolviDeduzioneInps(config({ gestionePrevidenziale: 'artigiani', contributiInpsFissi: 4500 }), 2025, [], [fattura('2024-03-01', 50000)]).fonte, 'nessun_versamento');
});

test('first year of Gestione Separata deducts nothing; the year after the first-year saldo and acconti are estimated', () => {
  const nuovo = config({ annoApertura: 2025, codiciAteco: ['70.22'] });
  const fatture = [fattura('2025-03-01', 50000), fattura('2024-03-01', 99999)];
  const primo = risolviDeduzioneInps(nuovo, 2025, [], fatture);
  assert.equal(primo.contributiVersati, 0);
  assert.match(primo.avvisi[0], /Primo anno di attività: nel 2025 non si versano/);
  assert.equal(stimaVersamentiInps(nuovo, 2025, fatture), null);

  const secondo = risolviDeduzioneInps(nuovo, 2026, [], fatture);
  assert.deepEqual([secondo.fonte, secondo.contributiVersati], ['stima', 18301.14]);
  assert.match(secondo.avvisi[0], /primo anno di attività/);
});
