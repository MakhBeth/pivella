import { useState } from 'react';
import { X, Check, CalendarClock, Loader2 } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import { useApp } from '../../context/AppContext';
import { parseDateLocal } from '../../lib/utils/dateHelpers';
import type { Scadenza } from '../../types';

interface ScadenzaDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string | null;
}

export function ScadenzaDetailModal({ isOpen, onClose, selectedDate }: ScadenzaDetailModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);
  const { scadenze, updateScadenza, showToast } = useApp();
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen || !selectedDate) return null;

  const dayScadenze = scadenze.filter(s => s.date === selectedDate);
  
  if (dayScadenze.length === 0) return null;

  const formatCurrency = (value: number) => {
    return value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDateFull = (dateStr: string) => {
    return parseDateLocal(dateStr).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const handleTogglePaid = async (scadenza: Scadenza) => {
    await updateScadenza({
      ...scadenza,
      pagato: !scadenza.pagato,
      dataPagamento: !scadenza.pagato ? new Date().toISOString().split('T')[0] : undefined,
    });
  };

  const totaleDovuto = dayScadenze.reduce((sum, s) => sum + s.totale, 0);
  const totalePagato = dayScadenze.filter(s => s.pagato).reduce((sum, s) => sum + s.totale, 0);
  const totaleRimanente = totaleDovuto - totalePagato;
  const allPaid = dayScadenze.every(s => s.pagato);

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

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="scadenza-detail-title">
      <div className="modal-header">
        <h3 id="scadenza-detail-title" className="modal-title">Scadenze Fiscali</h3>
        <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
      </div>
      
      <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 20, textAlign: 'center' }}>
        <CalendarClock size={20} style={{ marginBottom: 4, color: allPaid ? 'var(--accent-green)' : 'var(--accent-red)' }} />
        <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>
          {formatDateFull(selectedDate)}
        </div>
      </div>

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
                  Pagato il {parseDateLocal(scadenza.dataPagamento).toLocaleDateString('it-IT')}
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
          disabled={isProcessing}
          onClick={async () => {
            setIsProcessing(true);
            const unpaid = dayScadenze.filter(s => !s.pagato);
            const dataPagamento = new Date().toISOString().split('T')[0];
            const failedIds: string[] = [];

            for (const s of unpaid) {
              try {
                await updateScadenza({
                  ...s,
                  pagato: true,
                  dataPagamento,
                });
              } catch {
                failedIds.push(s.id);
              }
            }

            if (failedIds.length > 0) {
              showToast(
                failedIds.length === unpaid.length
                  ? 'Errore: nessuna scadenza aggiornata'
                  : `Errore su ${failedIds.length}/${unpaid.length} scadenze (ID: ${failedIds.join(', ')})`,
                'error'
              );
            } else {
              showToast('Tutte le scadenze segnate come pagate');
            }

            setIsProcessing(false);
          }}
        >
          {isProcessing
            ? <><Loader2 size={18} className="spinning" /> Elaborazione...</>
            : <><Check size={18} /> Segna tutte come pagate</>
          }
        </button>
      )}
    </dialog>
  );
}
