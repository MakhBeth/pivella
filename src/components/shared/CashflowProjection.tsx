import { SegmentedControl } from './SegmentedControl';
import { TrendingUp, LayoutDashboard } from './icons';
import type { CashflowRange } from '../../lib/utils/cashflow';
import { CashflowChart } from './CashflowChart';
import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { cashflowProjection } from '../../lib/utils/cashflow';
import { Currency } from '../ui/Currency';

export function CashflowProjection({ range, onExplore }: { range: CashflowRange; onExplore?: (month: string, view: 'transactions' | 'expected') => void }) {
  const { fatture, bankTransactions } = useApp();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const months = cashflowProjection(bankTransactions, fatture, range);
  const totals = months.reduce((a, r) => ({ actual: a.actual + r.incoming - r.outgoing, expected: a.expected + r.expected }), { actual: 0, expected: 0 });
  return <section className="card" aria-labelledby="cashflow-projection-title">
    <h2 id="cashflow-projection-title" className="card-title">Flussi e incassi previsti</h2>
    <p>Proiezione di tutti i conti: movimenti bancari effettivi più fatture ancora da incassare. Il netto non rappresenta il saldo del conto e non include uscite future.</p>
    <SegmentedControl label="Vista dei flussi" value={view} onChange={setView} options={[
      { value: 'chart', label: 'Grafico andamento', icon: <TrendingUp size={16} /> },
      { value: 'table', label: 'Tabella mensile', icon: <LayoutDashboard size={16} /> },
    ]} />
    <div className="grid-3">
      <div><h3>Flusso netto effettivo</h3><Currency amount={totals.actual / 100} /></div>
      <div><h3>Incassi previsti</h3><Currency amount={totals.expected / 100} /></div>
      <div><h3>Netto con incassi previsti</h3><Currency amount={(totals.actual + totals.expected) / 100} /></div>
    </div>
    {view === 'chart' ? <CashflowChart months={months} onExplore={onExplore} /> : months.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Mese</th><th>Entrate effettive</th><th>Uscite effettive</th><th>Incassi previsti</th><th>Netto previsto</th></tr></thead><tbody>{months.map(r => <tr key={r.month}><td>{r.month}</td><td><Currency amount={r.incoming / 100} /></td><td><Currency amount={r.outgoing / 100} /></td><td><Currency amount={r.expected / 100} /></td><td><Currency amount={(r.incoming - r.outgoing + r.expected) / 100} /></td></tr>)}</tbody></table></div> : <p>Nessun flusso datato nel periodo.</p>}

  </section>;
}
