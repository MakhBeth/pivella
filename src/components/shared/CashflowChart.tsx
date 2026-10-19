import { SegmentedControl } from './SegmentedControl';
import { Layers, Calendar } from './icons';
import { useState } from 'react';
import { dateIso, type CashflowMonth } from '../../lib/utils/cashflow';
import { Currency } from '../ui/Currency';

export function CashflowChart({ months, onExplore }: { months: CashflowMonth[]; onExplore?: (month: string, view: 'transactions' | 'expected') => void }) {
  const [active, setActive] = useState<number | null>(null);
  const [mode, setMode] = useState<'cumulative' | 'monthly'>('cumulative');
  let actual = 0, projected = 0;
  const points = months.map(m => {
    actual += m.incoming - m.outgoing; projected += m.incoming - m.outgoing + m.expected;
    return { ...m, actual: mode === 'cumulative' ? actual : m.incoming - m.outgoing, projected: mode === 'cumulative' ? projected : m.incoming - m.outgoing + m.expected };
  });
  if (!points.length) return <p>Nessun dato nell’intervallo.</p>;
  const min = Math.min(0, ...points.flatMap(p => [p.actual, p.projected]));
  const max = Math.max(100, ...points.flatMap(p => [p.actual, p.projected]));
  const x = (i: number) => 85 + (i + 1) * 760 / points.length;
  const y = (v: number) => 265 - (v - min) * 220 / (max - min || 1);
  const path = (key: 'actual' | 'projected') => `M85,${y(0)} ` + points.map((p, i) => `L${x(i)},${y(p[key])}`).join(' ');
  const today = dateIso(new Date());
  const todayIndex = points.findIndex(p => p.month === today.slice(0, 7));
  const todayX = todayIndex < 0 ? null : 85 + (todayIndex + Number(today.slice(-2)) / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) * 760 / points.length;
  const selected = active === null ? undefined : points[active];
  return <div>
    <SegmentedControl label="Tipo di andamento" value={mode} onChange={setMode} options={[
      { value: 'cumulative', label: 'Cumulato', icon: <Layers size={16} /> },
      { value: 'monthly', label: 'Mensile', icon: <Calendar size={16} /> },
    ]} />
    <p>{mode === 'cumulative' ? 'Andamento cumulato nel periodo, con partenza da zero.' : 'Flusso netto di ciascun mese.'} <span style={{ color: 'var(--accent-primary)' }}>Linea continua: flusso effettivo</span> · <span style={{ color: 'var(--accent-green)' }}>Linea tratteggiata: effettivo + incassi previsti</span>.</p>
    <svg viewBox="0 0 900 320" role="group" aria-label={`Andamento ${mode === 'cumulative' ? 'cumulato' : 'mensile'} dei flussi effettivi e previsti in euro`} style={{ width: '100%', minHeight: 220 }}>
      <title>Flusso netto cumulato: effettivo e con incassi previsti</title>
      {[0, 0.25, 0.5, 0.75, 1].map(t => { const value = min + (max - min) * t; return <g key={t}><line x1="85" x2="845" y1={y(value)} y2={y(value)} stroke="var(--border)" /><text x="77" y={y(value) + 4} textAnchor="end" fontSize="12" fill="var(--text-secondary)">{(value / 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €</text></g>; })}
      <line x1="85" x2="845" y1={y(0)} y2={y(0)} stroke="var(--text-muted)" />
      {todayX !== null && <g><line x1={todayX} x2={todayX} y1="30" y2="270" stroke="var(--text-secondary)" strokeDasharray="3 4" /><text x={todayX} y="22" textAnchor="middle" fontSize="12" fill="var(--text-primary)">Oggi</text></g>}
      <path d={path('projected')} fill="none" stroke="var(--accent-green)" strokeWidth="3" strokeDasharray="7 5" />
      <path d={path('actual')} fill="none" stroke="var(--accent-primary)" strokeWidth="2" />
      {points.map((p, i) => <g key={p.month}>
        {(i % Math.max(1, Math.ceil(points.length / 8)) === 0 || i === points.length - 1) && <text x={x(i)} y="294" textAnchor="middle" fontSize="12" fill="var(--text-secondary)">{p.month}</text>}
        <circle cx={x(i)} cy={y(p.projected)} r={active === i ? 6 : 4} fill="var(--accent-green)" tabIndex={0} role="button" aria-label={`${p.month}: netto ${mode === 'cumulative' ? 'cumulato' : 'mensile'} ${(p.projected / 100).toFixed(2)} euro`} onFocus={() => setActive(i)} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i); } }}><title>{p.month}: {(p.projected / 100).toFixed(2)} €</title></circle>
      </g>)}
    </svg>
    {selected && onExplore && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn" onClick={() => onExplore(selected.month, 'transactions')}>Vedi movimenti di {selected.month}</button><button className="btn" onClick={() => onExplore(selected.month, 'expected')}>Vedi incassi attesi di {selected.month}</button></div>}
    <div aria-live="polite">{selected ? <p>{selected.month} · Effettivo {mode === 'cumulative' ? 'cumulato' : 'mensile'}: <Currency amount={selected.actual / 100} /> · Con previsioni: <Currency amount={selected.projected / 100} /> · Incassi attesi nel mese: <Currency amount={selected.expected / 100} /></p> : <p className="stat-label">Seleziona un punto per i dettagli, oppure usa la vista tabella.</p>}</div>
  </div>;
}
