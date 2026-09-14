import { z } from 'zod';

import { proposeTool } from './propose';
import { dateSchema } from './shared';

export const proposeWorkLog = proposeTool({
  name: 'propose_work_log',
  title: 'Proponi giornata',
  description: 'Propone una registrazione nel calendario: giornata (quantità massimo 1) oppure ore (massimo 24) per un cliente, per Ferie (__vacation__) o Varie (__misc__). La data può essere al massimo 30 giorni nel futuro.',
  kind: 'workLog',
  payload: {
    clienteId: z.string().min(1),
    data: dateSchema,
    tipo: z.enum(['ore', 'giornata']),
    quantita: z.number().positive(),
    note: z.string().optional(),
  },
  summary: (p) => `Proposta: ${p.quantita} ${p.tipo === 'ore' ? 'ore' : 'giornata/e'} per ${p.clienteId} il ${p.data}`,
});
