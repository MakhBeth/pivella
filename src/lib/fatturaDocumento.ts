/**
 * Da una fattura salvata ai suoi documenti: input dell'XML FatturaPA e
 * fattura di cortesia per il renderer PDF. Modulo puro, senza DOM né Node:
 * lo usano l'app (modale, conferma delle proposte, lista, pagina Cortesia)
 * e il server MCP, così i documenti escono uguali da entrambe le parti.
 */
import type { Cliente, Config, Fattura, FatturaRiga } from '../types';
import type { FatturaXMLData } from './xml/generator';
import type { Invoice, PDFOptions } from './pdf/types';

export const FALLBACK_DESCRIZIONE = 'Prestazione professionale';
export const FORFETTARIO_LEGAL_REF = "Operazione in franchigia da IVA ai sensi dell'art. 1, commi 54-89, L. 190/2014";
const BOLLO_SOGLIA_EUR = 77.47;
const BOLLO_IMPORTO = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;
const isForeign = (f: Fattura) => Boolean(f.valuta && f.valuta !== 'EUR' && f.tassoCambio);

/** Righe salvate, oppure una riga unica con il totale nella valuta originale. */
export function righeOrFallback(f: Fattura): { righe: FatturaRiga[]; fallback: boolean } {
  if (f.righe && f.righe.length > 0) return { righe: f.righe, fallback: false };
  const totale = f.importoValuta ?? f.importo;
  return { righe: [{ descrizione: FALLBACK_DESCRIZIONE, quantita: 1, prezzoUnitario: totale }], fallback: true };
}

/** Blocco cliente dell'XML dall'anagrafica, come in NuovaFatturaModal. */
export function clienteXMLData(c: Cliente | undefined, clienteNome: string): FatturaXMLData['cliente'] {
  if (!c) return { denominazione: clienteNome, nazione: 'IT' };
  const out: FatturaXMLData['cliente'] = { denominazione: c.nome, nazione: c.nazione || 'IT' };
  if (c.piva) out.partitaIva = c.piva;
  if (c.indirizzo) out.indirizzo = c.indirizzo;
  if (c.numeroCivico) out.numeroCivico = c.numeroCivico;
  if (c.cap) out.cap = c.cap;
  if (c.comune) out.comune = c.comune;
  if (c.provincia) out.provincia = c.provincia;
  return out;
}

export class DatiEmittenteMancantiError extends Error {
  campi: string[];
  constructor(campi: string[]) {
    super(`Dati emittente mancanti: ${campi.join(', ')}. Completali nelle Impostazioni.`);
    this.name = 'DatiEmittenteMancantiError';
    this.campi = campi;
  }
}

const EMITTENTE_OBBLIGATORI = ['codiceFiscale', 'nome', 'cognome', 'indirizzo', 'cap', 'comune'] as const;

/** Campi obbligatori per un XML valido che mancano nella configurazione. */
export function emittenteMancante(config: Config | null): string[] {
  const campi: string[] = [];
  if (!config?.partitaIva) campi.push('partitaIva');
  for (const k of EMITTENTE_OBBLIGATORI) if (!config?.emittente?.[k]) campi.push(`emittente.${k}`);
  return campi;
}

export function buildFatturaXMLData(f: Fattura, c: Cliente | undefined, config: Config): FatturaXMLData {
  const mancanti = emittenteMancante(config);
  if (mancanti.length > 0) throw new DatiEmittenteMancantiError(mancanti);
  const emittente = config.emittente!;
  const foreign = isForeign(f);
  return {
    emittente,
    partitaIva: config.partitaIva!,
    cliente: clienteXMLData(c, f.clienteNome),
    numero: f.numero ?? '',
    data: f.data,
    righe: righeOrFallback(f).righe,
    iban: config.iban,
    beneficiario: `${emittente.nome} ${emittente.cognome}`,
    valuta: foreign ? f.valuta : undefined,
    tassoCambio: foreign ? f.tassoCambio : undefined,
    dataCambio: foreign ? f.dataCambio || f.data : undefined,
  };
}

export function buildCourtesyInvoice(f: Fattura, c: Cliente | undefined, config: Config): Invoice {
  const { righe } = righeOrFallback(f);
  // Come fatturaPreview e generateFatturaXML: il totale è l'arrotondamento della
  // somma non arrotondata delle righe, non la somma degli importi già arrotondati.
  const lines = righe.map((r, i) => ({ number: i + 1, description: r.descrizione, quantity: r.quantita, singlePrice: r.prezzoUnitario, amount: round2(r.quantita * r.prezzoUnitario), tax: 0 }));
  const totale = round2(righe.reduce((sum, r) => sum + r.quantita * r.prezzoUnitario, 0));
  const totaleEUR = isForeign(f) ? round2(totale / f.tassoCambio!) : totale;
  const emittente = config.emittente;
  const ci = config.courtesyInvoice;
  const nomeEmittente = emittente ? `${emittente.nome} ${emittente.cognome}`.trim() : '';
  return {
    invoicer: {
      name: nomeEmittente || ci?.companyName || config.nomeAttivita,
      vat: config.partitaIva ?? ci?.vatNumber ?? '',
      contacts: { tel: ci?.phone, email: ci?.email },
      office: emittente ? { address: emittente.indirizzo, number: emittente.numeroCivico, cap: emittente.cap, city: emittente.comune, district: emittente.provincia, country: emittente.nazione || 'IT' } : undefined,
    },
    invoicee: {
      name: c?.nome ?? f.clienteNome,
      vat: c?.piva ?? '',
      contacts: c?.email ? { email: c.email } : undefined,
      office: c ? { address: c.indirizzo, number: c.numeroCivico, cap: c.cap, city: c.comune, district: c.provincia, country: c.nazione || 'IT' } : undefined,
    },
    installments: [{
      number: f.numero ?? '',
      currency: f.valuta || 'EUR',
      totalAmount: totale,
      issueDate: new Date(`${f.data}T00:00:00`),
      lines,
      payment: config.iban || ci?.iban ? { amount: totale, iban: config.iban || ci?.iban, method: 'MP05', bank: ci?.bankName } : undefined,
      taxSummary: { taxPercentage: 0, taxAmount: 0, paymentAmount: totale, legalRef: FORFETTARIO_LEGAL_REF },
      stampDuty: totaleEUR > BOLLO_SOGLIA_EUR ? BOLLO_IMPORTO : undefined,
    }],
  };
}

export function buildPdfOptions(config: Config, overrides: { locale?: string } = {}): PDFOptions {
  const ci = config.courtesyInvoice;
  const valute = config.valute?.length ? config.valute : [{ codice: 'EUR', simbolo: '€' }];
  return {
    colors: { primary: ci?.primaryColor || '#6699cc', text: ci?.textColor || '#033243' },
    footer: ci?.includeFooter !== false,
    footerText: ci?.footerText || undefined,
    footerLink: ci?.footerLink || undefined,
    locale: overrides.locale ?? ci?.locale ?? 'it',
    logoSrc: ci?.logoBase64,
    currencyMap: Object.fromEntries(valute.map((v) => [v.codice, v.simbolo])),
  };
}
