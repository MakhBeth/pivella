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
  validaDeduzioneInpsConfig,
} from './deduzioneInps';

const config = (overrides: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', ...overrides });

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

test('unpaid scadenze never count, even with a dataPagamento left over', () => {
  const s = scadenza({ pagato: false, dataPagamento: '2026-06-30', importo: 1000 });
  const deduzione = risolviDeduzioneInps(config(), 2026, [s]);
  assert.equal(deduzione.contributiVersati, 0);
  assert.equal(deduzione.fonte, 'nessun_versamento');
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
