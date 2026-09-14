import { z } from 'zod';

import { checkRange, clienteNameResolver, dateSchema, defineTool, quantitaPerCliente, round2, snapshotOf, sortByData, userIdSchema } from './shared';

export const getGiornatePerCliente = defineTool({
  name: 'get_giornate_per_cliente',
  title: 'Giornate per cliente',
  description: 'Somma di giornate e ore lavorate per cliente in un periodo (massimo 400 giorni), con gli id delle registrazioni. Solo quantità: nessun importo, nessuna tariffa, nessun legame con le fatture. Per proporre una fattura scrivi righe esplicite con descrizione, quantità e prezzo che l\'utente confermerà.',
  input: { userId: userIdSchema, da: dateSchema, a: dateSchema, clienteId: z.string().optional() },
  readOnly: true,
  async handler(ctx, { userId, da, a, clienteId }) {
    checkRange(da, a);
    const snap = await snapshotOf(ctx, userId);
    const filtered = sortByData(snap.workLogs).filter((w) => w.data >= da && w.data <= a && (clienteId === undefined || w.clienteId === clienteId));
    const perCliente = quantitaPerCliente(filtered, clienteNameResolver(snap.clienti));
    const totale = {
      giornate: round2(perCliente.reduce((sum, r) => sum + r.giornate, 0)),
      ore: round2(perCliente.reduce((sum, r) => sum + r.ore, 0)),
    };
    const riassunto = perCliente.map((r) => `${r.clienteNome}: ${r.giornate} gg, ${r.ore} h`).join('; ') || 'nessuna registrazione';
    return { structured: { perCliente, periodo: { da, a }, totale }, text: `Dal ${da} al ${a}: ${riassunto}. Totale ${totale.giornate} gg, ${totale.ore} h` };
  },
});
