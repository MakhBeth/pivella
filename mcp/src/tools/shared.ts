/**
 * Base comune dei tool (13.1): definizione, esecuzione, mappatura errori,
 * schemi ricorrenti e risoluzione dei nomi cliente. I tool vedono solo
 * `DataSource`; nulla qui conosce file o trasporto.
 */
import { z } from 'zod';

import { MISC_CLIENT_ID, VACATION_CLIENT_ID, type Cliente, type Fattura, type WorkLog } from '../../../src/types';
import { getWorkLogQuantita } from '../../../src/lib/utils/calculations';
import { ProposalNotPendingError } from '../../../src/lib/sync/proposals';
import { isIsoDate, MOTIVAZIONE_MAX_LENGTH, ProposalValidationError } from '../../../src/lib/sync/validate';
import { DataSourceError, LIST_MAX_LIMIT, type DataSource, type ErrorCode, type Principal, type UserSnapshot } from '../datasource';

export interface ToolContext {
  ds: DataSource;
  principal: Principal;
  now: () => Date;
  /** `clientInfo.name` dell'handshake MCP, se noto. */
  client?: string;
}

export interface ToolResult<Out extends Record<string, unknown>> {
  structured: Out;
  text: string;
}

export interface ToolError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ToolOutcome {
  isError: boolean;
  structured?: Record<string, unknown>;
  text: string;
  error?: ToolError;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyShape = Record<string, z.ZodType<any>>;

export interface ToolDef<Shape extends AnyShape = AnyShape, Out extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  title: string;
  description: string;
  input: Shape;
  readOnly: boolean;
  handler: (ctx: ToolContext, args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult<Out>>;
}

export function defineTool<Shape extends AnyShape, Out extends Record<string, unknown>>(def: ToolDef<Shape, Out>): ToolDef<Shape, Out> {
  return def;
}

/** Esegue un tool: parsing stretto degli argomenti, handler, errori mappati sul contratto. */
export async function runTool(def: ToolDef, ctx: ToolContext, rawArgs: unknown): Promise<ToolOutcome> {
  const parsed = z.strictObject(def.input).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => ({ field: issue.path.map(String).join('.') || 'argomenti', reason: issue.message }));
    return failure({ code: 'VALIDATION', message: `Parametri non validi: ${fields.map((f) => `${f.field} (${f.reason})`).join(', ')}`, details: { fields } });
  }
  try {
    const { structured, text } = await def.handler(ctx, parsed.data);
    return { isError: false, structured, text };
  } catch (err) {
    return failure(toToolError(err));
  }
}

function failure(error: ToolError): ToolOutcome {
  return { isError: true, text: `${error.code}: ${error.message}`, error };
}

export function toToolError(err: unknown): ToolError {
  if (err instanceof DataSourceError) return { code: err.code, message: err.message, details: err.details };
  if (err instanceof ProposalValidationError) return { code: err.code, message: err.message, details: err.details };
  if (err instanceof ProposalNotPendingError) return { code: err.code, message: err.message, details: err.details };
  const ref = globalThis.crypto.randomUUID().slice(0, 8);
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[pivella-mcp] errore interno ${ref}:`, err);
  return { code: 'INTERNAL', message: `Errore interno (ref ${ref}): ${message}`, details: { ref } };
}

// Schemi ricorrenti

export const userIdSchema = z.string().min(1).describe('Id del profilo, da list_users');
export const dateSchema = z.string().refine(isIsoDate, 'data non valida, formato YYYY-MM-DD').describe('Data YYYY-MM-DD');
export const limitSchema = z.number().int().min(1).max(LIST_MAX_LIMIT).optional().describe('Massimo elementi per pagina, default 500, massimo 2000');
export const offsetSchema = z.number().int().min(0).optional().describe('Elementi da saltare, default 0');
export const motivazioneSchema = z.string().max(MOTIVAZIONE_MAX_LENGTH).optional().describe('Perché proponi questa modifica; mostrata all\'utente nel modale di conferma (massimo 500 caratteri)');

export const PROPOSAL_MESSAGE = "In attesa di conferma nell'app Pivella.";
export const MAX_RANGE_DAYS = 400;

export function validationError(field: string, reason: string): ProposalValidationError {
  return new ProposalValidationError('VALIDATION', [{ field, reason }]);
}

/** `a >= da` e intervallo entro 400 giorni (13.1, tool 6 e 9). */
export function checkRange(da: string, a: string): void {
  if (a < da) throw validationError('a', 'deve essere maggiore o uguale a da');
  const days = (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw validationError('a', `intervallo massimo ${MAX_RANGE_DAYS} giorni`);
}

export const SPECIAL_CLIENTS: ReadonlyArray<{ id: string; nome: string }> = [
  { id: VACATION_CLIENT_ID, nome: 'Ferie' },
  { id: MISC_CLIENT_ID, nome: 'Varie' },
];

export function specialClientName(clienteId: string): string | null {
  return SPECIAL_CLIENTS.find((s) => s.id === clienteId)?.nome ?? null;
}

export function clienteNameResolver(clienti: Cliente[]): (clienteId: string) => string {
  const byId = new Map(clienti.map((c) => [c.id, c.nome]));
  return (clienteId) => byId.get(clienteId) ?? specialClientName(clienteId) ?? clienteId;
}

export function withClienteNome<T extends { clienteId: string }>(records: T[], resolve: (id: string) => string): Array<T & { clienteNome: string }> {
  return records.map((r) => ({ ...r, clienteNome: resolve(r.clienteId) }));
}

/** Semantica dell'app: `incassato` assente vale incassata, solo `false` è da incassare. */
export function isIncassata(f: Fattura): boolean {
  return f.incassato !== false;
}

export function anno(date: string): number {
  return Number(date.slice(0, 4));
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface QuantitaPerCliente {
  clienteId: string;
  clienteNome: string;
  speciale?: true;
  giornate: number;
  ore: number;
  workLogIds: string[];
}

/** Somma delle quantità per cliente nel periodo, separata per tipo: solo quantità, mai importi (13.7). */
export function quantitaPerCliente(workLogs: WorkLog[], resolve: (id: string) => string): QuantitaPerCliente[] {
  const rows = new Map<string, QuantitaPerCliente>();
  for (const log of workLogs) {
    let row = rows.get(log.clienteId);
    if (!row) {
      row = { clienteId: log.clienteId, clienteNome: resolve(log.clienteId), giornate: 0, ore: 0, workLogIds: [] };
      if (specialClientName(log.clienteId)) row.speciale = true;
      rows.set(log.clienteId, row);
    }
    const quantita = getWorkLogQuantita(log);
    if (log.tipo === 'ore') row.ore = round2(row.ore + quantita);
    else row.giornate = round2(row.giornate + quantita);
    row.workLogIds.push(log.id);
  }
  return [...rows.values()];
}

export async function snapshotOf(ctx: ToolContext, userId: string): Promise<UserSnapshot> {
  return ctx.ds.getSnapshot(ctx.principal, userId);
}

export const sortByData = <T extends { data: string; id: string }>(records: T[]): T[] =>
  [...records].sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

export const euro = (n: number): string => `${n.toFixed(2)} EUR`;
