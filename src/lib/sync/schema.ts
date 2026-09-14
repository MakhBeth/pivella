/**
 * Formato v2 del file di sync (specifica: docs/fattibilita-mcp.md, sezione 13.2).
 *
 * Modulo puro: nessuna dipendenza dal DOM o da Node, usabile dall'app,
 * dal server MCP e dai test.
 */
import type { Cliente, Config, Fattura, Scadenza, StoreName, User, WorkLog } from '../../types';
import { STORES } from '../constants/fiscali';

export const SYNC_SCHEMA_VERSION = 2 as const;

export type WriterKind = 'app' | 'mcp' | 'restore';

export interface Writer {
  id: string;
  kind: WriterKind;
  version?: string;
}

export interface Tombstone {
  store: StoreName;
  id: string;
  deletedAt: string;
  deletedBy: string;
}

export type ProposalKind = 'workLog' | 'fattura' | 'cliente' | 'incasso' | 'scadenzaPagata';
export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'withdrawn' | 'expired';

export interface Proposal {
  id: string;
  userId: string;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  motivazione?: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  createdBy: { writerId: string; client?: string };
  result: { recordId: string; numero?: string } | null;
  rejectReason: string | null;
}

export interface SyncStores {
  users: User[];
  config: Config[];
  clienti: Cliente[];
  fatture: Fattura[];
  workLogs: WorkLog[];
  scadenze: Scadenza[];
}

/** Un record di uno store qualsiasi, visto dal merge. */
export type SyncRecord = SyncStores[StoreName][number];

export interface SyncSnapshot extends SyncStores {
  schemaVersion: typeof SYNC_SCHEMA_VERSION;
  updatedAt: string;
  writer: Writer;
  restoredAt: string | null;
  restoredFrom: string | null;
  tombstones: Tombstone[];
  proposals: Proposal[];
}

export type SyncErrorCode = 'SOURCE_UNAVAILABLE' | 'VALIDATION';

export class SyncSchemaError extends Error {
  code: SyncErrorCode;
  details?: Record<string, unknown>;
  constructor(code: SyncErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SyncSchemaError';
    this.code = code;
    this.details = details;
  }
}

export interface Stamp {
  now: string;
  writer: Writer;
}

export function createEmptySnapshot({ now, writer }: Stamp): SyncSnapshot {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: now,
    writer: { ...writer },
    restoredAt: null,
    restoredFrom: null,
    users: [],
    config: [],
    clienti: [],
    fatture: [],
    workLogs: [],
    scadenze: [],
    tombstones: [],
    proposals: [],
  };
}

/** Formato v1: il puro `Record<StoreName, any[]>` scritto oggi dall'app. */
export type V1File = Partial<Record<StoreName, unknown[]>>;

export function upgradeV1(data: V1File, stamp: Stamp): SyncSnapshot {
  const snapshot = createEmptySnapshot(stamp);
  for (const store of STORES) {
    // Il v1 scritto dall'app ha sempre tutti gli store; uno mancante vale vuoto.
    const records = data[store] === undefined ? [] : validateStore(store, data[store]);
    (snapshot[store] as SyncRecord[]) = records.map((record) => ({
      ...record,
      updatedAt: stamp.now,
      updatedBy: stamp.writer.id,
    })) as SyncRecord[];
  }
  return snapshot;
}

/**
 * Uno store deve essere un array di oggetti con `id` stringa e senza
 * duplicati. Un file che non rispetta questo non viene fuso né ripristinato:
 * meglio fermarsi che scartare record in silenzio.
 */
function validateStore(store: StoreName, value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new SyncSchemaError('SOURCE_UNAVAILABLE', `Store ${store} non è un array`, { store });
  }
  const seen = new Set<string>();
  for (const record of value) {
    const id = (record as { id?: unknown } | null)?.id;
    if (typeof record !== 'object' || record === null || Array.isArray(record) || typeof id !== 'string' || id.length === 0) {
      throw new SyncSchemaError('SOURCE_UNAVAILABLE', `Record senza id valido nello store ${store}`, { store });
    }
    if (seen.has(id)) {
      throw new SyncSchemaError('SOURCE_UNAVAILABLE', `Id duplicato ${id} nello store ${store}`, { store, id });
    }
    seen.add(id);
  }
  return value as Record<string, unknown>[];
}

export interface ParsedSyncFile {
  snapshot: SyncSnapshot;
  upgradedFromV1: boolean;
}

export function parseSyncFile(text: string, stamp: Stamp): ParsedSyncFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SyncSchemaError('SOURCE_UNAVAILABLE', 'File di sync non è JSON valido', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SyncSchemaError('SOURCE_UNAVAILABLE', 'File di sync non è un oggetto');
  }
  const obj = raw as Record<string, unknown>;
  if (!('schemaVersion' in obj)) {
    return { snapshot: upgradeV1(obj as V1File, stamp), upgradedFromV1: true };
  }
  const version = obj.schemaVersion;
  if (version !== SYNC_SCHEMA_VERSION) {
    throw new SyncSchemaError('SOURCE_UNAVAILABLE', `Versione del file di sync non supportata: ${String(version)}`, {
      schemaVersion: version,
      supported: SYNC_SCHEMA_VERSION,
    });
  }
  const snapshot = createEmptySnapshot(stamp);
  const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  for (const store of STORES) {
    // In v2 ogni store è obbligatorio: null o assente non valgono "vuoto".
    (snapshot[store] as unknown[]) = validateStore(store, obj[store]);
  }
  snapshot.updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : stamp.now;
  snapshot.writer = isWriter(obj.writer) ? obj.writer : { ...stamp.writer };
  snapshot.restoredAt = typeof obj.restoredAt === 'string' ? obj.restoredAt : null;
  snapshot.restoredFrom = typeof obj.restoredFrom === 'string' ? obj.restoredFrom : null;
  snapshot.tombstones = asArray(obj.tombstones) as Tombstone[];
  snapshot.proposals = asArray(obj.proposals) as Proposal[];
  return { snapshot, upgradedFromV1: false };
}

function isWriter(value: unknown): value is Writer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Writer).id === 'string' &&
    typeof (value as Writer).kind === 'string'
  );
}

export function serializeSnapshot(snapshot: SyncSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** JSON con chiavi ordinate ricorsivamente: stessa struttura, stessa stringa. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Uguaglianza sui dati: store, tombstone, proposte, restoredAt/restoredFrom.
 * Ignora `updatedAt` e `writer` della busta e l'ordine dei record.
 */
export function snapshotsEquivalent(a: SyncSnapshot, b: SyncSnapshot): boolean {
  return dataFingerprint(a) === dataFingerprint(b);
}

export function dataFingerprint(snapshot: SyncSnapshot): string {
  const byId = (records: { id: string }[]) => [...records].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const tombstoneKey = (t: Tombstone) => `${t.store}/${t.id}`;
  return canonicalJson({
    schemaVersion: snapshot.schemaVersion,
    restoredAt: snapshot.restoredAt,
    restoredFrom: snapshot.restoredFrom,
    stores: Object.fromEntries(STORES.map((store) => [store, byId(snapshot[store] as { id: string }[])])),
    tombstones: [...snapshot.tombstones].sort((x, y) => (tombstoneKey(x) < tombstoneKey(y) ? -1 : 1)),
    proposals: byId(snapshot.proposals),
  });
}

/**
 * Istante numerico di un timestamp ISO. Un valore assente o non
 * interpretabile vale epoca zero, quindi perde contro qualsiasi timestamp
 * valido. Tutti i confronti temporali del merge passano da qui: mai
 * confrontare stringhe, perché `10:00:00Z` ordinerebbe dopo `10:00:00.500Z`.
 */
export function instantOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

export function compareInstants(a: string | null | undefined, b: string | null | undefined): number {
  const ia = instantOf(a);
  const ib = instantOf(b);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Timestamp da assegnare al tombstone di `record`: strettamente maggiore
 * dell'`updatedAt` del record, così il merge lo cancella anche se
 * aggiornamento e cancellazione cadono nello stesso millisecondo (13.8).
 */
export function tombstoneTimestamp(now: string, record: { updatedAt?: string }): string {
  const nowMs = instantOf(now);
  const recordMs = instantOf(record.updatedAt);
  return nowMs > recordMs ? now : new Date(recordMs + 1).toISOString();
}
