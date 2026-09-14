/**
 * Server MCP locale (13.1, 13.4): registra i 17 tool sopra un `DataSource`
 * e li espone sul trasporto scelto dal chiamante (stdio in `cli.ts`, in
 * memoria nei test). Usa il `Server` di basso livello dell'SDK così la
 * validazione dei parametri resta nostra e ogni errore torna al client come
 * risultato con `isError: true` e il corpo `{ code, message, details }`,
 * mai come errore di protocollo.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { DataSource, Principal } from './datasource';
import { runTool, TOOLS, type ToolContext, type ToolDef } from './tools/index';

export const SERVER_NAME = 'pivella-mcp';

export interface ServerOptions {
  writerId: string;
  version: string;
  now?: () => Date;
}

export function toolDescriptor(def: ToolDef): Tool {
  const schema = z.toJSONSchema(z.strictObject(def.input), { target: 'draft-7', io: 'input' }) as Tool['inputSchema'] & { $schema?: string };
  const { $schema: _ignored, ...inputSchema } = schema;
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: { ...inputSchema, type: 'object' },
    annotations: { title: def.title, readOnlyHint: def.readOnly, destructiveHint: false, idempotentHint: def.readOnly, openWorldHint: false },
  };
}

export function createServer(ds: DataSource, options: ServerOptions): Server {
  const server = new Server({ name: SERVER_NAME, version: options.version }, { capabilities: { tools: {} } });
  const principal: Principal = { kind: 'local', writerId: options.writerId };
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  const descriptors = TOOLS.map(toolDescriptor);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: descriptors }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const def = byName.get(request.params.name);
    if (!def) {
      return errorResult({ code: 'NOT_FOUND', message: `Tool ${request.params.name} inesistente` });
    }
    const ctx: ToolContext = { ds, principal, now: options.now ?? (() => new Date()), client: server.getClientVersion()?.name };
    const outcome = await runTool(def, ctx, request.params.arguments ?? {});
    if (outcome.isError) return errorResult(outcome.error!);
    return { content: [{ type: 'text', text: outcome.text }], structuredContent: outcome.structured };
  });

  return server;
}

function errorResult(error: { code: string; message: string; details?: Record<string, unknown> }): CallToolResult {
  const body = error.details === undefined ? { code: error.code, message: error.message } : error;
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
}
