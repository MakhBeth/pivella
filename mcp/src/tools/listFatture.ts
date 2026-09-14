import { z } from 'zod';

import { paginate } from '../datasource';
import { anno, checkRange, clienteNameResolver, dateSchema, decorateFattura, defineTool, euro, isIncassata, limitSchema, offsetSchema, round2, snapshotOf, sortByData, userIdSchema } from './shared';

export const listFatture = defineTool({
  name: 'list_fatture',
  title: 'Fatture emesse',
  description: 'Fatture del profilo per data di emissione, con totali su tutto il filtro: importo (emesso), incassato e daIncassare (la differenza). Ogni fattura porta incassata (boolean) e dataIncassoEffettiva: una fattura senza dataIncasso è incassata alla data di emissione, non "senza incasso". Risponde a "quanto ho emesso e quanto manca all\'appello". Per "quanto ho incassato nell\'anno" usa get_riepilogo_anno, che va per cassa.',
  input: {
    userId: userIdSchema,
    anno: z.number().int().optional().describe('Anno di emissione (campo data)'),
    incassata: z.boolean().optional().describe('true: solo incassate; false: solo da incassare'),
    clienteId: z.string().optional(),
    da: dateSchema.optional().describe('Data di emissione minima, inclusa'),
    a: dateSchema.optional().describe('Data di emissione massima, inclusa'),
    limit: limitSchema,
    offset: offsetSchema,
  },
  readOnly: true,
  async handler(ctx, { userId, anno: year, incassata, clienteId, da, a, limit, offset }) {
    if (da && a) checkRange(da, a);
    const snap = await snapshotOf(ctx, userId);
    const filtered = sortByData(snap.fatture).filter(
      (f) =>
        (year === undefined || anno(f.data) === year) &&
        (incassata === undefined || isIncassata(f) === incassata) &&
        (clienteId === undefined || f.clienteId === clienteId) &&
        (da === undefined || f.data >= da) &&
        (a === undefined || f.data <= a),
    );
    const importo = round2(filtered.reduce((sum, f) => sum + f.importo, 0));
    const incassato = round2(filtered.filter(isIncassata).reduce((sum, f) => sum + f.importo, 0));
    const totali = { importo, incassato, daIncassare: round2(importo - incassato) };
    const resolve = clienteNameResolver(snap.clienti);
    const { items, total, hasMore } = paginate(filtered.map((f) => decorateFattura(f, resolve)), limit, offset);
    return {
      structured: { fatture: items, total, hasMore, totali },
      text: `${total} fatture: emesso ${euro(importo)}, incassato ${euro(incassato)}, da incassare ${euro(totali.daIncassare)}`,
    };
  },
});
