import { z } from 'zod';

import { proposeTool } from './propose';
import { dateSchema } from './shared';

export const proposeCliente = proposeTool({
  name: 'propose_cliente',
  title: 'Proponi cliente',
  description: 'Propone un nuovo cliente. Il nome non deve coincidere con uno esistente (confronto senza maiuscole e spazi). rate e billingUnit sono la tariffa e l\'unità usate dal calendario.',
  kind: 'cliente',
  payload: {
    nome: z.string().min(1),
    piva: z.string().optional(),
    email: z.string().optional(),
    billingUnit: z.enum(['ore', 'giornata']).optional(),
    rate: z.number().positive().optional(),
    billingStartDate: dateSchema.optional(),
    indirizzo: z.string().optional(),
    numeroCivico: z.string().optional(),
    cap: z.string().optional(),
    comune: z.string().optional(),
    provincia: z.string().optional(),
    nazione: z.string().optional().describe('Default IT'),
  },
  summary: (p) => `Proposta: nuovo cliente ${p.nome}`,
});
