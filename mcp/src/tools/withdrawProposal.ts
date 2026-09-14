import { z } from 'zod';

import { defineTool } from './shared';

export const withdrawProposal = defineTool({
  name: 'withdraw_proposal',
  title: 'Ritira proposta',
  description: 'Ritira una proposta ancora in attesa (pending). Le proposte già applicate, rifiutate, ritirate o scadute non cambiano più.',
  input: { proposalId: z.string().min(1) },
  readOnly: false,
  async handler(ctx, { proposalId }) {
    const proposal = await ctx.ds.withdrawProposal(ctx.principal, proposalId);
    return { structured: { proposal }, text: `Proposta ${proposal.id} ritirata` };
  },
});
