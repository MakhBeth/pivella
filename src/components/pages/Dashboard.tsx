import { useState } from 'react';
import { Users, Clock, AlertTriangle } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import { LIMITE_FATTURATO, MAX_HISTORICAL_YEARS } from '../../lib/constants/fiscali';
import { calcolaFiscale } from '../../lib/utils/calculations';
import { calcolaContributiPrevidenziali, calcolaCoefficienteMedioAteco, getAliquotaImpostaSostitutiva, getInpsCalculationInput, getRegimeThresholdStatus } from '../../lib/utils/forfettario';
import { Currency } from '../ui/Currency';

// Accessible patterns for colorblind users
const PATTERNS = [
  { id: 'pattern-solid', type: 'solid' },
  { id: 'pattern-stripes', type: 'stripes' },
  { id: 'pattern-dots', type: 'dots' },
  { id: 'pattern-crosshatch', type: 'crosshatch' },
  { id: 'pattern-diagonal', type: 'diagonal' },
];

function PatternDefs() {
  return (
    <defs>
      {/* Stripes pattern */}
      <pattern id="pattern-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.4)" strokeWidth="3" />
      </pattern>
      {/* Dots pattern */}
      <pattern id="pattern-dots" patternUnits="userSpaceOnUse" width="6" height="6">
        <circle cx="3" cy="3" r="1.5" fill="rgba(255,255,255,0.5)" />
      </pattern>
      {/* Crosshatch pattern */}
      <pattern id="pattern-crosshatch" patternUnits="userSpaceOnUse" width="8" height="8">
        <path d="M0,0 l8,8 M8,0 l-8,8" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      </pattern>
      {/* Diagonal lines */}
      <pattern id="pattern-diagonal" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
      </pattern>
    </defs>
  );
}

// Donut Chart SVG Component with accessible patterns
function DonutChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const filteredData = data.filter(d => d.value > 0);
  const size = 160;
  const strokeWidth = 32;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;

  // Calculate arc paths for each segment
  const segments: { startAngle: number; endAngle: number; color: string; patternId: string }[] = [];
  let currentAngle = -90; // Start from top
  filteredData.forEach((d, i) => {
    const angle = (d.value / total) * 360;
    segments.push({
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
      color: d.color,
      patternId: PATTERNS[i % PATTERNS.length].id,
    });
    currentAngle += angle;
  });

  // Convert angle to SVG arc path
  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  const describeArc = (startAngle: number, endAngle: number) => {
    const start = polarToCartesian(endAngle);
    const end = polarToCartesian(startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, minHeight: 200 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Fatturato per cliente">
        <PatternDefs />
        {segments.map((seg, i) => {
          const isHovered = hoveredIndex === i;
          return (
            <g key={i}>
              {/* Base color arc */}
              <path
                d={describeArc(seg.startAngle, seg.endAngle)}
                fill="none"
                stroke={seg.color}
                strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                strokeLinecap="butt"
                style={{ transition: 'stroke-width 0.15s', cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
              {/* Pattern overlay (skip for first/solid) */}
              {i > 0 && (
                <path
                  d={describeArc(seg.startAngle, seg.endAngle)}
                  fill="none"
                  stroke={`url(#${seg.patternId})`}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeLinecap="butt"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filteredData.map((segment, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 8px',
              borderRadius: 6,
              background: hoveredIndex === i ? 'var(--bg-secondary)' : 'transparent',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <svg width="16" height="16" style={{ flexShrink: 0 }}>
              <PatternDefs />
              <rect width="16" height="16" rx="3" fill={segment.color} />
              {i > 0 && <rect width="16" height="16" rx="3" fill={`url(#${PATTERNS[i % PATTERNS.length].id})`} />}
            </svg>
            <span style={{ fontSize: '0.8rem', color: hoveredIndex === i ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {segment.name.length > 20 ? segment.name.slice(0, 18) + '...' : segment.name} ({((segment.value / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Vertical Bar Chart SVG Component
function VerticalBarChart({ data }: { data: { mese: string; totale: number }[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const maxValue = Math.max(...data.map(d => d.totale), 1);

  const padding = { top: 20, right: 10, bottom: 30, left: 45 };
  const width = 400;
  const height = 200;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const barWidth = (chartWidth / data.length) * 0.7;
  const barGap = (chartWidth / data.length) * 0.3;

  const formatValue = (v: number) => {
    if (v >= 1000) return `€${(v / 1000).toFixed(0)}k`;
    return `€${v}`;
  };

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: 200 }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Y-axis grid lines and labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = padding.top + chartHeight * (1 - ratio);
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray={ratio === 0 ? "0" : "4,4"}
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                fill="var(--text-muted)"
                fontSize="11"
              >
                {formatValue(maxValue * ratio)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const barHeight = (d.totale / maxValue) * chartHeight;
          const x = padding.left + i * (chartWidth / data.length) + barGap / 2;
          const y = padding.top + chartHeight - barHeight;
          const isHovered = hoveredIndex === i;

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                fill={isHovered ? 'var(--accent-secondary)' : 'var(--accent-primary)'}
                rx="3"
                style={{ transition: 'fill 0.15s', cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize="10"
              >
                {d.mese}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && data[hoveredIndex] && (
        <div style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{data[hoveredIndex].mese}</div>
          <div style={{ color: 'var(--accent-green)' }}>
            <Currency amount={data[hoveredIndex].totale} />
          </div>
        </div>
      )}
    </div>
  );
}

interface DashboardProps {
  annoSelezionato: number;
  setAnnoSelezionato: (anno: number) => void;
}

export function Dashboard({ annoSelezionato, setAnnoSelezionato }: DashboardProps) {
  const { config, clienti, fatture } = useApp();

  // Calcoli
  const annoCorrente = new Date().getFullYear();
  const anniAttivita = annoSelezionato - config.annoApertura;
  const aliquotaIrpef = getAliquotaImpostaSostitutiva({
    annoApertura: config.annoApertura,
    annoImposta: annoSelezionato,
    aliquotaOverride: config.aliquotaOverride,
  });
  const annoPiuVecchio = annoCorrente - MAX_HISTORICAL_YEARS + 1;

  const fattureAnnoCorrente = fatture.filter(f => {
    if (f.incassato === false) return false;
    const dataRiferimento = f.dataIncasso || f.data;
    return new Date(dataRiferimento).getFullYear() === annoSelezionato;
  });
  const totaleFatturato = fattureAnnoCorrente.reduce((sum, f) => sum + f.importo, 0);

  const fattureDaIncassare = fatture.filter(f => f.incassato === false);
  const totaleDaIncassare = fattureDaIncassare.reduce((sum, f) => sum + f.importo, 0);
  const percentualeLimite = (totaleFatturato / LIMITE_FATTURATO) * 100;
  const rimanenteLimite = LIMITE_FATTURATO - totaleFatturato;

  const coefficienteMedio = calcolaCoefficienteMedioAteco(config.codiciAteco);
  const thresholdStatus = getRegimeThresholdStatus(totaleFatturato);

  const fiscale = calcolaFiscale(totaleFatturato, coefficienteMedio, aliquotaIrpef, getInpsCalculationInput(config));
  const { imponibile: redditoImponibile, irpef: irpefDovuta, inps: inpsDovuta, totaleTasse } = fiscale;
  const previdenzialeInfo = calcolaContributiPrevidenziali(redditoImponibile, config);

  const fatturatoPerCliente = clienti.map(cliente => {
    const fattureCliente = fattureAnnoCorrente.filter(f => f.clienteId === cliente.id);
    return { ...cliente, totale: fattureCliente.reduce((sum, f) => sum + f.importo, 0), count: fattureCliente.length };
  }).sort((a, b) => b.totale - a.totale);

  // Grafici
  const pieData = fatturatoPerCliente.slice(0, 5).map((c, i) => ({
    name: c.nome, value: c.totale, color: ['#047857', '#059669', '#10b981', '#34d399', '#6ee7b7'][i]
  }));

  const mesiData = Array.from({ length: 12 }, (_, i) => ({
    mese: new Date(annoSelezionato, i, 1).toLocaleString('it-IT', { month: 'short' }),
    totale: fatture.filter(f => {
      if (f.incassato === false) return false;
      const dataRiferimento = f.dataIncasso || f.data;
      const d = new Date(dataRiferimento);
      return d.getMonth() === i && d.getFullYear() === annoSelezionato;
    }).reduce((sum, f) => sum + f.importo, 0)
  }));

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Dashboard {annoSelezionato}</h1>
          <p className="page-subtitle">Panoramica della tua attività</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn"
            onClick={() => setAnnoSelezionato(annoSelezionato - 1)}
            disabled={annoSelezionato <= annoPiuVecchio}
            style={{ padding: '8px 12px' }}
            aria-label="Anno precedente"
          >
            ←
          </button>
          <select
            className="input-field"
            value={annoSelezionato}
            onChange={(e) => setAnnoSelezionato(parseInt(e.target.value))}
            style={{ width: 'auto', padding: '8px 12px', fontSize: '1rem', fontWeight: 600 }}
            aria-label="Seleziona anno"
          >
            {Array.from({ length: annoCorrente - annoPiuVecchio + 1 }, (_, i) => {
              const year = annoCorrente - i;
              return <option key={year} value={year}>{year}</option>;
            })}
          </select>
          <button
            className="btn"
            onClick={() => setAnnoSelezionato(annoSelezionato + 1)}
            disabled={annoSelezionato >= annoCorrente}
            style={{ padding: '8px 12px' }}
            aria-label="Anno successivo"
          >
            →
          </button>
        </div>
      </div>

      {annoSelezionato < annoCorrente && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(251, 191, 36, 0.1)',
          border: '1px solid rgba(251, 191, 36, 0.3)',
          borderRadius: '12px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: '#fbbf24'
        }}>
          <Clock size={18} aria-hidden="true" />
          <span style={{ fontWeight: 500 }}>Stai visualizzando dati storici dell'anno {annoSelezionato}</span>
        </div>
      )}

      <div className="grid-4">
        <div className="card">
          <h2 className="card-title">Fatturato Anno</h2>
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}><Currency amount={totaleFatturato} /></div>
          <div className="stat-label">{fattureAnnoCorrente.length} fatture incassate</div>
        </div>

        <div className="card">
          <h2 className="card-title">Al Limite (85k)</h2>
          <div className="stat-value" style={{ color: percentualeLimite > 90 ? 'var(--accent-red)' : percentualeLimite > 70 ? 'var(--accent-orange)' : 'var(--accent-primary)' }}>
            {percentualeLimite.toFixed(1)}%
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.min(percentualeLimite, 100)}%`, background: percentualeLimite > 90 ? 'var(--accent-red)' : percentualeLimite > 70 ? 'var(--accent-orange)' : 'var(--accent-green)' }} />
          </div>
          <div className="stat-label">Rimangono <Currency amount={rimanenteLimite} /></div>
        </div>

        <div className="card">
          <h2 className="card-title">Imposta sostitutiva da accantonare</h2>
          <div className="stat-value" style={{ color: 'var(--accent-orange)' }}><Currency amount={irpefDovuta} /></div>
          <div className="stat-label">
            Aliquota {(aliquotaIrpef * 100).toFixed(2)}%
            {config.aliquotaOverride !== null && ' (custom)'}
            {config.aliquotaOverride === null && anniAttivita < 5 && ' (agevolata)'}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">INPS da accantonare</h2>
          <div className="stat-value" style={{ color: 'var(--accent-orange)' }}><Currency amount={inpsDovuta} /></div>
          <div className="stat-label">
            {previdenzialeInfo.usesFixedAmount
              ? `${previdenzialeInfo.label}${previdenzialeInfo.reductionApplied ? ' · riduzione 35%' : ''}`
              : `${previdenzialeInfo.label} ${((previdenzialeInfo.effectiveRate ?? 0) * 100).toFixed(2)}%`}
          </div>
        </div>
      </div>

      {fattureDaIncassare.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-red)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 className="card-title">Fatture da Incassare</h2>
              <div className="stat-label">{fattureDaIncassare.length} fattur{fattureDaIncassare.length === 1 ? 'a' : 'e'} in attesa di pagamento</div>
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-red)' }}><Currency amount={totaleDaIncassare} /></div>
          </div>
        </div>
      )}

      <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(4,120,87,0.1) 100%)' }}>
        <div className="grid-3" style={{ alignItems: 'center' }}>
          <div>
            <h2 className="card-title">Totale da Accantonare</h2>
            <div className="stat-value" style={{ fontSize: '2.8rem' }}><Currency amount={totaleTasse} /></div>
            <div className="stat-label">Reddito imponibile <Currency amount={redditoImponibile} /> (coeff. {coefficienteMedio}%) − INPS <Currency amount={inpsDovuta} /> = <Currency amount={redditoImponibile - inpsDovuta} /></div>
          </div>
          <div style={{ textAlign: 'center' }}>
            {percentualeLimite > 90 && (
              <div style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <AlertTriangle size={24} aria-hidden="true" />
                <span style={{ fontWeight: 600 }}>
                  {thresholdStatus === 'immediate_exit'
                    ? 'Uscita immediata dal regime'
                    : thresholdStatus === 'next_year_exit'
                      ? 'Uscita dal regime dall\'anno successivo'
                      : 'Vicino alla soglia 85k'}
                </span>
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Netto stimato</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent-green)' }}>
              <Currency amount={totaleFatturato - totaleTasse} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card" style={{ position: 'relative' }}>
          <h2 className="card-title">Fatturato per Cliente</h2>
          {pieData.some(d => d.value > 0) ? (
            <DonutChart data={pieData.filter(d => d.value > 0)} />
          ) : (
            <div className="empty-state"><Users size={40} aria-hidden="true" /><p>Nessuna fattura</p></div>
          )}
        </div>

        <div className="card" style={{ position: 'relative' }}>
          <h2 className="card-title">Andamento Mensile</h2>
          <VerticalBarChart data={mesiData} />
        </div>
      </div>
    </>
  );
}
