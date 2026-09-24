import type { Fattura, Cliente, ImportSummary, ValutaConfig } from '../../types';
import type { IndexedDBManager } from '../db/IndexedDBManager';
import { righeFromXml, type RigheFromXml } from '../xml/righeFromXml';

// Generate unique ID for entities
export const generateUniqueId = (index: number): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}-${index}`;
};

// Compute duplicate key: normalize invoice number + date + amount
export const computeDuplicateKey = (numero: string | undefined, data: string, importo: number): string => {
  const normalizedNumero = (numero || '').trim();
  const date = new Date(data);
  // Validate date
  if (isNaN(date.getTime())) {
    throw new Error('Data fattura non valida');
  }
  const normalizedData = date.toISOString().split('T')[0]; // yyyy-mm-dd
  const normalizedImporto = importo.toFixed(2);
  return `${normalizedNumero}|${normalizedData}|${normalizedImporto}`;
};

// Chiave ricalcolata: le chiavi salvate hanno avuto formati diversi (| e -, importo in valuta), non si confrontano
export const getDuplicateKey = (fattura: Fattura): string => computeDuplicateKey(fattura.numero, fattura.data, fattura.importo);

// Types without userId for batch import (userId will be added by hooks)
type NewCliente = Omit<Cliente, 'userId'>;
type NewFattura = Omit<Fattura, 'userId'>;

function righeFields(r: Extract<RigheFromXml, { ok: true }>, valute: ValutaConfig[]): Partial<Fattura> {
  const base: Partial<Fattura> = { righe: r.righe, righeSource: 'xml' };
  if (r.valuta === 'EUR') return base;
  const simbolo = valute.find((v) => v.codice === r.valuta)?.simbolo ?? r.valuta;
  return { ...base, valuta: r.valuta, valutaSimbolo: simbolo, importoValuta: r.importoValuta, tassoCambio: r.tassoCambio, ...(r.dataCambio ? { dataCambio: r.dataCambio } : {}) };
}

/** Arricchisce una fattura senza righe solo se valuta e cambio coincidono: mai una doppia conversione. */
function enrich(f: Fattura, r: RigheFromXml): { fattura: Fattura } | { motivo: string } {
  if (!r.ok) return { motivo: r.motivo };
  const valutaSalvata = f.valuta || 'EUR';
  if (valutaSalvata !== r.valuta) return { motivo: `valuta dell'XML (${r.valuta}) diversa da quella salvata (${valutaSalvata})` };
  if (r.valuta === 'EUR') return { fattura: { ...f, righe: r.righe, righeSource: 'xml' } };
  if (f.tassoCambio !== undefined && r.tassoCambio !== undefined && Math.abs(f.tassoCambio - r.tassoCambio) / f.tassoCambio > 0.001) {
    return { motivo: `cambio dell'XML (${r.tassoCambio}) diverso da quello salvato (${f.tassoCambio})` };
  }
  return {
    fattura: {
      ...f,
      righe: r.righe,
      righeSource: 'xml',
      ...(r.dataCambio ? { dataCambio: r.dataCambio } : {}),
      ...(f.importoValuta === undefined && r.importoValuta !== undefined ? { importoValuta: r.importoValuta } : {}),
      ...(f.tassoCambio === undefined && r.tassoCambio !== undefined ? { tassoCambio: r.tassoCambio } : {}),
    },
  };
}

// Shared function to process batch import
// dbManager is optional - if null, DB save is skipped (caller handles persistence)
export const processBatchXmlFiles = async (
  xmlFiles: Array<{ name: string; content: string }>,
  existingFatture: Fattura[],
  existingClienti: Cliente[],
  parseFatturaXML: (xmlContent: string) => any,
  dbManager?: IndexedDBManager | null,
  parseDocument: (xml: string) => Document = (xml) => new DOMParser().parseFromString(xml, 'text/xml'),
  valute: ValutaConfig[] = [{ codice: 'EUR', simbolo: '€' }],
): Promise<{
  summary: ImportSummary;
  newFatture: NewFattura[];
  newClienti: NewCliente[];
  enrichedFatture: Fattura[];
}> => {
  const summary: ImportSummary = {
    total: xmlFiles.length,
    imported: 0,
    duplicates: 0,
    enriched: 0,
    failed: 0,
    failedFiles: [],
    righeNonImportate: [],
  };

  const newFatture: NewFattura[] = [];
  const newClienti: NewCliente[] = [];
  const enrichedFatture: Fattura[] = [];
  const existingByKey = new Map<string, Fattura>();
  for (const f of existingFatture) {
    try { existingByKey.set(getDuplicateKey(f), f); } catch { /* data non valida: non confrontabile */ }
  }
  const batchKeys = new Set<string>();

  for (let i = 0; i < xmlFiles.length; i++) {
    const { name, content } = xmlFiles[i];
    try {
      // Check if file content is missing (read error)
      if (!content) {
        summary.failed++;
        summary.failedFiles.push({ filename: name, error: 'Impossibile leggere il file' });
        continue;
      }

      const parsed = parseFatturaXML(content);

      if (!parsed) {
        summary.failed++;
        summary.failedFiles.push({ filename: name, error: 'Errore parsing XML' });
        continue;
      }

      // Check for duplicate - catch errors from invalid dates
      let duplicateKey: string;
      try {
        duplicateKey = computeDuplicateKey(parsed.numero, parsed.data, parsed.importo);
      } catch (error: any) {
        summary.failed++;
        summary.failedFiles.push({
          filename: name,
          error: error?.message || String(error) || 'Errore validazione dati'
        });
        continue;
      }

      const righe = righeFromXml(parseDocument(content));
      const esistente = existingByKey.get(duplicateKey);
      if (esistente || batchKeys.has(duplicateKey)) {
        const arricchita = esistente && !esistente.righe?.length ? enrich(esistente, righe) : null;
        if (arricchita && 'fattura' in arricchita) {
          enrichedFatture.push(arricchita.fattura);
          existingByKey.set(duplicateKey, arricchita.fattura);
          summary.enriched++;
        } else {
          if (arricchita && 'motivo' in arricchita) summary.righeNonImportate.push({ filename: name, motivo: arricchita.motivo });
          summary.duplicates++;
        }
        continue;
      }
      batchKeys.add(duplicateKey);

      // Find or create cliente
      let clienteId = existingClienti.find(c => c.piva === parsed.clientePiva)?.id;
      if (!clienteId) {
        clienteId = newClienti.find(c => c.piva === parsed.clientePiva)?.id;
      }

      if (!clienteId && parsed.clienteNome) {
        const nuovoCliente: NewCliente = {
          id: generateUniqueId(i),
          nome: parsed.clienteNome,
          piva: parsed.clientePiva || '',
          email: parsed.clienteEmail || '',
          indirizzo: parsed.clienteIndirizzo || '',
          numeroCivico: parsed.clienteNumeroCivico || '',
          cap: parsed.clienteCap || '',
          comune: parsed.clienteComune || '',
          provincia: parsed.clienteProvincia || '',
          nazione: parsed.clienteNazione || ''
        };
        newClienti.push(nuovoCliente);
        clienteId = nuovoCliente.id;
      }

      const nuovaFattura: NewFattura = {
        id: generateUniqueId(i),
        numero: parsed.numero,
        importo: parsed.importo,
        data: parsed.data,
        dataIncasso: parsed.dataIncasso,
        clienteId: clienteId || '',
        clienteNome: parsed.clienteNome,
        duplicateKey,
        ...(righe.ok ? righeFields(righe, valute) : {}),
      };

      if (!righe.ok) summary.righeNonImportate.push({ filename: name, motivo: righe.motivo });

      newFatture.push(nuovaFattura);
      summary.imported++;
    } catch (error: any) {
      summary.failed++;
      summary.failedFiles.push({
        filename: name,
        error: error?.message || String(error) || 'Errore sconosciuto'
      });
    }
  }

  // Save all new clienti and fatture in parallel for better performance
  // Only if dbManager is provided (otherwise caller handles persistence)
  if (dbManager) {
    await Promise.all([
      ...newClienti.map(cliente => dbManager.put('clienti', cliente)),
      ...newFatture.map(fattura => dbManager.put('fatture', fattura)),
      ...enrichedFatture.map(fattura => dbManager.put('fatture', fattura))
    ]);
  }

  return { summary, newFatture, newClienti, enrichedFatture };
};
