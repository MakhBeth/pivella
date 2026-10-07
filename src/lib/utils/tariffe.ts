import type { BillingUnit, Cliente, TariffaCliente, WorkLog } from '../../types';
import { isIsoDate } from './dateHelpers';
import { getWorkLogQuantita } from './calculations';

// Le tariffe senza decorrenza valgono "dall'inizio" e precedono le altre.
const ordina = (storico: TariffaCliente[]): TariffaCliente[] =>
  [...storico].sort((a, b) => (a.dal ?? '').localeCompare(b.dal ?? ''));

/**
 * Storico tariffe del cliente in ordine di decorrenza. I clienti salvati prima
 * dello storico hanno solo rate e billingUnit: diventano una tariffa unica
 * valida dall'inizio, così i conti restano quelli di prima.
 */
export function getStoricoTariffe(cliente: Pick<Cliente, 'rateHistory' | 'rate' | 'billingUnit'>): TariffaCliente[] {
  if (cliente.rateHistory && cliente.rateHistory.length > 0) return ordina(cliente.rateHistory);
  if (cliente.rate && cliente.rate > 0) return [{ rate: cliente.rate, billingUnit: cliente.billingUnit ?? 'ore' }];
  return [];
}

/** Tariffa in vigore alla data (YYYY-MM-DD): l'ultima con decorrenza non successiva. */
export function tariffaAllaData(cliente: Pick<Cliente, 'rateHistory' | 'rate' | 'billingUnit'>, data: string): TariffaCliente | null {
  let trovata: TariffaCliente | null = null;
  for (const t of getStoricoTariffe(cliente)) {
    if (!t.dal || t.dal <= data) trovata = t;
  }
  return trovata;
}

/** Unità da proporre per un'attività alla data; senza tariffa vale l'unità del cliente. */
export function unitaAllaData(cliente: Pick<Cliente, 'rateHistory' | 'rate' | 'billingUnit'> | undefined, data: string | null | undefined): BillingUnit {
  if (!cliente) return 'ore';
  const t = data ? tariffaAllaData(cliente, data) : null;
  return t?.billingUnit ?? cliente.billingUnit ?? 'ore';
}

/**
 * Salva lo storico sul cliente. rate e billingUnit restano lo specchio
 * dell'ultima tariffa per chi legge ancora quei campi (MCP, versioni vecchie).
 * billingStartDate sparisce: escludeva le attività precedenti dal riepilogo
 * e non c'entra con il cambio tariffa.
 */
export function conStoricoTariffe(cliente: Cliente, storico: TariffaCliente[]): Cliente {
  const ordinato = ordina(storico);
  const ultima = ordinato[ordinato.length - 1];
  const { billingStartDate: _rimosso, ...resto } = cliente;
  return {
    ...resto,
    rateHistory: ordinato,
    rate: ultima?.rate,
    billingUnit: ultima?.billingUnit ?? cliente.billingUnit,
  };
}

/** Errori dello storico, con l'indice della riga nello storico passato e il campo a cui si riferiscono. */
export interface ErroreTariffa {
  index: number;
  field: keyof TariffaCliente;
  reason: string;
}

export function validaStoricoTariffe(storico: TariffaCliente[]): ErroreTariffa[] {
  const errori: ErroreTariffa[] = [];
  const viste = new Map<string, number>();
  storico.forEach((t, index) => {
    if (!Number.isFinite(t.rate) || t.rate <= 0) errori.push({ index, field: 'rate', reason: 'tariffa mancante o non positiva' });
    if (t.billingUnit !== 'ore' && t.billingUnit !== 'giornata') errori.push({ index, field: 'billingUnit', reason: 'unità non valida' });
    if (t.dal !== undefined && !isIsoDate(t.dal)) {
      errori.push({ index, field: 'dal', reason: 'data di decorrenza non valida' });
    }
    const chiave = t.dal ?? '';
    if (viste.has(chiave)) {
      errori.push({ index, field: 'dal', reason: t.dal ? 'due tariffe con la stessa decorrenza' : "solo una tariffa può valere dall'inizio" });
    } else {
      viste.set(chiave, index);
    }
  });
  return errori;
}

export interface RigaRiepilogo {
  cliente: Cliente;
  totalQuantita: number;
  /** Tariffa della riga; null se le attività non hanno una tariffa o se la riga ne somma più d'una. */
  rate: number | null;
  /** Somma delle attività con tariffa; null se nessuna ne ha una. */
  amount: number | null;
  unit: BillingUnit;
}

/**
 * Riepilogo per cliente nel periodo [da, a] (YYYY-MM-DD inclusi). Ogni attività
 * si valorizza con la tariffa in vigore alla sua data, quindi cambiare tariffa
 * non ricalcola i giorni già lavorati. Con perTariffa le righe si separano
 * anche per tariffa, altrimenti solo per unità.
 */
export function riepilogoPerCliente(
  clienti: Cliente[],
  workLogs: WorkLog[],
  da: string,
  a: string,
  { perTariffa }: { perTariffa: boolean },
): RigaRiepilogo[] {
  const perId = new Map(clienti.map((c) => [c.id, c]));
  const righe = new Map<string, RigaRiepilogo & { rates: Set<number> }>();

  for (const log of workLogs) {
    if (log.data < da || log.data > a) continue;
    const cliente = perId.get(log.clienteId);
    if (!cliente) continue;

    const tariffa = tariffaAllaData(cliente, log.data);
    const unit = tariffa?.billingUnit ?? cliente.billingUnit ?? 'ore';
    const key = perTariffa ? `${cliente.id}|${unit}|${tariffa?.rate ?? ''}` : `${cliente.id}|${unit}`;
    let riga = righe.get(key);
    if (!riga) {
      riga = { cliente, totalQuantita: 0, rate: null, amount: null, unit, rates: new Set() };
      righe.set(key, riga);
    }
    const quantita = getWorkLogQuantita(log);
    riga.totalQuantita += quantita;
    if (tariffa) {
      riga.amount = (riga.amount ?? 0) + quantita * tariffa.rate;
      riga.rates.add(tariffa.rate);
    }
  }

  // Ordine stabile: clienti come nell'elenco, poi tariffe in ordine di inserimento.
  const ordine = new Map(clienti.map((c, i) => [c.id, i]));
  return [...righe.values()]
    .sort((x, y) => (ordine.get(x.cliente.id) ?? 0) - (ordine.get(y.cliente.id) ?? 0))
    .map(({ rates, ...riga }) => ({ ...riga, rate: rates.size === 1 ? [...rates][0] : null }));
}
