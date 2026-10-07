import { z } from 'zod';

import { paginate } from '../datasource';
import { defineTool, limitSchema, offsetSchema, snapshotOf, SPECIAL_CLIENTS, userIdSchema } from './shared';

export const listClienti = defineTool({
  name: 'list_clienti',
  title: 'Clienti',
  description: 'Clienti del profilo. rateHistory, quando presente, è lo storico tariffe con decorrenza (dal) e unità: ogni attività usa la tariffa in vigore alla sua data, e rate e billingUnit sono la più recente. I clienti senza rateHistory hanno al più una tariffa unica (rate, billingUnit) valida da sempre. billingStartDate, se c\'è, è un campo vecchio che l\'app ignora. Con includeSpeciali entrano anche Ferie e Varie, che non si fatturano.',
  input: {
    userId: userIdSchema,
    includeSpeciali: z.boolean().optional().describe('Includi i clienti speciali Ferie e Varie (default false)'),
    limit: limitSchema,
    offset: offsetSchema,
  },
  readOnly: true,
  async handler(ctx, { userId, includeSpeciali, limit, offset }) {
    const snap = await snapshotOf(ctx, userId);
    const all = includeSpeciali ? [...snap.clienti, ...SPECIAL_CLIENTS.map((s) => ({ id: s.id, userId, nome: s.nome, speciale: true as const }))] : snap.clienti;
    const { items, total, hasMore } = paginate(all, limit, offset);
    return { structured: { clienti: items, total, hasMore }, text: `${total} clienti${hasMore ? ' (pagina parziale)' : ''}: ${items.map((c) => c.nome).join(', ') || 'nessuno'}` };
  },
});
