import { z } from 'zod';

import { buildCourtesyInvoice, buildPdfOptions } from '../../../src/lib/fatturaDocumento';
import { safeFileComponent, writeExclusive } from '../documents';
import { renderCourtesyPdf } from '../pdf';
import { anno, defineTool, documentoFattura, userIdSchema } from './shared';

export const generaFatturaCortesia = defineTool({
  name: 'genera_fattura_cortesia',
  title: 'Genera fattura di cortesia',
  description: 'Scrive su disco il PDF di cortesia di una fattura già salvata, con logo, colori e lingua delle impostazioni di Pivella. Default: cartella documenti/<anno> accanto al file di sync; non sovrascrive mai, aggiunge -2, -3. Restituisce il percorso, da allegare a una mail. Non modifica i dati di Pivella.',
  input: {
    userId: userIdSchema,
    fatturaId: z.string().min(1),
    cartella: z.string().min(1).optional().describe('Cartella di destinazione assoluta; default documenti/<anno> nella cartella di sync'),
    lingua: z.enum(['it', 'en', 'de']).optional().describe('Lingua del PDF; default quella delle impostazioni'),
  },
  readOnly: false,
  async handler(ctx, { userId, fatturaId, cartella, lingua }) {
    const doc = await documentoFattura(ctx, userId, fatturaId, cartella);
    const pdf = await renderCourtesyPdf(buildCourtesyInvoice(doc.fattura, doc.cliente, doc.config), buildPdfOptions(doc.config, { locale: lingua }));
    const nome = `fattura-cortesia-${safeFileComponent(doc.fattura.numero || doc.fattura.id)}-${anno(doc.fattura.data)}`;
    const percorso = await writeExclusive(doc.dir, nome, 'pdf', pdf);
    const structured = { percorso, fallbackRighe: doc.fallbackRighe, avvisi: doc.avvisi };
    return { structured, text: [`Fattura di cortesia ${doc.fattura.numero ?? fatturaId} scritta in ${percorso}`, ...doc.avvisi].join('. ') };
  },
});
