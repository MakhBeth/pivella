import { z } from 'zod';

import { DataSourceError } from '../datasource';
import { clienteNameResolver, decorateFattura, defineTool, euro, snapshotOf, userIdSchema } from './shared';

export const getFattura = defineTool({
  name: 'get_fattura',
  title: 'Dettaglio fattura',
  description: 'Una fattura del profilo, con il nome del cliente risolto, incassata (boolean) e dataIncassoEffettiva: senza dataIncasso una fattura incassata vale incassata alla data di emissione.',
  input: { userId: userIdSchema, fatturaId: z.string().min(1) },
  readOnly: true,
  async handler(ctx, { userId, fatturaId }) {
    const snap = await snapshotOf(ctx, userId);
    const found = snap.fatture.find((f) => f.id === fatturaId);
    if (!found) throw new DataSourceError('NOT_FOUND', `Fattura ${fatturaId} inesistente per il profilo ${userId}`, { fatturaId });
    const fattura = decorateFattura(found, clienteNameResolver(snap.clienti));
    const stato = fattura.incassata ? `incassata il ${fattura.dataIncassoEffettiva}` : 'da incassare';
    return { structured: { fattura }, text: `Fattura ${fattura.numero ?? 'senza numero'} del ${fattura.data} a ${fattura.clienteNome}: ${euro(fattura.importo)}, ${stato}` };
  },
});
