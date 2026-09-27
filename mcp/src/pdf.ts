/** Fattura di cortesia in PDF dal server MCP: stesso renderer dell'app, font da disco. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';

import GeneratePDF, { registerPdfFont } from '../../src/lib/pdf/renderer';
import type { Invoice, PDFOptions } from '../../src/lib/pdf/types';

const FONT = 'RobotoMono-Regular.ttf';

/** Nel pacchetto: dist/fonts accanto a cli.js. In sviluppo (tsx): public/fonts del repo. */
export function resolveFontPath(): string {
  const candidates = [
    fileURLToPath(new URL(`./fonts/${FONT}`, import.meta.url)),
    fileURLToPath(new URL(`../../public/fonts/${FONT}`, import.meta.url)),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Font ${FONT} non trovato (cercato in ${candidates.join(', ')})`);
  return found;
}

let fontRegistered = false;

export async function renderCourtesyPdf(invoice: Invoice, options: PDFOptions): Promise<Buffer> {
  if (!fontRegistered) {
    registerPdfFont(resolveFontPath());
    fontRegistered = true;
  }
  return renderToBuffer(GeneratePDF(invoice, options) as Parameters<typeof renderToBuffer>[0]);
}
