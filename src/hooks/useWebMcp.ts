import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';
import type { Proposal } from '../lib/sync/schema';
import { BrowserDataSource } from '../lib/webmcp/browserDataSource';
import { getModelContext, registerBrowserTools } from '../lib/webmcp/register';

const ENABLED_KEY = 'pivella-webmcp-enabled';
export type WebMcpStatus = 'unsupported' | 'disabled' | 'starting' | 'active' | 'error';

export function useWebMcp(db: IndexedDBManager, ready: boolean, userId: string | null) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
  });
  const [status, setStatus] = useState<WebMcpStatus>(() => getModelContext() ? 'disabled' : 'unsupported');
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const active = useRef({ userId, enabled });
  active.current = { userId, enabled };
  const ds = useMemo(() => new BrowserDataSource(db, () => active.current.userId), [db]);
  const principal = useMemo(() => ({ kind: 'local' as const, writerId: db.writerId ?? 'webmcp' }), [db.writerId]);

  const reload = useCallback(async () => {
    const id = active.current.userId;
    if (!ready || !id) { setProposals([]); return; }
    try {
      const { items } = await ds.listProposals(principal, { userId: id });
      if (active.current.userId === id) setProposals(items);
    } catch (error) {
      if (active.current.userId === id) throw error;
    }
  }, [ds, principal, ready]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== ENABLED_KEY && event.key !== null) return;
      const value = event.newValue === 'true';
      active.current.enabled = value;
      setEnabled(value);
      setError(null);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  useEffect(() => {
    const refresh = () => { void reload().catch(err => setError(String(err))); };
    refresh();
    window.addEventListener('focus', refresh);
    // Aggiorna anche le proposte scadute con la pagina sempre aperta.
    const timer = setInterval(refresh, 60_000);
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer); };
  }, [reload, userId]);

  useEffect(() => {
    const model = getModelContext();
    if (!model) { setStatus('unsupported'); return; }
    if (!enabled || !ready || !userId) { setStatus('disabled'); return; }
    let disposed = false;
    const source = new BrowserDataSource(db, () => !disposed && active.current.enabled && active.current.userId === userId ? userId : null);
    setStatus('starting');
    setError(null);
    const registration = registerBrowserTools(model, { ds: source, principal, now: () => new Date(), client: 'WebMCP' }, async () => {
      // Una proposta già salvata resta riuscita anche se il refresh della UI fallisce.
      try { await reload(); } catch (err) { setError(String(err)); }
    });
    void registration.ready.then(() => { if (!disposed) setStatus('active'); }).catch(err => {
      if (!disposed) { setStatus('error'); setError(err instanceof Error ? err.message : String(err)); }
    });
    return () => { disposed = true; registration.cleanup(); };
  }, [db, ready, userId, enabled, principal, reload]);

  const toggle = useCallback((value: boolean) => {
    active.current.enabled = value;
    setEnabled(value);
    setError(null);
    try { localStorage.setItem(ENABLED_KEY, String(value)); } catch { /* Preferenza solo per questa sessione. */ }
  }, []);

  const decide = useCallback(async (id: string, decision: 'apply' | 'reject') => {
    const outcome = await ds.decideProposal(id, decision);
    setProposals(previous => previous.map(p => p.id === id ? outcome.proposal : p));
    try { await reload(); } catch (err) { setError(String(err)); }
    return outcome;
  }, [ds, reload]);

  return { enabled, status, error, toggle, proposals, decide };
}
