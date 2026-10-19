import { z } from 'zod';
import { listUsers } from '../../../mcp/src/tools/listUsers';
import { listClienti } from '../../../mcp/src/tools/listClienti';
import { listFatture } from '../../../mcp/src/tools/listFatture';
import { getRiepilogoAnno } from '../../../mcp/src/tools/getRiepilogoAnno';
import { listProposals } from '../../../mcp/src/tools/listProposals';
import { getProposal } from '../../../mcp/src/tools/getProposal';
import { proposeFattura } from '../../../mcp/src/tools/proposeFattura';
import { runTool, type ToolContext, type ToolDef } from '../../../mcp/src/tools/shared';

export interface BrowserTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown, options?: { signal: AbortSignal }) => Promise<unknown>;
}

/** Draft corrente: Document + AbortSignal; fallback alla prima API Chromium. */
export interface ModelContext {
  registerTool: (tool: BrowserTool, options?: { signal: AbortSignal }) => Promise<void> | void;
  unregisterTool?: (name: string) => void;
}

export function getModelContext(): ModelContext | undefined {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext
    ?? (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  return typeof context?.registerTool === 'function' ? context : undefined;
}

const tools: ToolDef[] = [listUsers, listClienti, listFatture, getRiepilogoAnno, listProposals, getProposal, proposeFattura] as ToolDef[];

export function registerBrowserTools(model: ModelContext, ctx: ToolContext, onProposal: () => Promise<void>) {
  const controller = new AbortController();
  const registered: string[] = [];
  const legacy = typeof model.unregisterTool === 'function';
  const cleanup = () => {
    controller.abort();
    if (legacy) for (const name of registered.splice(0)) model.unregisterTool!(name);
  };
  const ready = (async () => {
    try {
      for (const def of tools) {
        if (controller.signal.aborted) return;
        const { $schema: _schema, ...inputSchema } = z.toJSONSchema(z.strictObject(def.input), { target: 'draft-7', io: 'input' });
        const description = def.name === 'list_users'
          ? 'Restituisce il solo profilo attualmente selezionato in Pivella. Per cambiare profilo usa l’interfaccia dell’app.'
          : def.name === 'propose_fattura'
            ? 'Prepara una proposta di fattura con righe esplicite per il profilo attivo. Il numero è assegnato solo dopo la conferma dell’utente in Impostazioni > Proposte dell’assistente. Alla conferma l’app scarica l’XML. Non crea subito una fattura. Usa get_proposal per controllare l’esito.'
            : `${def.description} Opera solo sul profilo attualmente selezionato in Pivella. Le proposte WebMCP restano in questo browser.`;
        const tool: BrowserTool = {
          name: def.name, title: def.title, description, inputSchema,
          annotations: { readOnlyHint: def.readOnly, untrustedContentHint: true },
          execute: async (input, options) => {
            if (controller.signal.aborted || options?.signal.aborted) throw new DOMException('Richiesta annullata', 'AbortError');
            const result = await runTool(def, ctx, input);
            if (!def.readOnly && !result.isError) await onProposal();
            if (controller.signal.aborted) throw new DOMException('Contesto cambiato: ripeti la richiesta.', 'AbortError');
            return { ...result.structured, isError: result.isError, ...(result.error ? { error: result.error } : {}), messaggio: result.text };
          },
        };
        const pending = legacy ? model.registerTool(tool) : model.registerTool(tool, { signal: controller.signal });
        if (pending) await pending;
        if (controller.signal.aborted) {
          if (legacy) model.unregisterTool!(def.name);
          return;
        }
        registered.push(def.name);
      }
    } catch (error) {
      cleanup();
      throw error;
    }
  })();
  return { ready, cleanup };
}
