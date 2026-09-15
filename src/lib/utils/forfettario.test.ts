import test from 'node:test';
import assert from 'node:assert/strict';

import { calcolaFiscale } from './calculations';
import {
  calcolaAccontiForfettario,
  calcolaContributiPrevidenziali,
  calcolaCoefficienteMedioAteco,
  getAliquotaImpostaSostitutiva,
  getCoefficienteRedditivita,
  getGestionePrevidenzialeLabel,
  getRegimeThresholdStatus,
  getCassaWarning,
  getInpsCalculationInput,
} from './forfettario';

test('maps ambulantato non alimentare ATECO 47.82 to 54%', () => {
  assert.equal(getCoefficienteRedditivita('47.82.10'), 54);
});

test('maps professional ATECO 72 to 78%', () => {
  assert.equal(getCoefficienteRedditivita('72.11.00'), 78);
});

test('averages full official ATECO coefficients instead of two-digit shortcuts', () => {
  assert.equal(calcolaCoefficienteMedioAteco(['47.82.10', '72.11.00']), 66);
});

test('keeps the 5% startup rate for the fifth fiscal year', () => {
  assert.equal(
    getAliquotaImpostaSostitutiva({
      annoApertura: 2021,
      annoImposta: 2025,
      aliquotaOverride: null,
    }),
    0.05,
  );
});

test('prefers manual tax-rate override when present', () => {
  assert.equal(
    getAliquotaImpostaSostitutiva({
      annoApertura: 2021,
      annoImposta: 2025,
      aliquotaOverride: 12.5,
    }),
    0.125,
  );
});

test('distinguishes delayed exit over 85k from immediate exit over 100k', () => {
  assert.equal(getRegimeThresholdStatus(90000), 'next_year_exit');
  assert.equal(getRegimeThresholdStatus(100001), 'immediate_exit');
});

test('calculates saldo and acconti with 50/50 substitute tax and 40/40 INPS split', () => {
  assert.deepEqual(
    calcolaAccontiForfettario({
      impostaSostitutiva: 7274,
      inps: 13684,
      accontiImpostaPagati: 1594,
      accontiInpsPagati: 5287,
    }),
    {
      taxSaldoLordo: 7274,
      taxSaldo: 5680,
      tax1stAcconto: 3637,
      tax2ndAcconto: 3637,
      inpsSaldoLordo: 13684,
      inpsSaldo: 8397,
      inps1stAcconto: 5473.6,
      inps2ndAcconto: 5473.6,
      accontiIrpefPagati: 1594,
      accontiInpsPagati: 5287,
    },
  );
});

test('never returns a negative saldo when previous acconti exceed annual tax', () => {
  const result = calcolaAccontiForfettario({
    impostaSostitutiva: 1000,
    inps: 2000,
    accontiImpostaPagati: 1500,
    accontiInpsPagati: 2500,
  });

  assert.equal(result.taxSaldo, 0);
  assert.equal(result.inpsSaldo, 0);
  assert.equal(result.tax1stAcconto + result.tax2ndAcconto, 1000);
  assert.equal(result.inps1stAcconto + result.inps2ndAcconto, 1600);
});

test('computes gestione separata contributions from imponibile percentage', () => {
  const result = calcolaContributiPrevidenziali(33500, {
    gestionePrevidenziale: 'gestione_separata',
    contributiInpsFissi: null,
    riduzioneContributiva: false,
  });

  assert.equal(result.label, 'Gestione Separata (INPS)');
  assert.equal(result.usesFixedAmount, false);
  assert.equal(result.includeInpsInScadenze, true);
  assert.equal(result.amount, 8733.45);
  assert.equal(result.effectiveRate, 0.2607);
});

test('applies 35 percent reduction to fixed artigiani contributions', () => {
  const result = calcolaContributiPrevidenziali(33500, {
    gestionePrevidenziale: 'artigiani',
    contributiInpsFissi: 4521.36,
    riduzioneContributiva: true,
  });

  assert.equal(result.label, 'Gestione Artigiani');
  assert.equal(result.usesFixedAmount, true);
  assert.equal(result.includeInpsInScadenze, false);
  assert.equal(result.amount, 2941.49);
  assert.equal(result.reductionApplied, true);
});

test('uses fixed INPS amount as deductible contribution in fiscal calculation', () => {
  const result = calcolaFiscale(50000, 67, 0.15, { annualAmount: 2938.88 });

  assert.equal(result.imponibile, 33500);
  assert.equal(result.inps, 2938.88);
  assert.equal(result.irpef, 4584.17);
  assert.equal(result.totaleTasse, 7523.05);
  assert.equal(result.nettoStimato, 42476.95);
});

test('does not create INPS acconti in scadenze for artigiani fixed contributions', () => {
  const result = calcolaAccontiForfettario({
    gestionePrevidenziale: 'artigiani',
    impostaSostitutiva: 7274,
    inps: 2938.88,
    accontiImpostaPagati: 1594,
    accontiInpsPagati: 1200,
  });

  assert.equal(result.inpsSaldo, 1738.88);
  assert.equal(result.inps1stAcconto, 0);
  assert.equal(result.inps2ndAcconto, 0);
});

test('deduces only contributi versati (not full INPS) when provided', () => {
  const result = calcolaFiscale(78343.02, 67, 0.15, 0.2607, 3995);

  assert.equal(result.imponibile, 52489.82);
  assert.equal(result.inps, 13684.10);
  assert.equal(result.irpef, 7274.22);
});

test('deduces full INPS when contributiVersati is omitted', () => {
  const result = calcolaFiscale(78343.02, 67, 0.15, 0.2607);

  assert.equal(result.imponibile, 52489.82);
  assert.equal(result.inps, 13684.10);
  assert.equal(result.irpef, 5820.86);
});

test('returns readable labels for previdenziale management types', () => {
  assert.equal(getGestionePrevidenzialeLabel('gestione_separata'), 'Gestione Separata (INPS)');
  assert.equal(getGestionePrevidenzialeLabel('artigiani'), 'Gestione Artigiani');
  assert.equal(getGestionePrevidenzialeLabel('commercianti'), 'Gestione Commercianti');
});


test('professional funds use their own amounts and deductions, without INPS reductions or advances', () => {
  const config = {
    gestionePrevidenziale: 'cassa_ordinistica' as const,
    contributiInpsFissi: 9000, riduzioneContributiva: true,
    cassaOrdinistica: 'inarcassa' as const,
    contributiCassePerAnno: {
      inarcassa: { 2026: { annui: 6000, deducibili: 4000 } },
      enpap: { 2026: { annui: 3000, deducibili: 2500 } },
    },
  };
  const input = getInpsCalculationInput(config, 2026);
  const fiscal = calcolaFiscale(50000, 78, 0.15, input);
  assert.equal(fiscal.inps, 6000);
  assert.equal(fiscal.irpef, 5250);
  assert.equal(calcolaFiscale(50000, 78, 0.15, input, 0).irpef, 5850);
  const info = calcolaContributiPrevidenziali(39000, config, 2026);
  assert.equal(info.amount, fiscal.inps);
  assert.equal(info.reductionApplied, false);
  assert.equal(info.includeInpsInScadenze, false);
  assert.match(info.label, /Inarcassa/);
  assert.deepEqual(getInpsCalculationInput({ ...config, cassaOrdinistica: 'enpap' }, 2026), { annualAmount: 3000, deductibleAmount: 2500 });
  assert.deepEqual(getInpsCalculationInput({ ...config, cassaOrdinistica: 'eppi' }, 2026), { annualAmount: 0, deductibleAmount: 0 });
  const advances = calcolaAccontiForfettario({ gestionePrevidenziale: config.gestionePrevidenziale, impostaSostitutiva: fiscal.irpef, inps: fiscal.inps });
  assert.equal(advances.inps1stAcconto, 0);
  assert.equal(advances.inps2ndAcconto, 0);
});

test('fund configuration is isolated by year, preserves explicit zero and flags missing values', () => {
  const config = {
    gestionePrevidenziale: 'cassa_ordinistica' as const,
    contributiInpsFissi: null, riduzioneContributiva: false,
    cassaOrdinistica: 'enpap' as const,
    contributiCassePerAnno: { enpap: {
      2025: { annui: 2000, deducibili: 1000 },
      2026: { annui: 3000, deducibili: 0 },
      2027: { annui: 0, deducibili: 0 },
    } },
  };
  assert.equal(getGestionePrevidenzialeLabel('cassa_ordinistica'), 'Cassa professionale');
  assert.equal(calcolaFiscale(50000, 78, 0.15, getInpsCalculationInput(config, 2025)).irpef, 5700);
  assert.equal(calcolaFiscale(50000, 78, 0.15, getInpsCalculationInput(config, 2026)).irpef, 5850);
  assert.equal(getCassaWarning(config, 2026), null);
  assert.equal(getCassaWarning(config, 2027), null);
  assert.match(getCassaWarning(config, 2024)!, /2024/);
  assert.deepEqual(getInpsCalculationInput(config, 2024), { annualAmount: 0, deductibleAmount: 0 });
  assert.ok(getCassaWarning({ ...config, cassaOrdinistica: undefined }, 2026));
  assert.ok(getCassaWarning({ ...config, cassaOrdinistica: 'invalid' as typeof config.cassaOrdinistica }, 2026));
  assert.equal(getCassaWarning({ ...config, gestionePrevidenziale: 'gestione_separata' }, 2026), null);
});


test('automatic INPS uses annual minima, income brackets and individual caps', () => {
  const config = { gestionePrevidenziale: 'artigiani' as const, contributiInpsFissi: null, riduzioneContributiva: false };
  const amount = (income: number, overrides = {}, year = 2026) => calcolaFiscale(income, 100, 0.15, getInpsCalculationInput({ ...config, ...overrides }, year)).inps;
  assert.equal(amount(0), 4521.36);
  assert.equal(amount(18808), 4521.36);
  assert.equal(amount(20000), 4807.44);
  assert.equal(amount(60000), 14445.20);
  assert.equal(amount(200000), 30018.95);
  assert.equal(amount(200000, { inpsAnte1996: true }), 22871.95);
  assert.equal(amount(0, {}, 2025), 4460.64);
  assert.equal(amount(0, { gestionePrevidenziale: 'commercianti' }), 4611.64);
  assert.equal(amount(60000, { gestionePrevidenziale: 'commercianti' }), 14733.20);
  assert.equal(amount(0, { riduzioneContributiva: true }), 2941.49);
  assert.equal(amount(60000, { riduzioneContributiva: true }), 9391.98);
  assert.equal(amount(60000, { contributiInpsFissi: 5000 }), 5000);
  assert.equal(getCassaWarning(config, 2026), null);
  assert.match(getCassaWarning(config, 2024)!, /2024/);
  assert.equal(calcolaContributiPrevidenziali(60000, config, 2026).amount, amount(60000));
});

test('Gestione Separata coverage choice is shared by fiscal calculation and breakdown', () => {
  const config = { gestionePrevidenziale: 'gestione_separata' as const, contributiInpsFissi: null, riduzioneContributiva: false, gestioneSeparataAltraCopertura: true };
  assert.equal(getInpsCalculationInput(config, 2026), 0.24);
  assert.equal(calcolaContributiPrevidenziali(10000, config, 2026).amount, 2400);
  assert.equal(calcolaFiscale(10000, 100, 0.15, getInpsCalculationInput(config, 2026)).inps, 2400);
});
