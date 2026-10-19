import { DataSourceError, paginate, type DataSource, type Principal, type ProposalFilter, type UserSnapshot } from '../../../mcp/src/datasource';
import type { IndexedDBManager } from '../db/IndexedDBManager';
import { STORES, WEBMCP_PROPOSALS_STORE } from '../constants/fiscali';
import { finishProposal, planProposal, type ProposalPlan } from '../sync/applyProposal';
import { createProposal, withExpiry, type NewProposal } from '../sync/proposals';
import type { Proposal } from '../sync/schema';
import { validateProposalPayload } from '../sync/validate';

export const isBrowserProposal = (id: string): boolean => id.startsWith('webmcp_prop_');

const request = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Accesso al solo profilo attivo. Le bozze restano in questo browser. */
export class BrowserDataSource implements DataSource {
  constructor(
    private readonly manager: IndexedDBManager,
    private readonly activeUserId: () => string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private checkUser(userId: string): void {
    if (!userId || this.activeUserId() !== userId) {
      throw new DataSourceError('PERMISSION_DENIED', 'Seleziona il profilo in Pivella e ripeti la richiesta.');
    }
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = this.manager.db;
    if (!db) throw new DataSourceError('SOURCE_UNAVAILABLE', 'Database non pronto.');
    const tx = db.transaction([...STORES, WEBMCP_PROPOSALS_STORE], mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Transazione annullata'));
    });
    try {
      const result = await run(tx);
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* Già terminata. */ }
      await done.catch(() => {});
      throw error;
    }
  }

  private async snapshot(tx: IDBTransaction, userId: string): Promise<UserSnapshot> {
    this.checkUser(userId);
    const user = await request(tx.objectStore('users').get(userId));
    if (!user) throw new DataSourceError('USER_NOT_FOUND', 'Profilo non disponibile.');
    const own = async (store: typeof STORES[number]) =>
      (await request(tx.objectStore(store).getAll())).filter(r => r.userId === userId);
    const [config, clienti, fatture, workLogs, scadenze, bankFormats, bankTransactions] = await Promise.all([
      own('config'), own('clienti'), own('fatture'), own('workLogs'), own('scadenze'), own('bankFormats'), own('bankTransactions'),
    ]);
    this.checkUser(userId);
    return { user, config: config[0] ?? null, clienti, fatture, workLogs, scadenze, bankFormats, bankTransactions, readAt: this.now().toISOString() };
  }

  async listUsers(p: Principal) {
    const userId = this.activeUserId();
    if (!userId) throw new DataSourceError('PERMISSION_DENIED', 'Seleziona un profilo in Pivella.');
    return [(await this.getSnapshot(p, userId)).user];
  }

  async getSnapshot(_p: Principal, userId: string): Promise<UserSnapshot> {
    return this.transaction('readonly', tx => this.snapshot(tx, userId));
  }

  async listProposals(_p: Principal, filter: ProposalFilter) {
    this.checkUser(filter.userId);
    return this.transaction('readonly', async tx => {
      const all = await request<Proposal[]>(tx.objectStore(WEBMCP_PROPOSALS_STORE).getAll());
      this.checkUser(filter.userId);
      const filtered = withExpiry(all, this.now().toISOString())
        .filter(p => p.userId === filter.userId && (!filter.status || p.status === filter.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      // I tool calcolano totali e paginazione; qui si pagina solo se richiesto.
      return filter.limit === undefined && filter.offset === undefined
        ? { items: filtered, total: filtered.length }
        : paginate(filtered, filter.limit, filter.offset);
    });
  }

  async getProposal(_p: Principal, id: string): Promise<Proposal | null> {
    return this.transaction('readonly', async tx => {
      const proposal = await request<Proposal | undefined>(tx.objectStore(WEBMCP_PROPOSALS_STORE).get(id));
      if (!proposal) return null;
      this.checkUser(proposal.userId);
      return withExpiry([proposal], this.now().toISOString())[0];
    });
  }

  async addProposal(p: Principal, input: NewProposal): Promise<Proposal> {
    if (input.kind !== 'fattura') throw new DataSourceError('PERMISSION_DENIED', 'WebMCP supporta solo proposte di fattura.');
    return this.transaction('readwrite', async tx => {
      const snap = await this.snapshot(tx, input.userId);
      const now = this.now().toISOString();
      const payload = validateProposalPayload('fattura', input.payload, { ...snap, today: now.slice(0, 10) });
      const proposal = createProposal({ ...input, payload: { ...payload }, client: 'WebMCP' }, {
        now, writerId: p.writerId, id: `webmcp_prop_${crypto.randomUUID()}`,
      });
      this.checkUser(input.userId);
      tx.objectStore(WEBMCP_PROPOSALS_STORE).add(proposal);
      return proposal;
    });
  }

  async withdrawProposal(): Promise<Proposal> {
    throw new DataSourceError('PERMISSION_DENIED', 'Rifiuta la proposta in Pivella.');
  }

  /** Solo la UI chiama questo metodo; nessun tool può confermare una proposta. */
  async decideProposal(id: string, decision: 'apply' | 'reject'): Promise<{ proposal: Proposal; plan: ProposalPlan | null }> {
    return this.transaction('readwrite', async tx => {
      const store = tx.objectStore(WEBMCP_PROPOSALS_STORE);
      const current = await request<Proposal | undefined>(store.get(id));
      if (!current) throw new DataSourceError('NOT_FOUND', 'Proposta non trovata.');
      const snap = await this.snapshot(tx, current.userId);
      const now = this.now().toISOString();
      if (current.kind !== 'fattura') throw new DataSourceError('VALIDATION', 'Tipo di proposta WebMCP non supportato.');
      const plan = decision === 'apply' ? planProposal(current, {
        ...snap, userId: current.userId, now, today: now.slice(0, 10), newId: () => `webmcp_${crypto.randomUUID()}`,
      }) : null;
      const proposal = finishProposal(current, plan ? { status: 'applied', result: plan.result } : { status: 'rejected', rejectReason: null }, now);
      this.checkUser(current.userId);
      if (plan) for (const put of plan.puts) {
        put.record = this.manager.stamp(put.record);
        tx.objectStore(put.store).put(put.record);
      }
      store.put(proposal);
      return { proposal, plan };
    });
  }
}
