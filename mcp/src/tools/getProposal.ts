import { z } from 'zod';

import { DataSourceError } from '../datasource';
import { describe } from './propose';
import { defineTool } from './shared';

export const getProposal = defineTool({
  name: 'get_proposal',
  title: 'Dettaglio proposta',
  description: 'Una proposta con payload, stato, motivazione ed eventuale esito (result quando applicata, rejectReason quando rifiutata).',
  input: { proposalId: z.string().min(1) },
  readOnly: true,
  async handler(ctx, { proposalId }) {
    const proposal = await ctx.ds.getProposal(ctx.principal, proposalId);
    if (!proposal) throw new DataSourceError('NOT_FOUND', `Proposta ${proposalId} inesistente`, { proposalId });
    return { structured: { proposal }, text: describe(proposal) };
  },
});
