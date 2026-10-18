import { useId } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useState } from 'react';
import type { BankTransaction } from '../../types';
import { useApp } from '../../context/AppContext';
import { invoiceReceipts, remainingCents } from '../../lib/utils/receipts';
import { Currency } from '../ui/Currency';

export function BankInvoiceLink({ transaction }: { transaction: BankTransaction }) {
  const { fatture, allocateBankInvoice } = useApp();
  const titleId = useId();
  const [discard, setDiscard] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [initial, setInitial] = useState('');
  const requestClose = () => { if (busy) return; if (JSON.stringify(amounts) !== initial) setDiscard(true); else setEditing(false); };
  const { dialogRef, handleClick, handleMouseDown } = useDialog(editing, requestClose);
  const allocatedTo = (id: string) => invoiceReceipts(fatture.find(f => f.id === id)!).filter(r => r.bankTransactionId === transaction.id).reduce((s, r) => s + r.amountCents, 0);
  const linked = fatture.filter(f => allocatedTo(f.id) > 0);
  const allocated = linked.reduce((sum, f) => sum + allocatedTo(f.id), 0);
  const candidates = fatture.filter(f => remainingCents(f) > 0 || allocatedTo(f.id) > 0).sort((a, b) => a.data.localeCompare(b.data));
  const parse = (value: string) => /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value.trim().replace(',', '.')) * 100) : NaN;
  const entries = Object.entries(amounts).filter(([, value]) => value.trim() !== '');
  const total = entries.reduce((sum, [, value]) => sum + parse(value), 0);
  const available = transaction.amountCents - (Number.isFinite(total) ? total : 0);
  const suggestion = (f: typeof fatture[number]) => {
    const text = `${transaction.description} ${transaction.reference ?? ''}`.toLowerCase();
    return f.clienteNome.length > 2 && text.includes(f.clienteNome.toLowerCase()) ? 'Cliente nella descrizione' : remainingCents(f) + allocatedTo(f.id) === transaction.amountCents ? 'Importo corrispondente' : '';
  };
  const visible = candidates.filter(f => `${f.numero || ''} ${f.clienteNome}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(!!suggestion(b)) - Number(!!suggestion(a)));
  const quickFill = (id: string, residual: number, cover: boolean) => {
    const current = amounts[id] ? parse(amounts[id]) : 0;
    const capacity = Math.max(0, available + (Number.isFinite(current) ? current : 0));
    const cents = cover ? residual : Math.min(residual, capacity);
    setAmounts(prev => ({ ...prev, [id]: cents > 0 ? (cents / 100).toFixed(2) : '' }));
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      await allocateBankInvoice(transaction.id, entries.map(([invoiceId, value]) => ({ invoiceId, amountCents: parse(value) })));
      setEditing(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (transaction.amountCents <= 0) return <>—</>;
  return <div style={{ minWidth: 160 }}>
    <div className="stat-label">{linked.length} fatture · da attribuire <Currency amount={(transaction.amountCents - allocated) / 100} /></div>
    <button className="btn btn-ghost" aria-haspopup="dialog" onClick={() => {
      const values = Object.fromEntries(linked.map(f => [f.id, (allocatedTo(f.id) / 100).toFixed(2)]));
      setAmounts(values); setInitial(JSON.stringify(values)); setDiscard(false);
      setError(''); setSearch(''); setEditing(true);
    }}>{linked.length ? 'Modifica ripartizione' : 'Riconcilia'}</button>
    <dialog ref={dialogRef} className="cashflow-drawer" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); requestClose(); }} onClose={() => setEditing(false)} onClick={handleClick} onMouseDown={handleMouseDown}>
      <header className="cashflow-drawer-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><h2 id={titleId}>Riconcilia entrata</h2><button className="btn" aria-label="Chiudi riconciliazione" disabled={busy} onClick={requestClose}>Chiudi</button></div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{transaction.description}</p><p className="stat-label">{transaction.date} · {transaction.account} · {transaction.sourceFile}</p>
        <div className="cashflow-summary"><div>Movimento<br /><strong><Currency amount={transaction.amountCents / 100} /></strong></div><div>Attribuito<br /><strong>{Number.isFinite(total) ? <Currency amount={total / 100} /> : 'Importo non valido'}</strong></div><div>Da attribuire<br /><strong>{Number.isFinite(total) ? <Currency amount={available / 100} /> : '—'}</strong></div></div>
      </header>
      <div className="cashflow-drawer-body">
        <p>Assegna le quote alle fatture. I suggerimenti non vengono applicati automaticamente.</p>
        <label>Cerca fattura o cliente<input className="input-field" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} /></label>
        {!visible.length && <p>Nessuna fattura disponibile per questa ricerca.</p>}
        {visible.map(f => {
          const residual = remainingCents(f) + allocatedTo(f.id);
          const current = amounts[f.id] ? parse(amounts[f.id]) : 0;
          return <div key={f.id} className="cashflow-quota">
            <strong>{f.numero || 'Senza numero'} · {f.clienteNome}</strong><div className="stat-label">Emessa il {f.data} · Residuo disponibile <Currency amount={residual / 100} /></div>
            {suggestion(f) && <span className="cashflow-badge">Suggerita: {suggestion(f)}</span>}
            <input className="input-field" aria-label={`Quota fattura ${f.numero || f.id}`} disabled={busy} inputMode="decimal" placeholder="Quota in euro" value={amounts[f.id] ?? ''} onChange={e => setAmounts(prev => ({ ...prev, [f.id]: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" disabled={busy || !Number.isFinite(total) || residual > available + current} onClick={() => quickFill(f.id, residual, true)}>Copri il residuo</button>
              <button className="btn" disabled={busy || !Number.isFinite(total) || available <= 0} onClick={() => quickFill(f.id, residual, false)}>Attribuisci il disponibile</button>
              {!!amounts[f.id] && <button className="btn btn-ghost" disabled={busy} onClick={() => setAmounts(prev => ({ ...prev, [f.id]: '' }))}>Rimuovi quota</button>}
            </div>
            {Number.isFinite(current) && current > residual && <p role="alert">La quota supera il residuo della fattura.</p>}
          </div>;
        })}
      </div>
      <footer className="cashflow-drawer-footer">
        <p className="stat-label">Confermando registri gli incassi al {transaction.date}. Ridurre una quota riapre il residuo. Puoi lasciare una parte non attribuita.</p>
        {error && <p role="alert">{error}</p>}
        {Number.isFinite(total) && total > transaction.amountCents && <p role="alert">Le quote superano l’importo del movimento.</p>}
        {discard ? <div role="alert"><p>Vuoi chiudere senza salvare le modifiche?</p><button className="btn" onClick={() => { setDiscard(false); setEditing(false); }}>Scarta modifiche</button><button className="btn" onClick={() => setDiscard(false)}>Continua a modificare</button></div> : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy || !Number.isSafeInteger(total) || total > transaction.amountCents || entries.some(([id, value]) => parse(value) <= 0 || parse(value) > remainingCents(fatture.find(f => f.id === id)!) + allocatedTo(id))} onClick={() => void save()}>{busy ? 'Salvataggio…' : 'Conferma ripartizione e incassi'}</button>
          <button className="btn" disabled={busy} onClick={requestClose}>Annulla</button>
        </div>}
      </footer>
    </dialog>
  </div>;
}
