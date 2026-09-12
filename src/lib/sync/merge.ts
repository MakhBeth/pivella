/**
 * Merge di due snapshot v2 (specifica: docs/fattibilita-mcp.md, sezione 13.2).
 *
 * Puro, commutativo e idempotente sui dati. L'unità di merge è il record
 * intero: non esiste merge a livello di campo.
 */
import type { StoreName } from '../../types';
import { STORES } from '../constants/fiscali';
import {
  canonicalJson,
  compareInstants,
  createEmptySnapshot,
  instantOf,
  type Proposal,
  type ProposalStatus,
  type SyncRecord,
  type SyncSnapshot,
  type Tombstone,
  type Writer,
} from './schema';

export const TOMBSTONE_RETENTION_DAYS = 90;
export const PROPOSAL_RETENTION_DAYS = 30;

export interface MergeOptions {
  now: string;
  writer: Writer;
}

export interface VersionInfo {
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface Conflict {
  store: StoreName;
  id: string;
  reason: 'newer' | 'tiebreak';
  kept: VersionInfo;
  dropped: VersionInfo;
  /** Il record perdente per intero: va conservato durevolmente prima di applicare il merge. */
  droppedRecord: SyncRecord;
}

export interface StoreChanges {
  upserted: string[];
  deleted: string[];
}

export interface Orphan {
  store: StoreName;
  id: string;
  userId: string;
}

export interface MergeResult {
  snapshot: SyncSnapshot;
  /** Differenze del risultato rispetto ad A, per applicarle a IndexedDB. */
  changes: Record<StoreName, StoreChanges>;
  hasChanges: boolean;
  conflicts: Conflict[];
  orphans: Orphan[];
}

const TERMINAL: ReadonlySet<ProposalStatus> = new Set(['applied', 'rejected', 'withdrawn', 'expired']);

export function mergeSnapshots(a: SyncSnapshot, b: SyncSnapshot, options: MergeOptions): MergeResult {
  const result = createEmptySnapshot({ now: options.now, writer: options.writer });
  const conflicts: Conflict[] = [];
  const changes = {} as Record<StoreName, StoreChanges>;
  for (const store of STORES) changes[store] = { upserted: [], deleted: [] };

  // Tombstone: per (store, id) resta quello con deletedAt maggiore, con tiebreak deterministico.
  const tombstones = new Map<string, Tombstone>();
  for (const t of [...a.tombstones, ...b.tombstones]) {
    const key = `${t.store}/${t.id}`;
    const current = tombstones.get(key);
    if (!current || pickTombstone(current, t) === t) tombstones.set(key, t);
  }

  for (const store of STORES) {
    const recordsA = indexById(a[store] as SyncRecord[]);
    const recordsB = indexById(b[store] as SyncRecord[]);
    const ids = new Set([...recordsA.keys(), ...recordsB.keys()]);
    const merged: SyncRecord[] = [];

    for (const id of ids) {
      const ra = recordsA.get(id);
      const rb = recordsB.get(id);
      let winner: SyncRecord;
      if (ra && rb) {
        const cmp = compareVersions(ra, rb);
        winner = cmp.winner === 'a' ? ra : rb;
        if (cmp.reason) {
          const loser = cmp.winner === 'a' ? rb : ra;
          conflicts.push({ store, id, reason: cmp.reason, kept: versionOf(winner), dropped: versionOf(loser), droppedRecord: loser });
        }
      } else {
        winner = (ra ?? rb)!;
      }

      const key = `${store}/${id}`;
      const tombstone = tombstones.get(key);
      if (tombstone) {
        if (compareInstants(tombstone.deletedAt, winner.updatedAt) > 0) {
          if (ra) changes[store].deleted.push(id);
          continue;
        }
        // Record ricreato o aggiornato dopo la cancellazione: il tombstone decade.
        tombstones.delete(key);
      }

      merged.push(winner);
      if (!ra || canonicalJson(ra) !== canonicalJson(winner)) changes[store].upserted.push(id);
    }

    (result[store] as SyncRecord[]) = merged;
  }

  result.tombstones = [...tombstones.values()];
  result.proposals = mergeProposals(a.proposals, b.proposals, options.now);

  // restoredAt maggiore vince; a parità, restoredFrom minore (commutativo).
  const byRestore = compareInstants(a.restoredAt, b.restoredAt);
  const restorePick = byRestore !== 0 ? (byRestore > 0 ? a : b) : compareStrings(a.restoredFrom ?? '', b.restoredFrom ?? '') <= 0 ? a : b;
  result.restoredAt = restorePick.restoredAt;
  result.restoredFrom = restorePick.restoredFrom;

  const userIds = new Set(result.users.map((u) => u.id));
  const orphans: Orphan[] = [];
  for (const store of STORES) {
    if (store === 'users') continue;
    for (const record of result[store] as SyncRecord[]) {
      const userId = (record as { userId?: string }).userId;
      if (userId && !userIds.has(userId)) orphans.push({ store, id: record.id, userId });
    }
  }

  const hasChanges =
    STORES.some((s) => changes[s].upserted.length > 0 || changes[s].deleted.length > 0) ||
    canonicalJson(sortTombstones(a.tombstones)) !== canonicalJson(sortTombstones(result.tombstones)) ||
    canonicalJson(sortById(a.proposals)) !== canonicalJson(sortById(result.proposals)) ||
    a.restoredAt !== result.restoredAt;

  return { snapshot: result, changes, hasChanges, conflicts, orphans };
}

/**
 * Potatura, separata dal merge: tombstone più vecchi di 90 giorni e proposte
 * terminali più vecchie di 30. Va chiamata da chi scrive il file, mai dentro
 * il merge, così `merge(merge(a, b), a)` resta uguale a `merge(a, b)`.
 *
 * Limite noto: uno snapshot rimasto fermo più a lungo della retention e poi
 * fuso può far riapparire un record cancellato. La sync attiva fonde a ogni
 * avvio e a ogni focus, quindi il caso richiede una copia mai usata per mesi.
 */
export function pruneSnapshot(snapshot: SyncSnapshot, now: string): SyncSnapshot {
  const tombstoneCutoff = instantOf(now) - TOMBSTONE_RETENTION_DAYS * 86_400_000;
  const proposalCutoff = instantOf(now) - PROPOSAL_RETENTION_DAYS * 86_400_000;
  return {
    ...snapshot,
    tombstones: snapshot.tombstones.filter((t) => instantOf(t.deletedAt) >= tombstoneCutoff),
    proposals: snapshot.proposals.filter((p) => !(TERMINAL.has(p.status) && instantOf(p.updatedAt) < proposalCutoff)),
  };
}

/** Tra due tombstone della stessa chiave: deletedAt maggiore, poi deletedBy minore, poi JSON canonico minore. */
export function pickTombstone(x: Tombstone, y: Tombstone): Tombstone {
  const byTime = compareInstants(x.deletedAt, y.deletedAt);
  if (byTime !== 0) return byTime > 0 ? x : y;
  const byWriter = compareStrings(x.deletedBy ?? '', y.deletedBy ?? '');
  if (byWriter !== 0) return byWriter < 0 ? x : y;
  return canonicalJson(x) <= canonicalJson(y) ? x : y;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function indexById<T extends { id: string }>(records: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of records) map.set(r.id, r);
  return map;
}

function versionOf(record: SyncRecord): VersionInfo {
  return { updatedAt: record.updatedAt ?? null, updatedBy: record.updatedBy ?? null };
}

/**
 * Ordine tra due versioni dello stesso record: updatedAt maggiore vince;
 * a parità, updatedBy minore; a parità, JSON canonico minore.
 */
function compareVersions(ra: SyncRecord, rb: SyncRecord): { winner: 'a' | 'b'; reason: Conflict['reason'] | null } {
  const ja = canonicalJson(ra);
  const jb = canonicalJson(rb);
  if (ja === jb) return { winner: 'a', reason: null };
  const byTime = compareInstants(ra.updatedAt, rb.updatedAt);
  if (byTime !== 0) return { winner: byTime > 0 ? 'a' : 'b', reason: 'newer' };
  const wa = ra.updatedBy ?? '';
  const wb = rb.updatedBy ?? '';
  if (wa !== wb) return { winner: wa < wb ? 'a' : 'b', reason: 'tiebreak' };
  return { winner: ja < jb ? 'a' : 'b', reason: 'tiebreak' };
}

function mergeProposals(pa: Proposal[], pb: Proposal[], now: string): Proposal[] {
  const byId = new Map<string, Proposal>();
  for (const p of [...pa, ...pb]) {
    const current = byId.get(p.id);
    byId.set(p.id, current ? pickProposal(current, p) : p);
  }
  const out: Proposal[] = [];
  for (let p of byId.values()) {
    if (p.status === 'pending' && compareInstants(p.expiresAt, now) <= 0) {
      p = { ...p, status: 'expired', updatedAt: now };
    }
    out.push(p);
  }
  return out;
}

function pickProposal(x: Proposal, y: Proposal): Proposal {
  const xt = TERMINAL.has(x.status);
  const yt = TERMINAL.has(y.status);
  if (xt !== yt) return xt ? x : y;
  if (x.status !== y.status) {
    if (x.status === 'applied') return x;
    if (y.status === 'applied') return y;
  }
  const byTime = compareInstants(x.updatedAt, y.updatedAt);
  if (byTime !== 0) return byTime > 0 ? x : y;
  return canonicalJson(x) <= canonicalJson(y) ? x : y;
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

function sortTombstones(items: Tombstone[]): Tombstone[] {
  return [...items].sort((x, y) => `${x.store}/${x.id}`.localeCompare(`${y.store}/${y.id}`));
}
