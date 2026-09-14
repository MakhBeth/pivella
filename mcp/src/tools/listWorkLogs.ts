import { z } from 'zod';

import { paginate } from '../datasource';
import { checkRange, clienteNameResolver, dateSchema, defineTool, limitSchema, offsetSchema, quantitaPerCliente, snapshotOf, sortByData, userIdSchema, withClienteNome } from './shared';

export const listWorkLogs = defineTool({
  name: 'list_work_logs',
  title: 'Giornate lavorate',
  description: 'Giornate e ore registrate nel calendario in un periodo (massimo 400 giorni), con totali per cliente in giornate e in ore. Solo quantità: gli importi vengono solo dalle fatture.',
  input: {
    userId: userIdSchema,
    da: dateSchema,
    a: dateSchema,
    clienteId: z.string().optional().describe('Anche __vacation__ (Ferie) o __misc__ (Varie)'),
    limit: limitSchema,
    offset: offsetSchema,
  },
  readOnly: true,
  async handler(ctx, { userId, da, a, clienteId, limit, offset }) {
    checkRange(da, a);
    const snap = await snapshotOf(ctx, userId);
    const resolve = clienteNameResolver(snap.clienti);
    const filtered = sortByData(snap.workLogs).filter((w) => w.data >= da && w.data <= a && (clienteId === undefined || w.clienteId === clienteId));
    const totaliPerCliente = quantitaPerCliente(filtered, resolve).map(({ clienteId: id, clienteNome, giornate, ore }) => ({ clienteId: id, clienteNome, giornate, ore }));
    const { items, total, hasMore } = paginate(withClienteNome(filtered, resolve), limit, offset);
    const riassunto = totaliPerCliente.map((t) => `${t.clienteNome}: ${t.giornate} gg, ${t.ore} h`).join('; ') || 'nessuna';
    return { structured: { workLogs: items, total, hasMore, totaliPerCliente }, text: `${total} registrazioni dal ${da} al ${a}. ${riassunto}` };
  },
});
