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
  createEmptySnapshot,
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

const EPOCH = '';
const TERMINAL: ReadonlySet<ProposalStatus> = new Set(['applied', 'rejected', 'withdrawn', 'expired']);

export function mergeSnapshots(a: SyncSnapshot, b: SyncSnapshot, options: MergeOptions): MergeResult {
  const result = createEmptySnapshot({ now: options.now, writer: options.writer });
  const conflicts: Conflict[] = [];
  const changes = {} as Record<StoreName, StoreChanges>;
  for (const store of STORES) changes[store] = { upserted: [], deleted: [] };

  const tombstoneRetentionCutoff = shiftDays(options.now, -TOMBSTONE_RETENTION_DAYS);
  const proposalRetentionCutoff = shiftDays(options.now, -PROPOSAL_RETENTION_DAYS);

  // Tombstone: per (store, id) resta quello con deletedAt maggiore.
  const tombstones = new Map<string, Tombstone>();
  for (const t of [...a.tombstones, ...b.tombstones]) {
    const key = `${t.store}/${t.id}`;
    const current = tombstones.get(key);
    if (!current || t.deletedAt > current.deletedAt) tombstones.set(key, t);
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
          conflicts.push({ store, id, reason: cmp.reason, kept: versionOf(winner), dropped: versionOf(loser) });
        }
      } else {
        winner = (ra ?? rb)!;
      }

      const key = `${store}/${id}`;
      const tombstone = tombstones.get(key);
      if (tombstone) {
        if (tombstone.deletedAt > (winner.updatedAt ?? EPOCH)) {
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

  result.tombstones = [...tombstones.values()].filter((t) => t.deletedAt >= tombstoneRetentionCutoff);
  result.proposals = mergeProposals(a.proposals, b.proposals, options.now, proposalRetentionCutoff);

  if ((a.restoredAt ?? EPOCH) >= (b.restoredAt ?? EPOCH)) {
    result.restoredAt = a.restoredAt;
    result.restoredFrom = a.restoredFrom;
  } else {
    result.restoredAt = b.restoredAt;
    result.restoredFrom = b.restoredFrom;
  }

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
  const ta = ra.updatedAt ?? EPOCH;
  const tb = rb.updatedAt ?? EPOCH;
  if (ta !== tb) return { winner: ta > tb ? 'a' : 'b', reason: 'newer' };
  const wa = ra.updatedBy ?? '';
  const wb = rb.updatedBy ?? '';
  if (wa !== wb) return { winner: wa < wb ? 'a' : 'b', reason: 'tiebreak' };
  return { winner: ja < jb ? 'a' : 'b', reason: 'tiebreak' };
}

function mergeProposals(pa: Proposal[], pb: Proposal[], now: string, retentionCutoff: string): Proposal[] {
  const byId = new Map<string, Proposal>();
  for (const p of [...pa, ...pb]) {
    const current = byId.get(p.id);
    byId.set(p.id, current ? pickProposal(current, p) : p);
  }
  const out: Proposal[] = [];
  for (let p of byId.values()) {
    if (p.status === 'pending' && p.expiresAt <= now) {
      p = { ...p, status: 'expired', updatedAt: now };
    }
    if (TERMINAL.has(p.status) && p.updatedAt < retentionCutoff) continue;
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
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt ? x : y;
  return canonicalJson(x) <= canonicalJson(y) ? x : y;
}

function shiftDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

function sortTombstones(items: Tombstone[]): Tombstone[] {
  return [...items].sort((x, y) => `${x.store}/${x.id}`.localeCompare(`${y.store}/${y.id}`));
}
