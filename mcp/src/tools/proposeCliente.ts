import { z } from 'zod';

import { proposeTool } from './propose';
import { dateSchema } from './shared';

export const proposeCliente = proposeTool({
  name: 'propose_cliente',
  title: 'Proponi cliente',
  description: 'Propone un nuovo cliente. Il nome non deve coincidere con uno esistente (confronto senza maiuscole e spazi). La tariffa si passa in uno di due modi, non entrambi: rateHistory, elenco di tariffe con decorrenza (ogni attività del calendario usa la tariffa in vigore alla sua data), oppure rate e billingUnit, una tariffa unica valida da sempre. Senza tariffa, billingUnit da solo indica l\'unità con cui registrare le attività.',
  kind: 'cliente',
  payload: {
    nome: z.string().min(1),
    piva: z.string().optional(),
    email: z.string().optional(),
    billingUnit: z.enum(['ore', 'giornata']).optional().describe('Unità della tariffa unica, o unità di registrazione se il cliente non ha tariffa. Non insieme a rateHistory'),
    rate: z.number().positive().optional().describe('Tariffa unica valida da sempre. Non insieme a rateHistory'),
    rateHistory: z.array(z.strictObject({
      dal: dateSchema.optional().describe('Decorrenza YYYY-MM-DD; omessa vale dall\'inizio (al massimo una tariffa senza data)'),
      rate: z.number().positive(),
      billingUnit: z.enum(['ore', 'giornata']),
    })).min(1).optional().describe('Storico tariffe con decorrenza, al massimo una per data'),
    billingStartDate: dateSchema.optional().describe('Deprecato e ignorato: per un cambio di tariffa usa rateHistory con la decorrenza'),
    indirizzo: z.string().optional(),
    numeroCivico: z.string().optional(),
    cap: z.string().optional(),
    comune: z.string().optional(),
    provincia: z.string().optional(),
    nazione: z.string().optional().describe('Default IT'),
    codiceDestinatario: z.string().regex(/^[A-Za-z0-9]{7}$/).optional().describe('Codice destinatario SDI a 7 caratteri; senza, la fattura XML usa 0000000'),
  },
  summary: (p) => `Proposta: nuovo cliente ${p.nome}`,
});
