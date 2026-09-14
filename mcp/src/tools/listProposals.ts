import { z } from 'zod';

import { paginate } from '../datasource';
import type { ProposalStatus } from '../../../src/lib/sync/schema';
import { defineTool, limitSchema, offsetSchema, userIdSchema } from './shared';

const proposalStatusSchema = z.enum(['pending', 'applied', 'rejected', 'withdrawn', 'expired'] satisfies ProposalStatus[]);

export const listProposals = defineTool({
  name: 'list_proposals',
  title: 'Proposte',
  description: 'Proposte di modifica create dagli assistenti per questo profilo, con stato pending, applied, rejected, withdrawn o expired. Le proposte scadono dopo 14 giorni.',
  input: { userId: userIdSchema, status: proposalStatusSchema.optional(), limit: limitSchema, offset: offsetSchema },
  readOnly: true,
  async handler(ctx, { userId, status, limit, offset }) {
    const { items: all, total } = await ctx.ds.listProposals(ctx.principal, { userId, status });
    const { items, hasMore } = paginate(all, limit, offset);
    const perStato = Object.entries(all.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {}))
      .map(([s, n]) => `${n} ${s}`)
      .join(', ');
    return { structured: { proposals: items, total, hasMore }, text: `${total} proposte${perStato ? ` (${perStato})` : ''}` };
  },
});
