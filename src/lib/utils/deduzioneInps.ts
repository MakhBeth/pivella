/**
 * Deduzione dei contributi INPS dall'imponibile del forfettario, condivisa da
 * Dashboard, Simulatore, Scadenze e server MCP.
 *
 * Nel forfettario i contributi si deducono per cassa (art. 1, comma 64,
 * L. 190/2014): conta ciò che è stato versato nell'anno, qualunque sia l'anno
 * di competenza (saldo dell'anno prima e acconti dell'anno in corso).
 * Quando i versamenti non sono ancora confermati si usano quelli attesi (piano
 * salvato o, in mancanza, saldo e acconti stimati dalle fatture), segnalati come stima.
 * "Competenza" deduce i dovuti stimati ed è solo una stima previsionale.
 * Le casse professionali restano sulla quota deducibile configurata.
 */
import type { Config, DeduzioneInpsModalita, Fattura, Scadenza } from '../../types';
import { isIsoDate } from './dateHelpers';
import { calcolaFiscale } from './calculations';
import { calcolaCoefficienteMedioAteco, getInpsCalculationInput } from './forfettario';
import { formatCurrency } from './formatting';

export const DEDUZIONE_INPS_DEFAULT: DeduzioneInpsModalita = 'cassa';

export type FonteDeduzioneInps = 'manuale' | 'scadenze' | 'stima' | 'nessun_versamento' | 'dovuti_stimati' | 'cassa_professionale';

export interface DeduzioneInps {
  /** null per le casse professionali, che non usano questa scelta. */
  modalita: DeduzioneInpsModalita | null;
  fonte: FonteDeduzioneInps;
  /** Valore da passare a calcolaFiscale come contributiVersati. */
  contributiVersati: number | 'competenza' | undefined;
  /** Importo dedotto quando è noto prima del calcolo (cassa), altrimenti null. */
  importo: number | null;
  /** Competenza: stima sui dovuti dell'anno, non valida ai fini fiscali. */
  previsionale: boolean;
  /** Cassa, ma con versamenti attesi e non ancora confermati come pagati. */
  stimato: boolean;
  versamentiConteggiati: number;
  versamentiPrevisti: number;
  versamentiSenzaData: number;
  avvisi: string[];
}

type StimaConfig = Pick<Config, 'userId' | 'annoApertura' | 'gestionePrevidenziale' | 'codiciAteco' | 'contributiInpsFissi' | 'riduzioneContributiva' | 'cassaOrdinistica' | 'contributiCassePerAnno' | 'inpsAnte1996' | 'gestioneSeparataAltraCopertura'>;
type DeduzioneConfig = StimaConfig & Pick<Config, 'deduzioneInpsModalita' | 'contributiInpsVersatiManuali'>;

const TIPI_INPS: ReadonlySet<Scadenza['tipo']> = new Set(['saldo_inps', 'acconto_inps']);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const isImporto = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const getDeduzioneInpsModalita = (config: Pick<Config, 'deduzioneInpsModalita'>): DeduzioneInpsModalita =>
  config.deduzioneInpsModalita === 'competenza' ? 'competenza' : DEDUZIONE_INPS_DEFAULT;

/** Totale manuale dell'anno: undefined se assente, 0 se zero esplicito. */
export const getContributiInpsManuali = (config: Pick<Config, 'contributiInpsVersatiManuali'>, anno: number): number | undefined => {
  const value = config.contributiInpsVersatiManuali?.[anno];
  return isImporto(value) ? value : undefined;
};

/** Nuova mappa dei totali manuali con l'anno impostato (o tolto con undefined); gli altri anni restano. */
export const setContributiInpsManuali = (
  config: Pick<Config, 'contributiInpsVersatiManuali'>,
  anno: number,
  importo: number | undefined,
): Record<number, number> | undefined => {
  const next: Record<number, number> = { ...config.contributiInpsVersatiManuali };
  if (importo === undefined) delete next[anno];
  else next[anno] = round2(importo);
  return Object.keys(next).length > 0 ? next : undefined;
};

/**
 * Versamenti INPS per cassa nell'anno: capitale (importo, senza interessi) delle
 * scadenze INPS pagate con dataPagamento nell'anno. Le pagate senza una data
 * valida non vengono conteggiate né datate per deduzione: si segnalano.
 */
export function sommaVersamentiInps(scadenze: readonly Scadenza[], anno: number, userId?: string) {
  let totale = 0;
  let conteggiati = 0;
  let senzaData = 0;
  for (const s of scadenze) {
    if (userId && s.userId !== userId) continue;
    if (!TIPI_INPS.has(s.tipo) || !s.pagato) continue;
    if (!isIsoDate(s.dataPagamento)) { senzaData++; continue; }
    if (Number(s.dataPagamento.slice(0, 4)) !== anno) continue;
    if (!isImporto(s.importo)) continue;
    totale += s.importo;
    conteggiati++;
  }
  return { totale: round2(totale), conteggiati, senzaData };
}

/** Scadenze INPS del piano da versare nell'anno e non ancora segnate come pagate. */
export function versamentiInpsPrevisti(scadenze: readonly Scadenza[], anno: number, userId?: string) {
  const previste = scadenze.filter(s => (!userId || s.userId === userId) && TIPI_INPS.has(s.tipo) && !s.pagato && s.annoVersamento === anno && isImporto(s.importo));
  return { totale: round2(previste.reduce((sum, s) => sum + s.importo, 0)), numero: previste.length };
}

// Gestione Separata: i contributi dell'anno di apertura si versano dall'anno dopo.
const primoAnnoGestioneSeparata = (config: Pick<Config, 'gestionePrevidenziale'> & Partial<Pick<Config, 'annoApertura'>>, anno: number): boolean =>
  config.gestionePrevidenziale === 'gestione_separata' && typeof config.annoApertura === 'number' && anno <= config.annoApertura;

/**
 * Deduzione INPS dell'anno. Per cassa, in ordine:
 * 1. totale inserito a mano;
 * 2. scadenze INPS: pagate con data nell'anno più quelle del piano dell'anno non ancora segnate;
 * 3. senza piano, saldo dell'anno prima e acconti dell'anno stimati dalle fatture;
 * 4. zero (nessun dato, o primo anno di Gestione Separata).
 * I casi 2 con scadenze non pagate e 3 sono stime, segnalate come tali.
 */
export function risolviDeduzioneInps(config: DeduzioneConfig, anno: number, scadenze: readonly Scadenza[], fatture: readonly Fattura[] = []): DeduzioneInps {
  const vuota = { previsionale: false, stimato: false, versamentiConteggiati: 0, versamentiPrevisti: 0, versamentiSenzaData: 0 };
  if (config.gestionePrevidenziale === 'cassa_ordinistica') {
    return { ...vuota, modalita: null, fonte: 'cassa_professionale', contributiVersati: undefined, importo: null, avvisi: [] };
  }

  const modalita = getDeduzioneInpsModalita(config);
  if (modalita === 'competenza') {
    return {
      ...vuota, modalita, fonte: 'dovuti_stimati', contributiVersati: 'competenza', importo: null, previsionale: true,
      avvisi: [`Stima previsionale: la deduzione usa i contributi dovuti per il ${anno}, non quelli versati. Ai fini fiscali il forfettario deduce per cassa.`],
    };
  }

  const userId = config.userId || undefined;
  const versati = sommaVersamentiInps(scadenze, anno, userId);
  const previsti = versamentiInpsPrevisti(scadenze, anno, userId);
  const avvisoSenzaData = versati.senzaData > 0
    ? [`${versati.senzaData === 1 ? '1 versamento INPS segnato come pagato non ha' : `${versati.senzaData} versamenti INPS segnati come pagati non hanno`} la data di pagamento: non ${versati.senzaData === 1 ? 'è conteggiato' : 'sono conteggiati'}. Completa la data in Scadenze.`]
    : [];
  const base = { modalita, previsionale: false, versamentiConteggiati: versati.conteggiati, versamentiPrevisti: previsti.numero, versamentiSenzaData: versati.senzaData };

  const manuale = getContributiInpsManuali(config, anno);
  if (manuale !== undefined) {
    return { ...base, fonte: 'manuale', stimato: false, contributiVersati: manuale, importo: manuale, avvisi: [] };
  }

  if (versati.conteggiati > 0 || previsti.numero > 0) {
    const importo = round2(versati.totale + previsti.totale);
    return {
      ...base, fonte: 'scadenze', stimato: previsti.numero > 0, contributiVersati: importo, importo,
      avvisi: [
        ...(previsti.numero > 0 ? [`Comprende ${formatCurrency(previsti.totale)} € di versamenti INPS previsti nel piano ${anno} e non ancora segnati come pagati: segnali in Scadenze quando paghi.`] : []),
        ...avvisoSenzaData,
      ],
    };
  }

  const stima = stimaVersamentiInps(config, anno, fatture);
  if (stima) {
    return {
      ...base, fonte: 'stima', stimato: true, contributiVersati: stima.importo, importo: stima.importo,
      avvisi: [`Stima: ${stima.descrizione}. Per confermarla salva il piano in Scadenze e segna i pagamenti, oppure inserisci il totale versato.`, ...avvisoSenzaData],
    };
  }

  return {
    ...base, fonte: 'nessun_versamento', stimato: false, contributiVersati: 0, importo: 0,
    avvisi: primoAnnoGestioneSeparata(config, anno) ? [
      `Primo anno di attività: nel ${anno} non si versano saldo né acconti INPS della Gestione Separata (si pagano dal ${anno + 1}), quindi non ci sono contributi da dedurre.`,
      ...avvisoSenzaData,
    ] : [
      config.gestionePrevidenziale === 'artigiani' || config.gestionePrevidenziale === 'commercianti'
        ? `Nessun versamento INPS noto nel ${anno}: la deduzione dei contributi è zero. I contributi di Artigiani e Commercianti non sono nel piano Scadenze: inserisci il totale versato nell'anno (fissi e a percentuale, dagli F24).`
        : `Nessun versamento INPS noto nel ${anno}: la deduzione dei contributi è zero. Segna le scadenze pagate o inserisci il totale versato nell'anno.`,
      ...avvisoSenzaData,
    ],
  };
}

export const descriviDeduzioneInps = (deduzione: DeduzioneInps, anno: number): string => {
  switch (deduzione.fonte) {
    case 'manuale': return `Per cassa: totale versato nel ${anno} inserito a mano`;
    case 'scadenze': {
      const pagati = `${deduzione.versamentiConteggiati} ${deduzione.versamentiConteggiati === 1 ? 'versamento INPS pagato' : 'versamenti INPS pagati'}`;
      return deduzione.versamentiPrevisti > 0
        ? `Per cassa: ${pagati} e ${deduzione.versamentiPrevisti} ${deduzione.versamentiPrevisti === 1 ? 'previsto' : 'previsti'} nel ${anno}`
        : `Per cassa: ${pagati} nel ${anno}`;
    }
    case 'stima': return `Per cassa, stimati: saldo ${anno - 1} e acconti ${anno} calcolati dalle fatture`;
    case 'nessun_versamento': return `Per cassa: nessun versamento INPS noto nel ${anno}`;
    case 'dovuti_stimati': return 'Per competenza: contributi dovuti stimati (previsionale)';
    case 'cassa_professionale': return 'Quota deducibile della cassa professionale';
  }
};

/** Controllo dei campi di deduzione INPS in una config letta da file (sync o backup). */
export function validaDeduzioneInpsConfig(record: Record<string, unknown>): string | null {
  const modalita = record.deduzioneInpsModalita;
  if (modalita !== undefined && modalita !== 'cassa' && modalita !== 'competenza') return 'deduzioneInpsModalita non valida';
  const manuali = record.contributiInpsVersatiManuali;
  if (manuali === undefined) return null;
  if (typeof manuali !== 'object' || manuali === null || Array.isArray(manuali)) return 'contributiInpsVersatiManuali non è un oggetto';
  for (const [anno, importo] of Object.entries(manuali)) {
    if (!/^\d{4}$/.test(anno)) return `contributiInpsVersatiManuali: anno ${anno} non valido`;
    if (!isImporto(importo)) return `contributiInpsVersatiManuali: importo del ${anno} non valido`;
  }
  return null;
}

export interface StimaVersamentiInps {
  importo: number;
  descrizione: string;
}

// Stessa regola della Dashboard: incassata se incassato !== false, anno di dataIncasso o data.
const fatturatoIncassato = (fatture: readonly Fattura[], anno: number, userId?: string): { totale: number; numero: number } => {
  const incassate = fatture.filter(f => (!userId || f.userId === userId) && f.incassato !== false && new Date(f.dataIncasso || f.data).getFullYear() === anno);
  return { totale: incassate.reduce((sum, f) => sum + f.importo, 0), numero: incassate.length };
};

/**
 * Contributi INPS da versare nell'anno N stimati dalle fatture, quando manca un
 * piano salvato. Solo Gestione Separata (saldo e acconti col metodo storico):
 * nell'anno N si versano il saldo di N-1 e gli acconti di N (40% + 40% del
 * dovuto di N-1): saldo = dovuto(N-1) - 80% dovuto(N-2), acconti = 80% dovuto(N-1).
 */
export function stimaVersamentiInps(config: StimaConfig, anno: number, fatture: readonly Fattura[]): StimaVersamentiInps | null {
  if (config.gestionePrevidenziale !== 'gestione_separata' || primoAnnoGestioneSeparata(config, anno)) return null;
  const userId = config.userId || undefined;
  const coefficiente = calcolaCoefficienteMedioAteco(config.codiciAteco ?? []);
  const dovuto = (a: number) => {
    const { totale, numero } = fatturatoIncassato(fatture, a, userId);
    return { inps: numero > 0 ? calcolaFiscale(totale, coefficiente, 0, getInpsCalculationInput(config, a)).inps : 0, numero };
  };
  const precedente = dovuto(anno - 1);
  if (precedente.numero === 0 || precedente.inps <= 0) return null;
  // Se N-1 è l'anno di apertura, nel N-1 non si sono versati acconti.
  const apertoNelPrecedente = config.annoApertura === anno - 1;
  const anteprecedente = apertoNelPrecedente ? { inps: 0, numero: 0 } : dovuto(anno - 2);
  const saldo = Math.max(0, precedente.inps - 0.8 * anteprecedente.inps);
  const acconti = 0.8 * precedente.inps;
  return {
    importo: round2(saldo + acconti),
    descrizione: apertoNelPrecedente
      ? `saldo ${anno - 1} e acconti ${anno} calcolati dalle fatture incassate nel ${anno - 1}, primo anno di attività`
      : anteprecedente.numero > 0
      ? `saldo ${anno - 1} e acconti ${anno} calcolati dalle fatture incassate nel ${anno - 2} e nel ${anno - 1}`
      : `saldo ${anno - 1} e acconti ${anno} calcolati dalle fatture incassate nel ${anno - 1}; senza fatture del ${anno - 2} non si considerano acconti già versati`,
  };
}
