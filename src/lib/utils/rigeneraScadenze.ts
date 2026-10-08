import type { Scadenza } from '../../types';
import { INTERESSE_RATEIZZAZIONE_MENSILE } from '../constants/fiscali';
import { formatCurrency } from './formatting';

type NuovaScadenza = Omit<Scadenza, 'userId'>;

export interface PianoRigenerato {
  /** Id delle scadenze non pagate da eliminare (le pagate non compaiono mai). */
  daEliminare: string[];
  daSalvare: NuovaScadenza[];
  /** Situazioni da segnalare che non perdono importi. */
  avvisi: string[];
  /** Se non è vuoto la rigenerazione non va applicata: lascerebbe importi fuori dal piano. */
  blocchi: string[];
  /**
   * Scadenze pagate da riscrivere solo nei metadati del piano (acconti usati),
   * così riaprendo la pagina si ricalcola con gli acconti nuovi. Importi,
   * interessi, date e dataPagamento restano quelli originali.
   */
  pagateDaAggiornare: Scadenza[];
}

type MetadatiPiano = Pick<Scadenza, 'accontiIrpefUsed' | 'accontiInpsUsed'>;

/** Acconti usati per generare il piano salvato, letti dai metadati delle sue scadenze. */
export function accontiUsatiDalPiano(scadenze: readonly Scadenza[]): { irpef: number; inps: number } | null {
  const conMetadati = scadenze.find(s => s.accontiIrpefUsed !== undefined || s.accontiInpsUsed !== undefined);
  return conMetadati ? { irpef: conMetadati.accontiIrpefUsed ?? 0, inps: conMetadati.accontiInpsUsed ?? 0 } : null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
// "2026-saldo-inps-1" → "2026-saldo-inps", "2026-acconto-irpef-2-0" → "2026-acconto-irpef-2"
const gruppoDi = (visibleId: string): string => visibleId.replace(/-\d+$/, '');
// Le scadenze salvate prima di trancheIndex hanno l'indice solo in coda al visibleId.
const trancheDi = (s: Pick<Scadenza, 'visibleId' | 'trancheIndex'>): number =>
  s.trancheIndex ?? Number(/-(\d+)$/.exec(s.visibleId)?.[1] ?? 0);
const etichettaDi = (label: string): string => label.replace(/\s*\(\d+\/\d+\)$/, '');

function perGruppo<T extends { visibleId: string }>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = gruppoDi(item.visibleId);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

/** Ripartisce in centesimi interi, mai negativi: i centesimi in più vanno alle prime rate. */
function ripartisci(totale: number, parti: number): number[] {
  const centesimi = Math.round(totale * 100);
  const base = Math.floor(centesimi / parti);
  const resto = centesimi - base * parti;
  return Array.from({ length: parti }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

/**
 * Rigenera il piano di un anno senza toccare i versamenti già pagati: le
 * scadenze pagate restano identiche (importo, interessi, date, dataPagamento),
 * anche se cambia il numero di rate. Per ogni voce (saldo, primo e secondo
 * acconto di imposta e INPS) il nuovo dovuto meno il capitale già pagato si
 * ripartisce sulle rate del nuovo piano che non coincidono con una rata pagata.
 * Le scadenze non pagate vengono sostituite. Se un residuo non trova una rata
 * libera il piano è bloccato: chi lo usa non deve scrivere nulla.
 */
export function rigeneraPreservandoPagate(esistenti: readonly Scadenza[], generate: readonly NuovaScadenza[], metadati?: MetadatiPiano): PianoRigenerato {
  const pagatePerGruppo = perGruppo(esistenti.filter(s => s.pagato));
  const generatePerGruppo = perGruppo(generate);
  const daSalvare: NuovaScadenza[] = [];
  const avvisi: string[] = [];
  const blocchi: string[] = [];

  for (const [gruppo, pagate] of pagatePerGruppo) {
    if (generatePerGruppo.has(gruppo)) continue;
    const versato = round2(pagate.reduce((sum, s) => sum + s.importo, 0));
    avvisi.push(`${etichettaDi(pagate[0].label)}: il nuovo piano non la prevede, ma risultano già versati ${formatCurrency(versato)} €. Le rate pagate restano registrate.`);
  }

  for (const [gruppo, nuove] of generatePerGruppo) {
    const pagate = pagatePerGruppo.get(gruppo) ?? [];
    if (pagate.length === 0) { daSalvare.push(...nuove); continue; }

    const etichetta = etichettaDi(nuove[0].label);
    const dovuto = round2(nuove.reduce((sum, s) => sum + s.importo, 0));
    const versato = round2(pagate.reduce((sum, s) => sum + s.importo, 0));
    const residuo = round2(dovuto - versato);
    if (residuo < 0) avvisi.push(`${etichetta}: già versati ${formatCurrency(versato)} €, più del nuovo dovuto di ${formatCurrency(dovuto)} €.`);
    if (residuo <= 0) continue;

    const tranchePagate = new Set(pagate.map(trancheDi));
    const idPagati = new Set(pagate.map(s => s.visibleId));
    const libere = nuove.filter(s => !tranchePagate.has(trancheDi(s)) && !idPagati.has(s.visibleId));
    if (libere.length === 0) {
      blocchi.push(`${etichetta}: restano ${formatCurrency(residuo)} € da versare ma tutte le rate del nuovo piano coincidono con rate già pagate. Scegli più rate.`);
      continue;
    }
    ripartisci(residuo, libere.length).forEach((importo, i) => {
      if (importo <= 0) return;
      const s = libere[i];
      const interessi = round2(importo * trancheDi(s) * INTERESSE_RATEIZZAZIONE_MENSILE);
      daSalvare.push({ ...s, importo, interessi, totale: round2(importo + interessi) });
    });
  }

  const pagateDaAggiornare = metadati
    ? esistenti
      .filter(s => s.pagato && (s.accontiIrpefUsed !== metadati.accontiIrpefUsed || s.accontiInpsUsed !== metadati.accontiInpsUsed))
      .map(s => ({ ...s, accontiIrpefUsed: metadati.accontiIrpefUsed, accontiInpsUsed: metadati.accontiInpsUsed }))
    : [];

  return { daEliminare: esistenti.filter(s => !s.pagato).map(s => s.id), daSalvare, avvisi, blocchi, pagateDaAggiornare };
}
