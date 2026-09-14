import { z } from 'zod';

import { proposeTool } from './propose';
import { dateSchema } from './shared';

export const proposeScadenzaPagata = proposeTool({
  name: 'propose_scadenza_pagata',
  title: 'Proponi scadenza pagata',
  description: 'Propone di segnare come pagata una scadenza fiscale non ancora pagata, con la data del pagamento.',
  kind: 'scadenzaPagata',
  payload: { scadenzaId: z.string().min(1), dataPagamento: dateSchema },
  summary: (p) => `Proposta: scadenza ${p.scadenzaId} pagata il ${p.dataPagamento}`,
});
