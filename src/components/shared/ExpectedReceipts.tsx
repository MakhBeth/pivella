import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { remainingCents, receivedCents } from '../../lib/utils/receipts';
import { dateIso, expectedReceipts, inCashflowRange, type CashflowRange } from '../../lib/utils/cashflow';
import { Currency } from '../ui/Currency';

export function ExpectedReceipts({ range }: { range: CashflowRange }) {
  const { fatture, updateFattura } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const todayIso = dateIso(new Date());
  const allPending = expectedReceipts(fatture).filter(f => !f.dataIncassoPrevista || inCashflowRange(f.dataIncassoPrevista, range));
  const pending = allPending.filter(f =>
    (status === 'all' || (status === 'undated' ? !f.dataIncassoPrevista : status === 'late' ? !!f.dataIncassoPrevista && f.dataIncassoPrevista < todayIso : !!f.dataIncassoPrevista && f.dataIncassoPrevista >= todayIso))
    && `${f.numero || ''} ${f.clienteNome}`.toLowerCase().includes(query.trim().toLowerCase())
  ).sort((a, b) => (a.dataIncassoPrevista || '9999').localeCompare(b.dataIncassoPrevista || '9999'));
  return <section className="card" aria-label="Incassi attesi">
    <h2 className="card-title">Incassi attesi</h2>
    <div className="cashflow-toolbar">
      <label>Cerca fattura o cliente<input className="input-field" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Stato previsione<select className="input-field" value={status} onChange={e => setStatus(e.target.value)}><option value="all">Tutti</option><option value="late">Previsione superata</option><option value="upcoming">Prossimi incassi</option><option value="undated">Senza data</option></select></label>
    </div>
    <h3>Residui da incassare · periodo selezionato e senza data</h3>
    <p className="stat-label">La data prevista serve solo alla proiezione. Gli incassi con data prevista trascorsa restano nel mese indicato: aggiorna la previsione se il pagamento è in ritardo. Le fatture senza data restano escluse dai totali mensili.</p>
    <p>Senza data prevista: <Currency amount={pending.filter(f => !f.dataIncassoPrevista).reduce((sum, f) => sum + remainingCents(f) / 100, 0)} /></p>
    {error && <p role="alert">{error}</p>}
    {!pending.length ? <p>Nessuna fattura in attesa di incasso.</p> : <div className="table-wrapper"><table className="table"><thead><tr><th>Fattura</th><th>Cliente</th><th>Incassato EUR</th><th>Residuo EUR</th><th>Data prevista</th><th>Stato</th></tr></thead><tbody>{pending.map(f => <tr key={f.id}><td>{f.numero || 'Senza numero'} · {f.data}</td><td>{f.clienteNome}</td><td><Currency amount={receivedCents(f) / 100} /></td><td><Currency amount={remainingCents(f) / 100} /></td><td><input type="date" className="input-field" aria-label={`Data prevista fattura ${f.numero || f.id}`} disabled={busy} value={f.dataIncassoPrevista ?? ''} onChange={async e => {
      const value = e.target.value;
      setBusy(true); setError('');
      try { await updateFattura({ ...f, dataIncassoPrevista: value || undefined }); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} /></td><td>{!f.dataIncassoPrevista ? 'Da pianificare' : f.dataIncassoPrevista < todayIso ? 'Previsione superata' : 'Atteso'}</td></tr>)}</tbody></table></div>}
  </section>;
}
