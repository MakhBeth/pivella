import { defineTool } from './shared';

export const listUsers = defineTool({
  name: 'list_users',
  title: 'Profili',
  description: 'Elenca i profili (utenti) presenti nel file di sync di Pivella. Ogni altro tool richiede uno di questi id come userId.',
  input: {},
  readOnly: true,
  async handler(ctx) {
    const users = await ctx.ds.listUsers(ctx.principal);
    const out = users.map(({ id, nome, color, createdAt }) => (color === undefined ? { id, nome, createdAt } : { id, nome, color, createdAt }));
    return { structured: { users: out }, text: `${out.length} profili: ${out.map((u) => `${u.nome} (${u.id})`).join(', ') || 'nessuno'}` };
  },
});
