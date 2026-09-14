/**
 * Decisione di una proposta dall'app: conferma (applica) o rifiuto.
 *
 * Gira dentro un giro di sync, nel gancio `inLock` (13.2): sotto lo stesso
 * lock la proposta viene riletta dal file fuso, rivalidata, i record scritti
 * in IndexedDB e la proposta marcata nel file. Se la rivalidazione fallisce
 * non succede nulla e la proposta resta in attesa. Puro rispetto al browser,
 * testato con file system in memoria e fake-indexeddb.
 */
import type { IndexedDBManager } from '../db/IndexedDBManager';
import { STORES } from '../constants/fiscali';
import type { StoreName } from '../../types';
import { finishProposal, planProposal, type ProposalPlan } from './applyProposal';
import { mergeSnapshots, type MergeResult } from './merge';
import { isPending, ProposalNotPendingError } from './proposals';
import type { Proposal, SyncSnapshot, Writer } from './schema';
import { runSyncCycle, type AppliedChanges, type SyncCycleOptions, type SyncCycleOutcome, type SyncSource } from './syncCycle';

export type Decision = { kind: 'apply' } | { kind: 'reject'; reason?: string };

export interface DecideProposalOptions {
  db: IndexedDBManager;
  source: SyncSource;
  writer: Writer;
  proposalId: string;
  decision: Decision;
  now?: () => Date;
  /** Id dei record nuovi; l'app usa `Date.now()` come oggi. */
  newId?: () => string;
  prepareRemote?: SyncCycleOptions['prepareRemote'];
  /** Riceve i record scritti dalla conferma (e quelli del merge del giro). */
  onApplied?: SyncCycleOptions['onApplied'];
}

export interface DecideProposalOutcome {
  proposal: Proposal;
  plan: ProposalPlan | null;
  cycle: SyncCycleOutcome;
}

export class ProposalNotFoundError extends Error {
  code = 'NOT_FOUND' as const;
  constructor(proposalId: string) {
    super(`Proposta ${proposalId} non trovata nel file di sincronizzazione`);
    this.name = 'ProposalNotFoundError';
  }
}

const emptyChanges = (): AppliedChanges =>
  Object.fromEntries(STORES.map((s) => [s, { upserted: [] as string[], deleted: [] as string[] }])) as AppliedChanges;

export async function decideProposal(options: DecideProposalOptions): Promise<DecideProposalOutcome> {
  const { db, source, writer, proposalId, decision } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => Date.now().toString());
  let decided: Proposal | null = null;
  let plan: ProposalPlan | null = null;

  const cycle = await runSyncCycle({
    db,
    source,
    writer,
    now,
    prepareRemote: options.prepareRemote,
    onApplied: options.onApplied,
    inLock: async (merged: SyncSnapshot) => {
      const nowIso = now().toISOString();
      const index = merged.proposals.findIndex((p) => p.id === proposalId);
      if (index < 0) throw new ProposalNotFoundError(proposalId);
      const current = merged.proposals[index];
      if (!isPending(current, nowIso)) throw new ProposalNotPendingError(current.id, isPending(current, current.updatedAt) ? 'expired' : current.status);

      if (decision.kind === 'reject') {
        decided = finishProposal(current, { status: 'rejected', rejectReason: decision.reason ?? null }, nowIso);
        return withProposal(merged, index, decided);
      }

      // Rivalidazione sui dati fusi, che dopo mergeIntoDb coincidono con il database.
      const userId = current.userId;
      const own = <T extends { userId: string }>(records: T[]) => records.filter((r) => r.userId === userId);
      plan = planProposal(current, {
        userId,
        config: merged.config.find((c) => c.id === `config_${userId}`) ?? merged.config.find((c) => c.userId === userId) ?? null,
        clienti: own(merged.clienti),
        fatture: own(merged.fatture),
        scadenze: own(merged.scadenze),
        today: nowIso.slice(0, 10),
        now: nowIso,
        newId,
      });

      // Prima il database, poi il file: se l'app muore nel mezzo i record
      // restano e la proposta torna in attesa, e la rivalidazione al giro
      // successivo la rifiuta (cliente duplicato, fattura già incassata) o
      // al peggio la ripropone all'utente.
      const changes = emptyChanges();
      for (const { store, record } of plan.puts) {
        await db.put(store, db.stamp(record));
        changes[store as StoreName].upserted.push(record.id);
      }
      const local = await db.exportSnapshot();
      const refused = mergeSnapshots(local, merged, { now: nowIso, writer });
      decided = finishProposal(current, { status: 'applied', result: plan.result }, nowIso);
      const snapshot = withProposal(refused.snapshot, refused.snapshot.proposals.findIndex((p) => p.id === proposalId), decided);
      const published: MergeResult = { snapshot, changes, hasChanges: true, conflicts: [], orphans: [] };
      await options.onApplied?.(changes, published);
      return snapshot;
    },
  });

  if (cycle.status === 'stale') throw new Error('Il file di sincronizzazione continua a cambiare: riprova');
  if (cycle.status === 'restored') throw new Error('Il file conteneva un ripristino, applicato ora: ricontrolla e riprova');
  if (!decided) throw new ProposalNotFoundError(proposalId);
  return { proposal: decided, plan, cycle };
}

function withProposal(snapshot: SyncSnapshot, index: number, proposal: Proposal): SyncSnapshot {
  const proposals = [...snapshot.proposals];
  if (index < 0) proposals.push(proposal);
  else proposals[index] = proposal;
  return { ...snapshot, proposals };
}
