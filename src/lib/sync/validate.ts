/**
 * Regole di validazione delle proposte (13.1), condivise tra il server MCP
 * che le crea e l'app che le rivaluta prima di applicarle: una proposta nel
 * file non è mai fidata. Modulo puro, senza dipendenze da DOM o Node.
 */
import { MISC_CLIENT_ID, VACATION_CLIENT_ID, type Cliente, type Config, type Fattura, type Scadenza } from '../../types';
import type { ProposalKind } from './schema';

export interface ValidationContext {
  config: Config | null;
  clienti: Cliente[];
  fatture: Fattura[];
  scadenze: Scadenza[];
  /** Data odierna `YYYY-MM-DD`, iniettata per i test. */
  today: string;
}

export interface FieldError {
  field: string;
  reason: string;
}

export type ProposalValidationCode = 'VALIDATION' | 'NOT_FOUND';

export class ProposalValidationError extends Error {
  code: ProposalValidationCode;
  fields: FieldError[];
  details?: Record<string, unknown>;
  constructor(code: ProposalValidationCode, fields: FieldError[], details?: Record<string, unknown>) {
    super(fields.map((f) => `${f.field}: ${f.reason}`).join('; ') || 'Proposta non valida');
    this.name = 'ProposalValidationError';
    this.code = code;
    this.fields = fields;
    this.details = { ...details, fields };
  }
}

export interface WorkLogPayload {
  clienteId: string;
  data: string;
  tipo: 'ore' | 'giornata';
  quantita: number;
  note?: string;
}

export interface NuovoClientePayload {
  denominazione: string;
  partitaIva?: string;
  nazione?: string;
  indirizzo?: string;
  numeroCivico?: string;
  cap?: string;
  comune?: string;
  provincia?: string;
}

export interface FatturaRigaPayload {
  descrizione: string;
  quantita: number;
  prezzoUnitario: number;
}

export interface FatturaPayload {
  clienteId?: string;
  nuovoCliente?: NuovoClientePayload;
  data: string;
  righe: FatturaRigaPayload[];
  valuta: string;
  tassoCambio?: number;
  dataCambio?: string;
  dataIncasso?: string;
}

export interface ClientePayload {
  nome: string;
  piva?: string;
  email?: string;
  billingUnit?: 'ore' | 'giornata';
  rate?: number;
  billingStartDate?: string;
  indirizzo?: string;
  numeroCivico?: string;
  cap?: string;
  comune?: string;
  provincia?: string;
  nazione: string;
}

export interface IncassoPayload {
  fatturaId: string;
  dataIncasso: string;
}

export interface ScadenzaPagataPayload {
  scadenzaId: string;
  dataPagamento: string;
}

export interface PayloadByKind {
  workLog: WorkLogPayload;
  fattura: FatturaPayload;
  cliente: ClientePayload;
  incasso: IncassoPayload;
  scadenzaPagata: ScadenzaPagataPayload;
}

export const WORK_LOG_MAX_FUTURE_DAYS = 30;
export const MOTIVAZIONE_MAX_LENGTH = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Confronto senza maiuscole e spazi, per i nomi dei clienti. */
export function normalizeNome(nome: string): string {
  return nome.toLowerCase().replace(/\s+/g, '');
}

export function isSpecialClient(clienteId: string): boolean {
  return clienteId === VACATION_CLIENT_ID || clienteId === MISC_CLIENT_ID;
}

export function emittenteConfigurato(config: Config | null): boolean {
  return Boolean(config?.emittente?.codiceFiscale && config?.partitaIva);
}

export function valuteDisponibili(config: Config | null): NonNullable<Config['valute']> {
  return config?.valute?.length ? config.valute : [{ codice: 'EUR', simbolo: '€' }];
}

class Collector {
  fields: FieldError[] = [];
  private readonly raw: Record<string, unknown>;
  private readonly known = new Set<string>();

  constructor(raw: Record<string, unknown>) {
    this.raw = raw;
  }

  add(field: string, reason: string): void {
    this.fields.push({ field, reason });
  }

  requiredString(field: string): string | undefined {
    this.known.add(field);
    const value = this.raw[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.add(field, 'obbligatorio');
      return undefined;
    }
    return value;
  }

  optionalString(field: string): string | undefined {
    this.known.add(field);
    const value = this.raw[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      this.add(field, 'deve essere una stringa');
      return undefined;
    }
    return value;
  }

  requiredDate(field: string): string | undefined {
    this.known.add(field);
    const value = this.raw[field];
    if (!isIsoDate(value)) {
      this.add(field, 'data non valida, formato YYYY-MM-DD');
      return undefined;
    }
    return value;
  }

  optionalDate(field: string): string | undefined {
    this.known.add(field);
    const value = this.raw[field];
    if (value === undefined || value === null) return undefined;
    return this.requiredDate(field);
  }

  positiveNumber(field: string, optional = false): number | undefined {
    this.known.add(field);
    const value = this.raw[field];
    if (optional && (value === undefined || value === null)) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      this.add(field, 'deve essere un numero maggiore di zero');
      return undefined;
    }
    return value;
  }

  oneOf<T extends string>(field: string, allowed: readonly T[], optional = false): T | undefined {
    this.known.add(field);
    const value = this.raw[field];
    if (optional && (value === undefined || value === null)) return undefined;
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.add(field, `deve essere uno tra ${allowed.join(', ')}`);
      return undefined;
    }
    return value as T;
  }

  /** Segna come noto un campo gestito a mano dal chiamante. */
  claim(field: string): unknown {
    this.known.add(field);
    return this.raw[field];
  }

  rejectUnknown(): void {
    for (const key of Object.keys(this.raw)) {
      if (!this.known.has(key)) this.add(key, 'campo non previsto');
    }
  }

  throwIfAny(details?: Record<string, unknown>): void {
    if (this.fields.length > 0) throw new ProposalValidationError('VALIDATION', this.fields, details);
  }
}

function asObject(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ProposalValidationError('VALIDATION', [{ field: 'payload', reason: 'deve essere un oggetto' }]);
  }
  return payload as Record<string, unknown>;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function validateWorkLog(raw: Record<string, unknown>, ctx: ValidationContext): WorkLogPayload {
  const c = new Collector(raw);
  const clienteId = c.requiredString('clienteId');
  if (clienteId !== undefined && !isSpecialClient(clienteId) && !ctx.clienti.some((cl) => cl.id === clienteId)) {
    c.add('clienteId', 'cliente inesistente per questo profilo');
  }
  const data = c.requiredDate('data');
  if (data !== undefined && data > addDays(ctx.today, WORK_LOG_MAX_FUTURE_DAYS)) {
    c.add('data', `non oltre ${WORK_LOG_MAX_FUTURE_DAYS} giorni nel futuro`);
  }
  const tipo = c.oneOf('tipo', ['ore', 'giornata'] as const);
  const quantita = c.positiveNumber('quantita');
  if (tipo !== undefined && quantita !== undefined) {
    if (tipo === 'ore' && quantita > 24) c.add('quantita', 'massimo 24 ore');
    if (tipo === 'giornata' && quantita > 1) c.add('quantita', 'massimo 1 giornata');
  }
  const note = c.optionalString('note');
  c.rejectUnknown();
  c.throwIfAny();
  return withoutUndefined({ clienteId: clienteId!, data: data!, tipo: tipo!, quantita: quantita!, note });
}

function validateNuovoCliente(raw: unknown, c: Collector): NuovoClientePayload | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    c.add('nuovoCliente', 'deve essere un oggetto');
    return undefined;
  }
  const inner = new Collector(raw as Record<string, unknown>);
  const denominazione = inner.requiredString('denominazione');
  const out: NuovoClientePayload = withoutUndefined({
    denominazione: denominazione!,
    partitaIva: inner.optionalString('partitaIva'),
    nazione: inner.optionalString('nazione'),
    indirizzo: inner.optionalString('indirizzo'),
    numeroCivico: inner.optionalString('numeroCivico'),
    cap: inner.optionalString('cap'),
    comune: inner.optionalString('comune'),
    provincia: inner.optionalString('provincia'),
  });
  inner.rejectUnknown();
  for (const f of inner.fields) c.add(`nuovoCliente.${f.field}`, f.reason);
  return out;
}

function validateRighe(raw: unknown, c: Collector): FatturaRigaPayload[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    c.add('righe', 'almeno una riga');
    return [];
  }
  const righe: FatturaRigaPayload[] = [];
  raw.forEach((riga, i) => {
    if (typeof riga !== 'object' || riga === null || Array.isArray(riga)) {
      c.add(`righe[${i}]`, 'deve essere un oggetto');
      return;
    }
    const inner = new Collector(riga as Record<string, unknown>);
    const descrizione = inner.requiredString('descrizione');
    const quantita = inner.positiveNumber('quantita');
    const prezzoUnitario = inner.positiveNumber('prezzoUnitario');
    inner.rejectUnknown();
    for (const f of inner.fields) c.add(`righe[${i}].${f.field}`, f.reason);
    if (inner.fields.length === 0) righe.push({ descrizione: descrizione!, quantita: quantita!, prezzoUnitario: prezzoUnitario! });
  });
  return righe;
}

function validateFattura(raw: Record<string, unknown>, ctx: ValidationContext): FatturaPayload {
  const c = new Collector(raw);
  if (!emittenteConfigurato(ctx.config)) c.add('emittente', 'configura i dati emittente nelle Impostazioni');

  const clienteIdRaw = c.claim('clienteId');
  const nuovoClienteRaw = c.claim('nuovoCliente');
  const hasCliente = clienteIdRaw !== undefined && clienteIdRaw !== null;
  const hasNuovo = nuovoClienteRaw !== undefined && nuovoClienteRaw !== null;
  let clienteId: string | undefined;
  let nuovoCliente: NuovoClientePayload | undefined;
  if (hasCliente === hasNuovo) {
    c.add('clienteId', 'indica esattamente uno tra clienteId e nuovoCliente');
  } else if (hasCliente) {
    if (typeof clienteIdRaw !== 'string' || clienteIdRaw.length === 0) c.add('clienteId', 'obbligatorio');
    else if (isSpecialClient(clienteIdRaw)) c.add('clienteId', 'i clienti speciali non si fatturano');
    else if (!ctx.clienti.some((cl) => cl.id === clienteIdRaw)) c.add('clienteId', 'cliente inesistente per questo profilo');
    else clienteId = clienteIdRaw;
  } else {
    nuovoCliente = validateNuovoCliente(nuovoClienteRaw, c);
  }

  const data = c.requiredDate('data');
  const righe = validateRighe(c.claim('righe'), c);

  const valuta = c.optionalString('valuta') ?? 'EUR';
  const valute = valuteDisponibili(ctx.config);
  if (!valute.some((v) => v.codice === valuta)) c.add('valuta', `valuta non configurata, disponibili: ${valute.map((v) => v.codice).join(', ')}`);
  const tassoCambio = c.positiveNumber('tassoCambio', true);
  if (valuta !== 'EUR' && tassoCambio === undefined && !c.fields.some((f) => f.field === 'tassoCambio')) {
    c.add('tassoCambio', 'obbligatorio per una valuta diversa da EUR');
  }
  const dataCambio = c.optionalDate('dataCambio');
  const dataIncasso = c.optionalDate('dataIncasso');
  if (data !== undefined && dataIncasso !== undefined && dataIncasso < data) c.add('dataIncasso', 'non prima della data della fattura');

  c.rejectUnknown();
  c.throwIfAny();
  return withoutUndefined({ clienteId, nuovoCliente, data: data!, righe, valuta, tassoCambio, dataCambio, dataIncasso });
}

function validateCliente(raw: Record<string, unknown>, ctx: ValidationContext): ClientePayload {
  const c = new Collector(raw);
  const nome = c.requiredString('nome');
  let clienteEsistenteId: string | undefined;
  if (nome !== undefined) {
    const existing = ctx.clienti.find((cl) => normalizeNome(cl.nome) === normalizeNome(nome));
    if (existing) {
      clienteEsistenteId = existing.id;
      c.add('nome', `cliente già presente: ${existing.nome}`);
    }
  }
  const out: ClientePayload = withoutUndefined({
    nome: nome?.trim() ?? '',
    piva: c.optionalString('piva'),
    email: c.optionalString('email'),
    billingUnit: c.oneOf('billingUnit', ['ore', 'giornata'] as const, true),
    rate: c.positiveNumber('rate', true),
    billingStartDate: c.optionalDate('billingStartDate'),
    indirizzo: c.optionalString('indirizzo'),
    numeroCivico: c.optionalString('numeroCivico'),
    cap: c.optionalString('cap'),
    comune: c.optionalString('comune'),
    provincia: c.optionalString('provincia'),
    nazione: c.optionalString('nazione') ?? 'IT',
  });
  c.rejectUnknown();
  c.throwIfAny(clienteEsistenteId ? { clienteEsistenteId } : undefined);
  return out;
}

function validateIncasso(raw: Record<string, unknown>, ctx: ValidationContext): IncassoPayload {
  const c = new Collector(raw);
  const fatturaId = c.requiredString('fatturaId');
  const dataIncasso = c.requiredDate('dataIncasso');
  c.rejectUnknown();
  c.throwIfAny();
  const fattura = ctx.fatture.find((f) => f.id === fatturaId);
  if (!fattura) throw new ProposalValidationError('NOT_FOUND', [{ field: 'fatturaId', reason: 'fattura inesistente per questo profilo' }]);
  // Semantica dell'app: `incassato` assente vale incassata; solo `false` è da incassare.
  if (fattura.incassato !== false) c.add('fatturaId', 'fattura già incassata');
  if (dataIncasso! < fattura.data) c.add('dataIncasso', 'non prima della data della fattura');
  c.throwIfAny();
  return { fatturaId: fatturaId!, dataIncasso: dataIncasso! };
}

function validateScadenzaPagata(raw: Record<string, unknown>, ctx: ValidationContext): ScadenzaPagataPayload {
  const c = new Collector(raw);
  const scadenzaId = c.requiredString('scadenzaId');
  const dataPagamento = c.requiredDate('dataPagamento');
  c.rejectUnknown();
  c.throwIfAny();
  const scadenza = ctx.scadenze.find((s) => s.id === scadenzaId);
  if (!scadenza) throw new ProposalValidationError('NOT_FOUND', [{ field: 'scadenzaId', reason: 'scadenza inesistente per questo profilo' }]);
  if (scadenza.pagato) c.add('scadenzaId', 'scadenza già pagata');
  c.throwIfAny();
  return { scadenzaId: scadenzaId!, dataPagamento: dataPagamento! };
}

/**
 * Valida il payload di una proposta e ne restituisce la forma normalizzata
 * (default applicati, campi sconosciuti rifiutati). Lancia
 * `ProposalValidationError` con codice `VALIDATION` o `NOT_FOUND`.
 */
export function validateProposalPayload<K extends ProposalKind>(kind: K, payload: unknown, ctx: ValidationContext): PayloadByKind[K] {
  const raw = asObject(payload);
  switch (kind) {
    case 'workLog':
      return validateWorkLog(raw, ctx) as PayloadByKind[K];
    case 'fattura':
      return validateFattura(raw, ctx) as PayloadByKind[K];
    case 'cliente':
      return validateCliente(raw, ctx) as PayloadByKind[K];
    case 'incasso':
      return validateIncasso(raw, ctx) as PayloadByKind[K];
    case 'scadenzaPagata':
      return validateScadenzaPagata(raw, ctx) as PayloadByKind[K];
    default:
      throw new ProposalValidationError('VALIDATION', [{ field: 'kind', reason: `kind sconosciuto: ${String(kind)}` }]);
  }
}

export interface FatturaPreview {
  totaleImponibile: number;
  totaleEUR: number;
  righe: Array<FatturaRigaPayload & { totale: number }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Anteprima dei totali, come il modale: EUR = importo / tasso (1 EUR = X valuta). */
export function fatturaPreview(payload: Pick<FatturaPayload, 'righe' | 'valuta' | 'tassoCambio'>): FatturaPreview {
  const righe = payload.righe.map((r) => ({ ...r, totale: round2(r.quantita * r.prezzoUnitario) }));
  const totaleImponibile = round2(righe.reduce((sum, r) => sum + r.quantita * r.prezzoUnitario, 0));
  const isForeign = payload.valuta !== 'EUR' && payload.tassoCambio !== undefined && payload.tassoCambio > 0;
  const totaleEUR = isForeign ? round2(totaleImponibile / payload.tassoCambio!) : totaleImponibile;
  return { totaleImponibile, totaleEUR, righe };
}
