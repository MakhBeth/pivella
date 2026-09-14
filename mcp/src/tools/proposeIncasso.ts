import { z } from 'zod';

import { proposeTool } from './propose';
import { dateSchema } from './shared';

export const proposeIncasso = proposeTool({
  name: 'propose_incasso',
  title: 'Proponi incasso',
  description: 'Propone di segnare come incassata una fattura ancora da incassare, con la data di incasso (non prima della data della fattura).',
  kind: 'incasso',
  payload: { fatturaId: z.string().min(1), dataIncasso: dateSchema },
  summary: (p) => `Proposta: incasso della fattura ${p.fatturaId} il ${p.dataIncasso}`,
});
