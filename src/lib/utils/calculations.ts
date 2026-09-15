import type { WorkLog } from '../../types';
import { LIMITE_FATTURATO, INPS_GESTIONE_SEPARATA, COEFFICIENTI_ATECO } from '../constants/fiscali';

export type InpsCalculationInput = number | {
  annualAmount: number;
  deductibleAmount?: number;
  formula?: { minimo: number; soglia: number; massimale: number; aliquota: number; riduzione: boolean };
};

export function calculateContribution(imponibile: number, input: InpsCalculationInput): number {
  if (typeof input === 'number') return imponibile * input;
  if (!input.formula) return input.annualAmount;
  const { minimo, soglia, massimale, aliquota, riduzione } = input.formula;
  const base = Math.min(massimale, Math.max(minimo, imponibile));
  const ivs = Math.min(base, soglia) * aliquota + Math.max(0, base - soglia) * (aliquota + 0.01);
  // Il contributo maternità rimane intero anche con riduzione del 35% (INPS messaggio 1947/2017).
  return Math.round((ivs * (riduzione ? 0.65 : 1) + 7.44) * 100) / 100;
}

const roundToTwoDecimals = (value: number): number => Math.round(value * 100) / 100;

// Get work log quantity (handles legacy ore field)
export const getWorkLogQuantita = (log: WorkLog): number => {
  // If quantita is defined, use it
  if (log.quantita !== undefined && log.quantita !== null) {
    return log.quantita;
  }
  // Backward compatibility: derive from ore or tipo
  if (log.tipo === 'giornata') {
    return 1;
  }
  if (log.tipo === 'ore' && log.ore) {
    return parseFloat(log.ore) || 0;
  }
  return 0;
};

// Calculate average ATECO coefficient
export const calcolaCoefficientiMedio = (codiciAteco: Record<string, number>): number => {
  const valori = Object.values(codiciAteco);
  if (valori.length === 0) return COEFFICIENTI_ATECO.default;
  const somma = valori.reduce((acc, val) => acc + val, 0);
  return somma / valori.length;
};

export interface CalcoloFiscale {
  imponibile: number;
  deduzioneContributi: number;
  inps: number;
  irpef: number;
  totaleTasse: number;
  nettoStimato: number;
  percentualeNetto: number;
  percentualeLimite: number;
}

// La deduzione esplicita dei contributi versati prevale anche quando vale zero.
// In sua assenza si usa deductibleAmount, se configurato per la cassa;
// per INPS si mantiene la stima basata sull’intero contributo dovuto.
export const calcolaFiscale = (
  fatturato: number,
  coefficiente: number,
  aliquotaIrpef: number,
  aliquotaInps: InpsCalculationInput = INPS_GESTIONE_SEPARATA,
  contributiVersati?: number,
): CalcoloFiscale => {
  const imponibile = fatturato * (coefficiente / 100);
  const inps = calculateContribution(imponibile, aliquotaInps);
  const deduzioneContributi = contributiVersati !== undefined ? contributiVersati : (typeof aliquotaInps === 'number' ? inps : aliquotaInps.deductibleAmount ?? inps);
  const imponibileDopoContributi = Math.max(0, imponibile - deduzioneContributi);
  const irpef = imponibileDopoContributi * aliquotaIrpef;
  const totaleTasse = irpef + inps;
  const nettoStimato = fatturato - totaleTasse;
  const percentualeNetto = fatturato > 0 ? (nettoStimato / fatturato) * 100 : 0;
  const percentualeLimite = (fatturato / LIMITE_FATTURATO) * 100;
  return {
    imponibile: roundToTwoDecimals(imponibile),
    deduzioneContributi: roundToTwoDecimals(deduzioneContributi),
    inps: roundToTwoDecimals(inps),
    irpef: roundToTwoDecimals(irpef),
    totaleTasse: roundToTwoDecimals(totaleTasse),
    nettoStimato: roundToTwoDecimals(nettoStimato),
    percentualeNetto,
    percentualeLimite,
  };
};

// Calculate progress percentage towards limit
export const calcolaProgressoLimite = (fatturato: number): number => {
  return (fatturato / LIMITE_FATTURATO) * 100;
};

// Check if approaching limit
export const isApproachingLimit = (fatturato: number): boolean => {
  return fatturato >= LIMITE_FATTURATO * 0.8; // 80% threshold
};

// Check if over limit
export const isOverLimit = (fatturato: number): boolean => {
  return fatturato > LIMITE_FATTURATO;
};
