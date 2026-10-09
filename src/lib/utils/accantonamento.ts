/**
 * Quanto accantonare per l'anno N, per cassa. Il dovuto di N è coperto in
 * parte dagli acconti di N già versati (o previsti) durante l'anno; il resto è
 * il saldo, che si paga a giugno di N+1 insieme agli acconti di N+1, calcolati
 * sul dovuto di N. Nel primo anno quindi si accantona quasi il doppio, e
 * l'anno dopo si parte in parte coperti (anche in credito).
 *
 *   da accantonare = (dovuto N − acconti N) + acconti N+1
 */
import type { Config, Fattura, Scadenza } from '../../types';
import { calcolaFiscale, type CalcoloFiscale } from './calculations';
import { calcolaAccontiForfettario, calcolaCoefficienteMedioAteco, getAliquotaImpostaSostitutiva, getInpsCalculationInput } from './forfettario';
import { risolviDeduzioneInps, type DeduzioneInps } from './deduzioneInps';

const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface ImportiAccantonamento {
  imposta: number;
  inps: number;
  totale: number;
}

export interface Accantonamento {
  anno: number;
  dovuto: ImportiAccantonamento;
  /** Acconti di N: dal piano Scadenze se c'è, altrimenti stimati dal dovuto di N-1. */
  acconti: ImportiAccantonamento & { fonte: 'piano' | 'stima' | 'nessuno'; stimato: boolean };
  /** Dovuto meno acconti: negativo è un credito. */
  saldo: ImportiAccantonamento;
  /** Acconti di N+1 (giugno e novembre), calcolati sul dovuto di N. */
  accontiSuccessivi: ImportiAccantonamento;
  totale: number;
}

const importi = (imposta: number, inps: number): ImportiAccantonamento =>
  ({ imposta: round2(imposta), inps: round2(inps), totale: round2(imposta + inps) });

type ConfigAnno = Config;

/** Fatturato incassato, deduzione INPS e calcolo fiscale dell'anno, come in Dashboard. */
export function calcolaFiscaleAnno(config: ConfigAnno, anno: number, fatture: readonly Fattura[], scadenze: readonly Scadenza[]): {
  fatturato: number;
  fiscale: CalcoloFiscale;
  deduzione: DeduzioneInps;
} {
  const userId = config.userId || undefined;
  const fatturato = round2(fatture
    .filter(f => (!userId || f.userId === userId) && f.incassato !== false && new Date(f.dataIncasso || f.data).getFullYear() === anno)
    .reduce((sum, f) => sum + f.importo, 0));
  const aliquota = getAliquotaImpostaSostitutiva({ annoApertura: config.annoApertura, annoImposta: anno, aliquotaOverride: config.aliquotaOverride });
  const deduzione = risolviDeduzioneInps(config, anno, scadenze, fatture);
  const fiscale = calcolaFiscale(fatturato, calcolaCoefficienteMedioAteco(config.codiciAteco ?? []), aliquota, getInpsCalculationInput(config, anno), deduzione.contributiVersati);
  return { fatturato, fiscale, deduzione };
}

const accontiDa = (config: Pick<Config, 'gestionePrevidenziale'>, fiscale: Pick<CalcoloFiscale, 'irpef' | 'inps'>) => {
  const a = calcolaAccontiForfettario({ gestionePrevidenziale: config.gestionePrevidenziale, impostaSostitutiva: fiscale.irpef, inps: fiscale.inps });
  return importi(a.tax1stAcconto + a.tax2ndAcconto, a.inps1stAcconto + a.inps2ndAcconto);
};

export function calcolaAccantonamento(
  config: ConfigAnno,
  anno: number,
  fiscale: Pick<CalcoloFiscale, 'irpef' | 'inps'>,
  fatture: readonly Fattura[],
  scadenze: readonly Scadenza[],
): Accantonamento {
  const userId = config.userId || undefined;
  const dovuto = importi(fiscale.irpef, fiscale.inps);

  // Acconti di N: stanno nel piano versato nell'anno N (annoVersamento N).
  const piano = scadenze.filter(s => (!userId || s.userId === userId) && s.annoVersamento === anno);
  let acconti: Accantonamento['acconti'];
  if (piano.length > 0) {
    const delTipo = (tipo: Scadenza['tipo']) => piano.filter(s => s.tipo === tipo);
    const somma = (righe: Scadenza[]) => righe.reduce((sum, s) => sum + s.importo, 0);
    const righe = [...delTipo('acconto_irpef'), ...delTipo('acconto_inps')];
    acconti = { ...importi(somma(delTipo('acconto_irpef')), somma(delTipo('acconto_inps'))), fonte: 'piano', stimato: righe.some(s => !s.pagato) };
  } else if (anno <= config.annoApertura) {
    acconti = { ...importi(0, 0), fonte: 'nessuno', stimato: false };
  } else {
    const precedente = calcolaFiscaleAnno(config, anno - 1, fatture, scadenze);
    const stimati = precedente.fatturato > 0 ? accontiDa(config, precedente.fiscale) : importi(0, 0);
    acconti = { ...stimati, fonte: precedente.fatturato > 0 ? 'stima' : 'nessuno', stimato: precedente.fatturato > 0 };
  }

  const saldo = importi(dovuto.imposta - acconti.imposta, dovuto.inps - acconti.inps);
  const accontiSuccessivi = accontiDa(config, fiscale);
  return { anno, dovuto, acconti, saldo, accontiSuccessivi, totale: round2(saldo.totale + accontiSuccessivi.totale) };
}
