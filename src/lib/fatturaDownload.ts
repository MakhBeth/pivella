/** Download nel browser dei documenti di una fattura salvata. */
import type { Cliente, Config, Fattura } from '../types';
import { buildFatturaXMLData, righeOrFallback } from './fatturaDocumento';
import { downloadXML, generateFatturaXML, generateFileName } from './xml/generator';

export function downloadFatturaXML(f: Fattura, c: Cliente | undefined, config: Config): { fallback: boolean } {
  const xml = generateFatturaXML(buildFatturaXMLData(f, c, config));
  const progressivo = Math.random().toString(36).substring(2, 7).toUpperCase();
  downloadXML(xml, generateFileName(config.partitaIva!, progressivo));
  return { fallback: righeOrFallback(f).fallback };
}
