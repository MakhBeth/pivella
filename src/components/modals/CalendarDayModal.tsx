import { useState, useEffect } from 'react';
import { X, Check, Clock, CalendarClock } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import { useApp } from '../../context/AppContext';
import type { WorkLog, Cliente, Scadenza } from '../../types';

interface CalendarDayModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string | null;
  newWorkLog: Partial<WorkLog>;
  setNewWorkLog: (log: Partial<WorkLog>) => void;
  clienti: Cliente[];
  onAddWorkLog: () => void;
  initialTab?: 'lavoro' | 'scadenze';
}

export function CalendarDayModal({ 
  isOpen, 
  onClose, 
  selectedDate, 
  newWorkLog, 
  setNewWorkLog, 
  clienti, 
  onAddWorkLog,
  initialTab = 'lavoro',
}: CalendarDayModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);
  const { scadenze, updateScadenza, showToast } = useApp();
  const [activeTab, setActiveTab] = useState<'lavoro' | 'scadenze'>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  if (!isOpen || !selectedDate) return null;

  const dayScadenze = scadenze.filter(s => s.date === selectedDate);
  const hasScadenze = dayScadenze.length > 0;

  const formatDateLong = (dateStr: string) => {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleTogglePaid = async (scadenza: Scadenza) => {
    const nextPagato = !scadenza.pagato;
    try {
      await updateScadenza({
        ...scadenza,
        pagato: nextPagato,
        dataPagamento: nextPagato ? new Date().toISOString().split('T')[0] : undefined,
      });
    } catch (error) {
      console.error('Failed to update scadenza:', error);
      showToast('Errore durante l\'aggiornamento della scadenza', 'error');
    }
  };

  const getTipoLabel = (tipo: string) => {
    switch (tipo) {
      case 'saldo_irpef': return 'Saldo imposta sostitutiva';
      case 'acconto_irpef': return 'Acconto imposta sostitutiva';
      case 'saldo_inps': return 'Saldo INPS';
      case 'acconto_inps': return 'Acconto INPS';
      default: return tipo;
    }
  };

  const getTipoColor = (tipo: string) => {
    if (tipo.includes('irpef')) return 'var(--accent-orange)';
    return 'var(--accent-primary)';
  };

  const totaleDovuto = dayScadenze.reduce((sum, s) => sum + s.totale, 0);
  const totalePagato = dayScadenze.filter(s => s.pagato).reduce((sum, s) => sum + s.totale, 0);
  const totaleRimanente = totaleDovuto - totalePagato;
  const allPaid = dayScadenze.every(s => s.pagato);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="calendar-day-modal-title">
      <div className="modal-header">
        <h3 id="calendar-day-modal-title" className="modal-title" style={{ textTransform: 'capitalize' }}>
          {formatDateLong(selectedDate)}
        </h3>
        <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
      </div>

      <div style={{ 
        display: 'flex', 
        gap: 0, 
        marginBottom: 20,
        borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={() => setActiveTab('lavoro')}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'lavoro' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'lavoro' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'lavoro' ? 600 : 400,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'all 0.15s',
          }}
        >
          <Clock size={18} /> Registra Lavoro
        </button>
        <button
          onClick={() => setActiveTab('scadenze')}
          disabled={!hasScadenze}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'scadenze' ? '2px solid var(--accent-orange)' : '2px solid transparent',
            color: !hasScadenze ? 'var(--text-muted)' : (activeTab === 'scadenze' ? 'var(--accent-orange)' : 'var(--text-secondary)'),
            fontWeight: activeTab === 'scadenze' ? 600 : 400,
            cursor: hasScadenze ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'all 0.15s',
            opacity: hasScadenze ? 1 : 0.5,
          }}
        >
          <CalendarClock size={18} /> Scadenze {hasScadenze && `(${dayScadenze.length})`}
        </button>
      </div>

      {activeTab === 'lavoro' && (
        <>
          <div className="input-group">
            <label className="input-label">Cliente *</label>
            <select className="input-field" value={newWorkLog.clienteId || ''} onChange={(e) => {
              const selectedCliente = clienti.find(c => c.id === e.target.value);
              const billingUnit = selectedCliente?.billingUnit || 'ore';
              const defaultQuantita = billingUnit === 'giornata' ? 1 : undefined;
              setNewWorkLog({ ...newWorkLog, clienteId: e.target.value, tipo: billingUnit, quantita: defaultQuantita });
            }}>
              <option value="">Seleziona...</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          {newWorkLog.clienteId && (() => {
            const selectedCliente = clienti.find(c => c.id === newWorkLog.clienteId);
            const billingUnit = selectedCliente?.billingUnit || 'ore';
            const isHourly = billingUnit === 'ore';

            return (
              <>
                <div className="input-group">
                  <label className="input-label">{isHourly ? 'Ore *' : 'Giornate *'}</label>
                  <input
                    type="number"
                    className="input-field"
                    value={newWorkLog.quantita ?? ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setNewWorkLog({ ...newWorkLog, quantita: isNaN(val) ? undefined : val });
                    }}
                    min="0"
                    max={isHourly ? "24" : "1"}
                    step={isHourly ? "0.25" : "0.01"}
                    placeholder={isHourly ? "Es: 2.5" : "Es: 0.5"}
                  />
                  {!isHourly && (
                    <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      💡 Massimo 1 giornata. Puoi usare frazioni (es: 0.5 per mezza giornata)
                    </div>
                  )}
                </div>
                <div className="input-group">
                  <label className="input-label">Note</label>
                  <input type="text" className="input-field" value={newWorkLog.note || ''} onChange={(e) => setNewWorkLog({ ...newWorkLog, note: e.target.value })} />
                </div>
              </>
            );
          })()}
          <button 
            className="btn btn-primary" 
            style={{ width: '100%' }} 
            onClick={onAddWorkLog} 
            disabled={!newWorkLog.clienteId || newWorkLog.quantita === undefined || newWorkLog.quantita === null}
          >
            <Check size={18} /> Registra
          </button>
        </>
      )}

      {activeTab === 'scadenze' && hasScadenze && (
        <>
          <div style={{ marginBottom: 20 }}>
            {dayScadenze.map((scadenza) => (
              <div
                key={scadenza.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: scadenza.pagato ? 'rgba(4, 120, 87, 0.1)' : 'var(--bg-secondary)',
                  borderRadius: 8,
                  marginBottom: 8,
                  opacity: scadenza.pagato ? 0.8 : 1,
                }}
              >
                <button
                  onClick={() => handleTogglePaid(scadenza)}
                  aria-label={scadenza.pagato ? `Segna come non pagato: ${scadenza.label}` : `Segna come pagato: ${scadenza.label}`}
                  aria-pressed={scadenza.pagato}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: scadenza.pagato ? 'none' : '2px solid var(--border)',
                    background: scadenza.pagato ? 'var(--accent-green)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                  title={scadenza.pagato ? 'Segna come non pagato' : 'Segna come pagato'}
                >
                  {scadenza.pagato && <Check size={16} />}
                </button>
                
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: getTipoColor(scadenza.tipo), marginBottom: 2 }}>
                    {scadenza.label}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {getTipoLabel(scadenza.tipo)} · Anno rif. {scadenza.annoRiferimento}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right' }}>
                  <div style={{ 
                    fontFamily: 'Space Mono, monospace', 
                    fontWeight: 600, 
                    color: scadenza.pagato ? 'var(--accent-green)' : 'var(--accent-orange)',
                    textDecoration: scadenza.pagato ? 'line-through' : undefined,
                  }}>
                    €{formatCurrency(scadenza.totale)}
                  </div>
                  {scadenza.interessi > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      (incl. €{formatCurrency(scadenza.interessi)} int.)
                    </div>
                  )}
                  {scadenza.pagato && scadenza.dataPagamento && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>
                      Pagato il {new Date(scadenza.dataPagamento).toLocaleDateString('it-IT')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ 
            padding: '16px', 
            background: allPaid ? 'rgba(4, 120, 87, 0.15)' : 'var(--bg-secondary)', 
            borderRadius: 8,
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Totale scadenza</span>
              <span style={{ fontFamily: 'Space Mono, monospace', fontWeight: 600 }}>€{formatCurrency(totaleDovuto)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Già pagato</span>
              <span style={{ fontFamily: 'Space Mono, monospace', color: 'var(--accent-green)' }}>€{formatCurrency(totalePagato)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <span style={{ fontWeight: 600 }}>Rimanente</span>
              <span style={{ 
                fontFamily: 'Space Mono, monospace', 
                fontWeight: 600, 
                fontSize: '1.1rem',
                color: totaleRimanente > 0 ? 'var(--accent-red)' : 'var(--accent-green)' 
              }}>
                €{formatCurrency(totaleRimanente)}
              </span>
            </div>
          </div>

          {!allPaid && (
            <button 
              className="btn btn-primary" 
              style={{ width: '100%' }}
              onClick={async () => {
                for (const s of dayScadenze.filter(s => !s.pagato)) {
                  await updateScadenza({
                    ...s,
                    pagato: true,
                    dataPagamento: new Date().toISOString().split('T')[0],
                  });
                }
              }}
            >
              <Check size={18} /> Segna tutte come pagate
            </button>
          )}
        </>
      )}
    </dialog>
  );
}
