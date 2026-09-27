/**
 * Righe di una fattura da un XML FatturaPA, solo quando il modello `righe`
 * lo rappresenta senza perdite: forfettario (IVA 0), senza sconti, totali
 * coerenti. Altrimenti `{ ok: false, motivo }` e la fattura si importa senza
 * righe. Usa solo getElementsByTagName: gira nel browser e, nei test, con
 * @xmldom/xmldom.
 */
import type { FatturaRiga } from '../../types';
import { isIsoDate, validateFatturaRighe } from '../sync/validate';

export type RigheFromXml =
  | { ok: true; righe: FatturaRiga[]; valuta: string; importoValuta?: number; tassoCambio?: number; dataCambio?: string }
  | { ok: false; motivo: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const children = (el: Element | Document, tag: string): Element[] => Array.from(el.getElementsByTagName(tag));
const text = (el: Element | Document, tag: string): string | null => children(el, tag)[0]?.textContent?.trim() ?? null;
const num = (el: Element | Document, tag: string): number | null => {
  const t = text(el, tag);
  if (t === null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fail = (motivo: string): RigheFromXml => ({ ok: false, motivo });

/**
 * RiferimentoData in xs:date ammette suffissi di timezone ("Z", "+01:00")
 * che isIsoDate rifiuta: se i primi 10 caratteri sono una data valida la
 * teniamo, altrimenti (data non riconoscibile) la fattura si importa senza
 * dataCambio, mai con un valore che il validatore dello snapshot rifiuta.
 */
function normalizeDataCambio(raw: string | null): string | undefined {
  if (!raw) return undefined;
  if (isIsoDate(raw)) return raw;
  const conSuffisso = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  const dataParte = conSuffisso?.[1];
  return dataParte !== undefined && isIsoDate(dataParte) ? dataParte : undefined;
}

export function righeFromXml(doc: Document): RigheFromXml {
  const linee = children(doc, 'DettaglioLinee');
  if (linee.length === 0) return fail('nessuna riga di dettaglio');

  const valutaPerRiga: Array<{ codice: string; importo: number; data: string | null } | null> = [];
  let sommaTotali = 0;
  const totaliRighe: number[] = [];
  const righeEUR: FatturaRiga[] = [];
  for (const [i, linea] of linee.entries()) {
    const n = i + 1;
    if (children(linea, 'ScontoMaggiorazione').length > 0) return fail(`riga ${n}: sconto o maggiorazione`);
    const aliquota = num(linea, 'AliquotaIVA');
    if (aliquota === null || aliquota !== 0) return fail(`riga ${n}: IVA diversa da zero`);
    const quantita = num(linea, 'Quantita') ?? 1;
    const prezzo = num(linea, 'PrezzoUnitario');
    const totale = num(linea, 'PrezzoTotale');
    if (prezzo === null || totale === null) return fail(`riga ${n}: prezzi mancanti`);
    if (quantita <= 0) return fail(`riga ${n}: quantità non positiva`);
    if (Math.abs(totale - quantita * prezzo) > 0.01 + quantita * 0.005) return fail(`riga ${n}: totale diverso da quantità per prezzo`);
    // Il PrezzoUnitario dell'XML è arrotondato a 2 decimali dal generatore: per un
    // round trip senza perdite ricostruiamo il prezzo dal totale (non arrotondato).
    const prezzoRicostruito = totale / quantita;
    if (Math.abs(round2(quantita * prezzoRicostruito) - totale) > 0.005) return fail(`riga ${n}: prezzo non ricostruibile dal totale`);
    sommaTotali += totale;
    totaliRighe.push(totale);
    righeEUR.push({ descrizione: text(linea, 'Descrizione') ?? '', quantita, prezzoUnitario: prezzoRicostruito });

    const valuta = children(linea, 'AltriDatiGestionali').find((d) => text(d, 'TipoDato') === 'VALUTA');
    if (!valuta) { valutaPerRiga.push(null); continue; }
    const codice = /^([A-Z]{3})/.exec(text(valuta, 'RiferimentoTesto') ?? '')?.[1];
    const importo = num(valuta, 'RiferimentoNumero');
    if (!codice || importo === null) return fail(`riga ${n}: dati valuta incompleti`);
    valutaPerRiga.push({ codice, importo, data: text(valuta, 'RiferimentoData') });
  }

  const imponibile = num(doc, 'ImponibileImporto');
  if (imponibile === null || Math.abs(imponibile - sommaTotali) > 0.01 + linee.length * 0.005) return fail('somma delle righe diversa dall\'imponibile');
  const totaleDocumento = num(doc, 'ImportoTotaleDocumento');
  if (totaleDocumento !== null && Math.abs(totaleDocumento - imponibile) > 0.01) return fail('totale documento diverso dall\'imponibile');

  const conValuta = valutaPerRiga.filter((v) => v !== null);
  if (conValuta.length === 0) {
    // I prezzi ricostruiti (PrezzoTotale / Quantita) possono, sommati, discostarsi
    // dall'imponibile dichiarato (ogni PrezzoTotale è già arrotondato a 2 decimali):
    // se la somma che genererebbe l'XML da queste righe non torna a livello di
    // centesimo, il documento non è rappresentabile senza perdere importi.
    const regenImponibile = round2(righeEUR.reduce((sum, r) => sum + r.quantita * r.prezzoUnitario, 0));
    if (Math.abs(regenImponibile - imponibile) > 0.005) return fail('somma dei prezzi ricostruiti diversa dall\'imponibile');
    const check = validateFatturaRighe(righeEUR);
    return check.ok ? { ok: true, righe: check.righe, valuta: 'EUR' } : fail(check.reason);
  }
  if (conValuta.length !== linee.length) return fail('valuta indicata solo su alcune righe');
  const codice = conValuta[0]!.codice;
  if (conValuta.some((v) => v!.codice !== codice)) return fail('righe in valute diverse');
  const dateRiferimento = new Set(conValuta.map((v) => v!.data).filter((d): d is string => d !== null));
  if (dateRiferimento.size > 1) return fail('data di cambio diversa tra le righe');

  const righe = righeEUR.map((r, i) => ({ ...r, prezzoUnitario: valutaPerRiga[i]!.importo / r.quantita }));
  const check = validateFatturaRighe(righe);
  if (!check.ok) return fail(check.reason);
  const sommaValuta = conValuta.reduce((sum, v) => sum + v!.importo, 0);
  const importoValuta = round2(sommaValuta);
  const causale = children(doc, 'Causale').map((c) => c.textContent ?? '').join(' ');
  const tassoCausale = new RegExp(`1 EUR = ([0-9.]+) ${codice}`).exec(causale)?.[1];
  const tassoCambio = tassoCausale ? Number(tassoCausale) : Math.round((importoValuta / imponibile) * 1e6) / 1e6;
  if (!Number.isFinite(tassoCambio) || tassoCambio <= 0) return fail('cambio non valido');
  // Stesso controllo del ramo EUR, con la stessa aritmetica di generateFatturaXML
  // (somma non arrotondata delle righe, poi conversione e arrotondamento finale):
  // se la somma ricostruita non torna a livello di centesimo il documento non è
  // rappresentabile.
  if (Math.abs(round2(sommaValuta / tassoCambio) - imponibile) > 0.005) return fail('cambio incoerente con gli importi');
  for (const [i, v] of valutaPerRiga.entries()) {
    if (Math.abs(v!.importo / tassoCambio - totaliRighe[i]!) > 0.01) return fail(`riga ${i + 1}: cambio incoerente con la riga`);
  }
  const dataCambio = normalizeDataCambio(conValuta[0]!.data);
  return { ok: true, righe: check.righe, valuta: codice, importoValuta, tassoCambio, ...(dataCambio ? { dataCambio } : {}) };
}
