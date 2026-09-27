import { z } from 'zod';

import { buildFatturaXMLData } from '../../../src/lib/fatturaDocumento';
import { generateFatturaXML } from '../../../src/lib/xml/generator';
import { safeFileComponent, writeExclusive } from '../documents';
import { defineTool, documentoFattura, userIdSchema } from './shared';

export const generaFatturaXml = defineTool({
  name: 'genera_fattura_xml',
  title: 'Genera XML FatturaPA',
  description: 'Scrive su disco l\'XML FatturaPA di una fattura già salvata (per una proposta: dopo la conferma nell\'app, usa il recordId di get_proposal). Default: cartella documenti/<anno> accanto al file di sync; non sovrascrive mai, aggiunge -2, -3. Restituisce il percorso. Non modifica i dati di Pivella.',
  input: {
    userId: userIdSchema,
    fatturaId: z.string().min(1),
    cartella: z.string().min(1).optional().describe('Cartella di destinazione assoluta; default documenti/<anno> nella cartella di sync'),
  },
  readOnly: false,
  async handler(ctx, { userId, fatturaId, cartella }) {
    const doc = await documentoFattura(ctx, userId, fatturaId, cartella);
    const xml = generateFatturaXML(buildFatturaXMLData(doc.fattura, doc.cliente, doc.config));
    const progressivo = Math.random().toString(36).substring(2, 7).toUpperCase();
    const percorso = await writeExclusive(doc.dir, `IT${safeFileComponent(doc.config.partitaIva!)}_${safeFileComponent(progressivo)}`, 'xml', xml);
    const structured = { percorso, fallbackRighe: doc.fallbackRighe, avvisi: doc.avvisi };
    return { structured, text: [`XML della fattura ${doc.fattura.numero ?? fatturaId} scritto in ${percorso}`, ...doc.avvisi].join('. ') };
  },
});
