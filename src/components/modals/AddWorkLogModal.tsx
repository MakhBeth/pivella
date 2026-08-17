import { X, Check, Clock } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import type { WorkLog, Cliente } from '../../types';

interface AddWorkLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string | null;
  newWorkLog: Partial<WorkLog>;
  setNewWorkLog: (log: Partial<WorkLog>) => void;
  clienti: Cliente[];
  onAdd: () => void;
}

export function AddWorkLogModal({ isOpen, onClose, selectedDate, newWorkLog, setNewWorkLog, clienti, onAdd }: AddWorkLogModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="add-worklog-title">
        <div className="modal-header">
          <h3 id="add-worklog-title" className="modal-title">Registra Lavoro</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 20, textAlign: 'center' }}>
          <Clock size={20} style={{ marginBottom: 4, color: 'var(--accent-readable)' }} />
          <div style={{ fontWeight: 500 }}>
            {selectedDate && new Date(selectedDate + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
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
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onAdd} disabled={!newWorkLog.clienteId || newWorkLog.quantita === undefined || newWorkLog.quantita === null}><Check size={18} /> Registra</button>
    </dialog>
  );
}
