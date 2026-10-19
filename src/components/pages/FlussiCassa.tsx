import { SegmentedControl } from '../shared/SegmentedControl';
import { LayoutDashboard, Wallet, CalendarClock } from '../shared/icons';
import '../shared/cashflow.css';
import { ExpectedReceipts } from '../shared/ExpectedReceipts';
import { invoiceReceipts } from '../../lib/utils/receipts';
import { cashflowPreset, inCashflowRange } from '../../lib/utils/cashflow';
import { CashflowProjection } from '../shared/CashflowProjection';
import { BankInvoiceLink } from '../shared/BankInvoiceLink';
import { useMemo, useState } from 'react';
import type { BankCsvFormat } from '../../types';
import { useApp } from '../../context/AppContext';
import { csvHeaders, previewBankCsv, validateBankFormat } from '../../lib/utils/bankCsv';
import { Currency } from '../ui/Currency';

const fieldStyle = { display: 'grid', gap: 6 };
const actionsStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' };
const newFormat = (userId: string): BankCsvFormat => ({
  id: crypto.randomUUID(), userId, name: '', delimiter: ';', encoding: 'utf-8', headerRow: 1,
  dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', amountMode: 'signed', columns: { date: '', description: '', amount: '' },
});
interface CsvFile { name: string; bytes: ArrayBuffer }
async function readFile(file: File): Promise<CsvFile> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Il file supera il limite di 10 MB.');
  return { name: file.name, bytes: await file.arrayBuffer() };
}

export function FlussiCassa() {
  const { currentUserId, fatture, bankFormats, bankTransactions, saveBankFormat, removeBankFormat, importBankTransactions, removeBankTransaction, showToast } = useApp();
  const [view, setView] = useState<'overview' | 'transactions' | 'expected' | 'import'>('overview');
  const [manageFormats, setManageFormats] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [draft, setDraft] = useState<BankCsvFormat | null>(null);
  const [sample, setSample] = useState<CsvFile | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [file, setFile] = useState<CsvFile | null>(null);
  const [account, setAccount] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [range, setRange] = useState(() => cashflowPreset('both'));
  const invalidRange = !!range.from && !!range.to && range.from > range.to;
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const selected = bankFormats.find(f => f.id === selectedId);
  const accounts = [...new Set(bankTransactions.map(t => t.account))].sort();
  const sampleInfo = useMemo(() => {
    if (!draft || !sample) return { headers: [] as string[], error: '' };
    try { return { headers: csvHeaders(new TextDecoder(draft.encoding, { fatal: true }).decode(sample.bytes), draft), error: '' }; }
    catch (e) { return { headers: [] as string[], error: (e as Error).message }; }
  }, [draft, sample]);
  const preview = useMemo(() => {
    if (!file || !selected || !account.trim()) return null;
    try { return previewBankCsv(new TextDecoder(selected.encoding, { fatal: true }).decode(file.bytes), selected, account, file.name); }
    catch (e) { return { rows: [], errors: [(e as Error).message] }; }
  }, [file, selected, account]);
  const existingKeys = new Set(bankTransactions.map(t => t.importKey));
  const duplicateCount = preview?.rows.filter(r => existingKeys.has(r.importKey)).length ?? 0;
  const allocations = useMemo(() => {
    const totals = new Map<string, number>();
    for (const f of fatture) for (const r of invoiceReceipts(f)) if (r.bankTransactionId) totals.set(r.bankTransactionId, (totals.get(r.bankTransactionId) ?? 0) + r.amountCents);
    return totals;
  }, [fatture]);
  const reconciliation = (t: typeof bankTransactions[number]) => t.amountCents <= 0 ? 'outgoing' : (allocations.get(t.id) ?? 0) === 0 ? 'unmatched' : (allocations.get(t.id) ?? 0) < t.amountCents ? 'partial' : 'matched';
  const periodTransactions = bankTransactions.filter(t => !invalidRange && inCashflowRange(t.date, range));
  const attention = periodTransactions.filter(t => ['unmatched', 'partial'].includes(reconciliation(t))).length;
  const filtered = periodTransactions.filter(t => (!filterAccount || t.account === filterAccount)
    && (status === 'all' || (status === 'attention' ? ['unmatched', 'partial'].includes(reconciliation(t)) : reconciliation(t) === status))
    && `${t.description} ${t.reference ?? ''} ${t.sourceFile}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
  const incoming = filtered.reduce((sum, t) => sum + Math.max(0, t.amountCents), 0);
  const outgoing = filtered.reduce((sum, t) => sum + Math.max(0, -t.amountCents), 0);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const updateDraft = (patch: Partial<BankCsvFormat>) => setDraft(prev => prev ? { ...prev, ...patch } : prev);
  const columnField = (key: keyof BankCsvFormat['columns'], label: string, required = false) => draft && (
    <label style={fieldStyle} key={key}>{label}{required ? ' *' : ''}
      {sampleInfo.headers.length ? <select className="input-field" value={draft.columns[key] ?? ''} onChange={e => updateDraft({ columns: { ...draft.columns, [key]: e.target.value } })} required={required}>
        <option value="">Scegli colonna</option>
        {draft.columns[key] && !sampleInfo.headers.includes(draft.columns[key]!) && <option value={draft.columns[key]}>{draft.columns[key]} (assente)</option>}
        {sampleInfo.headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select> : <input className="input-field" value={draft.columns[key] ?? ''} placeholder="Intestazione esatta nel CSV" onChange={e => updateDraft({ columns: { ...draft.columns, [key]: e.target.value } })} required={required} />}
    </label>
  );

  return <>
    <div className="page-header"><h1 className="page-title">Flussi di cassa</h1><p className="page-subtitle">Controlla i flussi, pianifica gli incassi e riconcilia i movimenti.</p><button className="btn btn-primary" onClick={() => setView(view === 'import' ? 'overview' : 'import')}>{view === 'import' ? 'Torna alla panoramica' : 'Importa CSV'}</button></div>
    {error && <div className="card" role="alert" style={{ color: 'var(--accent-red)' }}>{error}</div>}
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <SegmentedControl label="Viste flussi di cassa" value={view} onChange={setView} options={[
        { value: 'overview', label: 'Panoramica', icon: <LayoutDashboard size={16} /> },
        { value: 'transactions', label: <>Movimenti{attention > 0 && <span className="segmented-control-count" aria-label={`${attention} entrate da verificare`}>{attention}</span>}</>, icon: <Wallet size={16} /> },
        { value: 'expected', label: 'Incassi attesi', icon: <CalendarClock size={16} /> },
      ]} />
      {view !== 'import' && <section className="card cashflow-filters" aria-labelledby="cashflow-filters-title">
        <h2 id="cashflow-filters-title" className="card-title">Filtri</h2>
        <div className="cashflow-filter-dates">
          <label>Dal<input type="date" className="input-field" min="1900-01-01" max="2100-12-31" value={range.from} onChange={e => { setRange(r => ({ ...r, from: e.target.value })); setPage(0); }} /></label>
          <label>Al<input type="date" className="input-field" min="1900-01-01" max="2100-12-31" value={range.to} onChange={e => { setRange(r => ({ ...r, to: e.target.value })); setPage(0); }} /></label>
        </div>
        <div className="cashflow-filter-presets">
          <span className="stat-label">Periodi rapidi</span>
          <SegmentedControl label="Periodi rapidi" value={!range.from && !range.to ? 'all' : (['past', 'future', 'both'] as const).find(p => { const preset = cashflowPreset(p); return preset.from === range.from && preset.to === range.to; }) ?? 'custom'} onChange={preset => {
            if (preset === 'custom') return;
            setRange(preset === 'all' ? { from: '', to: '' } : cashflowPreset(preset)); setPage(0);
          }} options={[
            { value: 'past', label: 'Ultimo anno' },
            { value: 'future', label: 'Prossimo anno' },
            { value: 'both', label: '−1 / +1 anno' },
            { value: 'all', label: 'Tutte le date' },
          ]} />
        </div>
        <p className="stat-label cashflow-filter-hint">Date incluse. Il periodo si applica a tutte le viste dei flussi.</p>
        {invalidRange && <p role="alert">La data “Dal” deve precedere o coincidere con “Al”.</p>}
      </section>}
      {view === 'overview' && !invalidRange && <>
        {attention > 0 && <button className="btn" style={{ marginBottom: 16 }} onClick={() => { setView('transactions'); setStatus('attention'); setQuery(''); setFilterAccount(''); setPage(0); }}>{attention} entrate da riconciliare nel periodo →</button>}
        <CashflowProjection range={range} onExplore={(month, target) => {
          const [year, m] = month.split('-').map(Number);
          const first = `${month}-01`, last = `${month}-${new Date(year, m, 0).getDate()}`;
          setRange({ from: range.from && range.from > first ? range.from : first, to: range.to && range.to < last ? range.to : last });
          setView(target); setQuery(''); setStatus('all'); setFilterAccount(''); setPage(0);
        }} />
      </>}
      {view === 'expected' && !invalidRange && <ExpectedReceipts range={range} />}
      {view === 'import' && <>
        <div className="cashflow-toolbar" style={{ marginBottom: 16 }}><h2>Importa movimenti bancari</h2><button className="btn" aria-expanded={manageFormats} onClick={() => setManageFormats(!manageFormats)}>{manageFormats ? 'Chiudi gestione formati' : 'Gestisci formati CSV'}</button></div>
        {!bankFormats.length && <div className="card"><p>Per iniziare, definisci come leggere le colonne del CSV della tua banca.</p><button className="btn btn-primary" onClick={() => { setManageFormats(true); if (currentUserId) setDraft(newFormat(currentUserId)); }}>Crea il primo formato</button></div>}
      {manageFormats && <>
      <section className="card" aria-labelledby="bank-formats-title">
        <div style={{ ...actionsStyle, justifyContent: 'space-between' }}><h2 id="bank-formats-title" className="card-title">Formati dei documenti CSV</h2>
          <button className="btn btn-primary" onClick={() => { if (currentUserId) { setDraft(newFormat(currentUserId)); setSample(null); setError(''); } }}>Nuovo formato</button></div>
        <p>Salva una definizione per ogni tracciato della banca. Potrai riutilizzarla a ogni importazione.</p>
        {!bankFormats.length && <p className="stat-label">Nessun formato salvato. Crea il primo usando un CSV di esempio.</p>}
        {bankFormats.map(f => <div key={f.id} style={{ ...actionsStyle, justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <span><strong>{f.name}</strong> · {f.amountMode === 'signed' ? 'Importo con segno' : 'Entrate e uscite separate'}</span>
          <div style={actionsStyle}><button className="btn btn-ghost" aria-label={`Modifica formato ${f.name}`} onClick={() => { setDraft({ ...f, columns: { ...f.columns } }); setSample(null); setError(''); }}>Modifica</button>
            <button className="btn btn-ghost" aria-label={`Elimina formato ${f.name}`} onClick={() => setDeleteId(f.id)}>Elimina</button>
            {deleteId === f.id && <><span>Eliminare il formato? I movimenti restano.</span><button className="btn" onClick={() => void run(async () => { await removeBankFormat(f.id); setDeleteId(null); if (draft?.id === f.id) setDraft(null); })}>Conferma eliminazione</button><button className="btn" onClick={() => setDeleteId(null)}>Annulla</button></>}
          </div>
        </div>)}
      </section>

      {draft && <form className="card" onSubmit={e => { e.preventDefault(); void run(async () => {
        validateBankFormat(draft);
        if (sample) {
          const headers = csvHeaders(new TextDecoder(draft.encoding, { fatal: true }).decode(sample.bytes), draft);
          const columns = [draft.columns.date, draft.columns.description, draft.columns.valueDate, draft.columns.reference, ...(draft.amountMode === 'signed' ? [draft.columns.amount] : [draft.columns.credit, draft.columns.debit])].filter(Boolean);
          if (columns.some(c => !headers.includes(c!))) throw new Error('Una colonna mappata è assente nel CSV di esempio.');
        }
        await saveBankFormat({ ...draft, name: draft.name.trim() }); setSelectedId(draft.id); setDraft(null); setManageFormats(false); showToast('Formato CSV salvato.');
      }); }}>
        <h2 className="card-title">Definizione del formato</h2>
        <div className="grid-2">
          <label style={fieldStyle}>Nome del formato *<input className="input-field" value={draft.name} onChange={e => updateDraft({ name: e.target.value })} required placeholder="Es. Banca — esportazione movimenti" /></label>
          <label style={fieldStyle}>CSV di esempio<input type="file" accept=".csv,text/csv,text/plain" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(async () => { setSample(null); setSample(await readFile(f)); }); }} /></label>
          <label style={fieldStyle}>Separatore<select className="input-field" value={draft.delimiter} onChange={e => updateDraft({ delimiter: e.target.value as BankCsvFormat['delimiter'] })}><option value=";">Punto e virgola (;)</option><option value=",">Virgola (,)</option><option value={'\t'}>Tabulazione</option><option value="|">Barra verticale (|)</option></select></label>
          <label style={fieldStyle}>Codifica<select className="input-field" value={draft.encoding} onChange={e => updateDraft({ encoding: e.target.value as BankCsvFormat['encoding'] })}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option></select></label>
          <label style={fieldStyle}>Riga delle intestazioni<input className="input-field" type="number" min="1" step="1" required value={draft.headerRow} onChange={e => updateDraft({ headerRow: Number(e.target.value) })} /></label>
          <label style={fieldStyle}>Formato delle date<select className="input-field" value={draft.dateFormat} onChange={e => updateDraft({ dateFormat: e.target.value as BankCsvFormat['dateFormat'] })}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></label>
          <label style={fieldStyle}>Separatore decimale<select className="input-field" value={draft.decimalSeparator} onChange={e => updateDraft({ decimalSeparator: e.target.value as ',' | '.' })}><option value=",">Virgola — 1.234,56</option><option value=".">Punto — 1,234.56</option></select></label>
          <label style={fieldStyle}>Colonne degli importi<select className="input-field" value={draft.amountMode} onChange={e => updateDraft({ amountMode: e.target.value as 'signed' | 'split' })}><option value="signed">Importo con segno (+ entrata, − uscita)</option><option value="split">Entrate / uscite separate, valori positivi</option></select></label>
        </div>
        {sampleInfo.error && <p role="alert" style={{ color: 'var(--accent-red)' }}>{sampleInfo.error}</p>}
        <h3>Mappatura dei campi</h3><p className="stat-label">Carica un esempio per scegliere le colonne, oppure inserisci le intestazioni esatte. * Campo obbligatorio.</p>
        <div className="grid-2">{columnField('date', 'Data movimento', true)}{columnField('description', 'Descrizione', true)}
          {draft.amountMode === 'signed' ? columnField('amount', 'Importo', true) : <>{columnField('credit', 'Entrate', true)}{columnField('debit', 'Uscite', true)}</>}
          {columnField('valueDate', 'Data valuta')}{columnField('reference', 'ID / riferimento univoco della banca')}
        </div>
        <div style={{ ...actionsStyle, marginTop: 20 }}><button type="submit" className="btn btn-primary" disabled={!!sampleInfo.error}>Salva formato</button><button type="button" className="btn" onClick={() => setDraft(null)}>Annulla</button></div>
      </form>}

      </>}
      <section className="card" aria-labelledby="bank-import-title"><h2 id="bank-import-title" className="card-title">Importa movimenti</h2>
        <div className="grid-2">
          <label style={fieldStyle}>Formato del documento<select className="input-field" value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">Scegli un formato salvato</option>{bankFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label style={fieldStyle}>Conto corrente<input className="input-field" list="bank-accounts" value={account} onChange={e => setAccount(e.target.value)} placeholder="Es. Conto principale o IBAN" /><datalist id="bank-accounts">{accounts.map(a => <option key={a} value={a} />)}</datalist></label>
          <label style={fieldStyle}>Documento CSV (massimo 10 MB)<input type="file" accept=".csv,text/csv,text/plain" disabled={!selected} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(async () => { setFile(null); setFile(await readFile(f)); }); }} /></label>
        </div>
        <p className="stat-label">Usa sempre lo stesso nome per lo stesso conto. I movimenti già importati vengono saltati. Mappa il riferimento univoco della banca per riconoscerli con maggiore precisione; senza riferimento il confronto usa data, descrizione, importo, valuta e numero di occorrenze identiche.</p>
        {preview && <>
          <h3>Anteprima · {file?.name}</h3>
          {preview.errors.length > 0 && <div role="alert" style={{ color: 'var(--accent-red)' }}><p>Importazione bloccata: correggi il file o la definizione del formato ({preview.errors.length} errori).</p><ul>{preview.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>{preview.errors.length > 20 && <p>Mostrati i primi 20 errori.</p>}</div>}
          <p>{preview.rows.length} movimenti validi · {duplicateCount} già importati · {preview.rows.length - duplicateCount} nuovi</p>
          <div className="table-wrapper"><table className="table"><thead><tr><th>Data</th><th>Descrizione</th><th>Importo</th><th>Stato</th></tr></thead><tbody>{preview.rows.slice(0, 20).map((t, i) => <tr key={i}><td>{t.date}</td><td style={{ whiteSpace: 'pre-wrap' }}>{t.description}</td><td><Currency amount={t.amountCents / 100} /></td><td>{existingKeys.has(t.importKey) ? 'Già importato' : 'Nuovo'}</td></tr>)}</tbody></table></div>
          {preview.rows.length > 20 && <p className="stat-label">Anteprima dei primi 20 movimenti.</p>}
          <button className="btn btn-primary" disabled={preview.errors.length > 0 || preview.rows.length === duplicateCount} onClick={() => void run(async () => { const result = await importBankTransactions(preview.rows); setFile(null); setView('transactions'); setRange({ from: '', to: '' }); setFilterAccount(account.trim()); setStatus('all'); setQuery(''); setPage(0); showToast(`${result.imported} movimenti importati, ${result.skipped} già presenti.`); })}>Conferma importazione</button>
        </>}
      </section>

      </>}
      {view === 'transactions' && <section aria-labelledby="bank-transactions-title"><h2 id="bank-transactions-title">Movimenti importati</h2>
        <div className="card"><div className="cashflow-toolbar">
          <label>Cerca movimenti<input className="input-field" placeholder="Descrizione, riferimento o documento" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
          <label>Conto dei movimenti<select className="input-field" value={filterAccount} onChange={e => { setFilterAccount(e.target.value); setPage(0); }}><option value="">Tutti i conti</option>{accounts.map(a => <option key={a}>{a}</option>)}</select></label>
          <label>Stato riconciliazione<select className="input-field" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="all">Tutti i movimenti</option><option value="attention">Da verificare</option><option value="unmatched">Da riconciliare</option><option value="partial">Parzialmente attribuiti</option><option value="matched">Riconciliati</option><option value="outgoing">Uscite</option></select></label>
          <button className="btn" onClick={() => { setFilterAccount(''); setStatus('all'); setQuery(''); setPage(0); }}>Azzera ricerca e filtri</button>
        </div><p className="stat-label">Conto, ricerca e stato filtrano solo i movimenti. Panoramica e incassi attesi includono tutti i conti.</p></div>
        <div className="grid-3">{[['Entrate', incoming], ['Uscite', outgoing], ['Flusso netto', incoming - outgoing]].map(([label, amount]) => <div className="card" key={label}><h3 className="card-title">{label}</h3><div className="stat-value"><Currency amount={Number(amount) / 100} /></div></div>)}</div>
        <p className="stat-label">Totali dei movimenti filtrati. Il flusso netto non è il saldo del conto. Le importazioni bancarie non modificano automaticamente gli incassi delle fatture.</p>
        <div className="card">{!filtered.length ? <p>Nessun movimento corrisponde ai filtri. Prova ad ampliare il periodo o azzerare ricerca e filtri.</p> : <>
          <div className="table-wrapper"><table className="table"><thead><tr><th>Data</th><th>Valuta</th><th>Conto</th><th>Descrizione</th><th>Importo</th><th>Documento</th><th>Riconciliazione</th><th>Azioni</th></tr></thead><tbody>{filtered.slice(safePage * 50, (safePage + 1) * 50).map(t => <tr key={t.id}><td>{t.date}</td><td>{t.valueDate ?? '—'}</td><td>{t.account}</td><td style={{ whiteSpace: 'pre-wrap' }}>{t.description}{t.reference && <div className="stat-label">{t.reference}</div>}</td><td style={{ color: t.amountCents > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}><Currency amount={t.amountCents / 100} /></td><td>{t.sourceFile}</td><td><span className="cashflow-badge">{{ unmatched: 'Da riconciliare', partial: 'Parzialmente attribuito', matched: 'Riconciliato', outgoing: 'Uscita' }[reconciliation(t)]}</span><BankInvoiceLink transaction={t} /></td><td>{deleteId === t.id ? <><button className="btn" onClick={() => void run(async () => { await removeBankTransaction(t.id); setDeleteId(null); })}>Conferma eliminazione</button><button className="btn" onClick={() => setDeleteId(null)}>Annulla</button></> : <button className="btn btn-ghost" aria-label={`Elimina movimento ${t.description} del ${t.date}`} onClick={() => setDeleteId(t.id)}>Elimina</button>}</td></tr>)}</tbody></table></div>
          <div style={actionsStyle}><button className="btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Precedente</button><span>{filtered.length} movimenti · Pagina {safePage + 1} di {Math.ceil(filtered.length / 50)}</span><button className="btn" disabled={(safePage + 1) * 50 >= filtered.length} onClick={() => setPage(safePage + 1)}>Successiva</button></div>
        </>}</div>
      </section>}
    </fieldset>
  </>;
}
