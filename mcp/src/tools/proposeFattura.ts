import { z } from 'zod';

import { fatturaPreview, type FatturaPayload } from '../../../src/lib/sync/validate';
import { proposeTool } from './propose';
import { dateSchema } from './shared';

const rigaSchema = z.object({
  descrizione: z.string().min(1),
  quantita: z.number().positive(),
  prezzoUnitario: z.number().positive(),
});

const nuovoClienteSchema = z.object({
  denominazione: z.string().min(1),
  partitaIva: z.string().optional(),
  nazione: z.string().optional(),
  indirizzo: z.string().optional(),
  numeroCivico: z.string().optional(),
  cap: z.string().optional(),
  comune: z.string().optional(),
  provincia: z.string().optional(),
});

export const proposeFattura = proposeTool({
  name: 'propose_fattura',
  title: 'Proponi fattura',
  description: 'Propone una fattura con righe esplicite (descrizione, quantità, prezzo unitario) per un cliente esistente oppure per un nuovo cliente. Il numero non è un parametro: lo assegna l\'app alla conferma, progressivo per anno della fattura. Richiede i dati emittente configurati. Per una valuta diversa da EUR serve tassoCambio (1 EUR = X valuta). La risposta include un\'anteprima dei totali da mostrare all\'utente.',
  kind: 'fattura',
  payload: {
    clienteId: z.string().optional().describe('Cliente esistente; alternativo a nuovoCliente'),
    nuovoCliente: nuovoClienteSchema.optional().describe('Nuovo cliente da creare alla conferma; alternativo a clienteId'),
    data: dateSchema,
    righe: z.array(rigaSchema).min(1),
    valuta: z.string().optional().describe('Codice valuta tra quelle configurate, default EUR'),
    tassoCambio: z.number().positive().optional().describe('Cambio BCE: 1 EUR = X valuta; obbligatorio se la valuta non è EUR'),
    dataCambio: dateSchema.optional(),
    dataIncasso: dateSchema.optional().describe('Se già incassata; non prima della data della fattura'),
  },
  extra: (p: FatturaPayload) => ({ anteprima: fatturaPreview(p) }),
  summary: (p) => {
    const preview = fatturaPreview(p);
    const chi = p.clienteId ?? p.nuovoCliente?.denominazione ?? '?';
    return `Proposta: fattura del ${p.data} a ${chi}, ${p.righe.length} righe, totale ${preview.totaleImponibile} ${p.valuta}${p.valuta !== 'EUR' ? ` (${preview.totaleEUR} EUR)` : ''}`;
  },
});
