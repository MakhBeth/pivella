import { z } from 'zod';

import { paginate } from '../datasource';
import { defineTool, euro, limitSchema, offsetSchema, round2, snapshotOf, userIdSchema } from './shared';

export const listScadenze = defineTool({
  name: 'list_scadenze',
  title: 'Scadenze fiscali',
  description: 'Scadenze di imposta sostitutiva e INPS (saldi e acconti) generate nell\'app, con totali daPagare e pagato sull\'intero filtro.',
  input: {
    userId: userIdSchema,
    annoVersamento: z.number().int().optional().describe('Anno in cui la scadenza va versata'),
    soloNonPagate: z.boolean().optional(),
    limit: limitSchema,
    offset: offsetSchema,
  },
  readOnly: true,
  async handler(ctx, { userId, annoVersamento, soloNonPagate, limit, offset }) {
    const snap = await snapshotOf(ctx, userId);
    const filtered = [...snap.scadenze]
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
      .filter((s) => (annoVersamento === undefined || s.annoVersamento === annoVersamento) && (!soloNonPagate || !s.pagato));
    const totali = {
      daPagare: round2(filtered.filter((s) => !s.pagato).reduce((sum, s) => sum + s.totale, 0)),
      pagato: round2(filtered.filter((s) => s.pagato).reduce((sum, s) => sum + s.totale, 0)),
    };
    const { items, total, hasMore } = paginate(filtered, limit, offset);
    return { structured: { scadenze: items, total, hasMore, totali }, text: `${total} scadenze: da pagare ${euro(totali.daPagare)}, pagato ${euro(totali.pagato)}` };
  },
});
