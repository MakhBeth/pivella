import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

import type { Fattura } from '../../types';
import { generateFatturaXML, type FatturaXMLData } from '../xml/generator';
import { createEmptySnapshot, parseSyncFile } from '../sync/schema';
import { getDuplicateKey, processBatchXmlFiles } from './batchImport';

const parseDocument = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
// Parser minimo al posto di parseFatturaXML (che usa querySelector del browser)
const parseFatturaXML = (xml: string) => {
  const doc = parseDocument(xml);
  const t = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent ?? '';
  return { importo: Number(t('ImportoTotaleDocumento')), data: t('Data'), dataIncasso: t('Data'), numero: t('Numero'), clienteNome: t('Denominazione'), clientePiva: t('IdCodice') };
};
const base: FatturaXMLData = {
  emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
  partitaIva: '01234567890', cliente: { denominazione: 'Acme', partitaIva: '09876543210', nazione: 'IT' }, numero: '07', data: '2026-03-10',
  righe: [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }],
};
const run = (xml: string, existing: Fattura[] = []) =>
  processBatchXmlFiles([{ name: 'a.xml', content: xml }], existing, [{ id: 'c1', userId: 'u1', nome: 'Acme', piva: '09876543210' }], parseFatturaXML, null, parseDocument, [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }]);
const saved = (over: Partial<Fattura>): Fattura => ({ id: 'f1', userId: 'u1', numero: '07', data: '2026-03-10', clienteId: 'c1', clienteNome: 'Acme', importo: 1000, ...over });

test('getDuplicateKey recomputes regardless of the stored format', () => {
  const k = getDuplicateKey(saved({}));
  assert.equal(getDuplicateKey(saved({ duplicateKey: '07-2026-03-10-1000' })), k);
  assert.equal(getDuplicateKey(saved({ duplicateKey: '07|2026-03-10|1000.00' })), k);
});

test('a new invoice is imported with its righe', async () => {
  const { newFatture, summary } = await run(generateFatturaXML(base));
  assert.equal(summary.imported, 1);
  assert.deepEqual(newFatture[0].righe, base.righe);
  assert.equal(newFatture[0].righeSource, 'xml');
});

test('a duplicate without righe is enriched, whatever its stored key format', async () => {
  for (const duplicateKey of ['07-2026-03-10-1000', '07|2026-03-10|1000.00', undefined]) {
    const { newFatture, enrichedFatture, summary } = await run(generateFatturaXML(base), [saved({ duplicateKey })]);
    assert.equal(newFatture.length, 0);
    assert.equal(summary.enriched, 1);
    assert.equal(summary.duplicates, 0);
    assert.deepEqual(enrichedFatture[0].righe, base.righe);
    assert.equal(enrichedFatture[0].id, 'f1');
  }
});

test('a duplicate that already has righe is left alone', async () => {
  const { enrichedFatture, summary } = await run(generateFatturaXML(base), [saved({ righe: [{ descrizione: 'Mia', quantita: 1, prezzoUnitario: 1000 }] })]);
  assert.equal(enrichedFatture.length, 0);
  assert.equal(summary.duplicates, 1);
});

test('a non-representable invoice is imported without righe and reported', async () => {
  const xml = generateFatturaXML({ ...base, righe: [{ descrizione: 'X', quantita: 1, prezzoUnitario: 100 }] }).replace(/<ImportoTotaleDocumento>100\.00</, '<ImportoTotaleDocumento>102.00<');
  const { newFatture, summary } = await run(xml);
  assert.equal(newFatture[0].righe, undefined);
  assert.equal(summary.righeNonImportate.length, 1);
  assert.match(summary.righeNonImportate[0].motivo, /totale documento/);
});

test('a foreign invoice saves currency metadata; enrichment checks currency and rate', async () => {
  const gbp: FatturaXMLData = { ...base, righe: [{ descrizione: 'W', quantita: 1, prezzoUnitario: 1000 }], valuta: 'GBP', tassoCambio: 0.84, dataCambio: '2026-03-09' };
  const xml = generateFatturaXML(gbp);
  const { newFatture } = await run(xml);
  assert.equal(newFatture[0].valuta, 'GBP');
  assert.equal(newFatture[0].valutaSimbolo, '£');
  assert.equal(newFatture[0].importoValuta, 1000);
  assert.equal(newFatture[0].tassoCambio, 0.84);
  assert.equal(newFatture[0].dataCambio, '2026-03-09');
  assert.deepEqual(newFatture[0].righe, gbp.righe);

  const esistente = saved({ importo: 1190.48, valuta: 'GBP', tassoCambio: 0.84 });
  assert.equal((await run(xml, [esistente])).summary.enriched, 1);
  const cambioDiverso = await run(xml, [saved({ importo: 1190.48, valuta: 'GBP', tassoCambio: 0.9 })]);
  assert.equal(cambioDiverso.summary.enriched, 0);
  assert.equal(cambioDiverso.summary.righeNonImportate.length, 1);
  const valutaDiversa = await run(xml, [saved({ importo: 1190.48 })]);
  assert.equal(valutaDiversa.summary.enriched, 0);
});

test('an invalid RiferimentoData is dropped, and the imported fattura still passes the sync validator', async () => {
  const gbp: FatturaXMLData = { ...base, righe: [{ descrizione: 'W', quantita: 1, prezzoUnitario: 1000 }], valuta: 'GBP', tassoCambio: 0.84, dataCambio: '2026-03-09' };
  const xml = generateFatturaXML(gbp).replace('<RiferimentoData>2026-03-09</RiferimentoData>', '<RiferimentoData>non-una-data</RiferimentoData>');
  const { newFatture, summary } = await run(xml);
  assert.equal(summary.imported, 1);
  assert.equal(newFatture[0].dataCambio, undefined);

  const stamp = { now: '2026-01-01T00:00:00.000Z', writer: { id: 'app-1', kind: 'app' as const } };
  const snapshot = createEmptySnapshot(stamp);
  snapshot.fatture.push({ ...newFatture[0], userId: 'u1' } as Fattura);
  const { snapshot: parsed } = parseSyncFile(JSON.stringify(snapshot), stamp);
  assert.equal(parsed.fatture[0].dataCambio, undefined);
});
