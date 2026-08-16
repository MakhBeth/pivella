import { X, Check, Clock } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import type { WorkLog, Cliente } from '../../types';

interface EditWorkLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  workLog: WorkLog | null;
  setWorkLog: (log: WorkLog) => void;
  clienti: Cliente[];
  onUpdate: () => void;
}

export function EditWorkLogModal({ isOpen, onClose, workLog, setWorkLog, clienti, onUpdate }: EditWorkLogModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  if (!isOpen || !workLog) return null;

  const selectedCliente = clienti.find(c => c.id === workLog.clienteId);
  const billingUnit = selectedCliente?.billingUnit || workLog.tipo || 'ore';
  const isHourly = billingUnit === 'ore';

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="edit-worklog-title">
        <div className="modal-header">
          <h3 id="edit-worklog-title" className="modal-title">Modifica Attività</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 20, textAlign: 'center' }}>
          <Clock size={20} style={{ marginBottom: 4, color: 'var(--accent-primary)' }} />
          <div style={{ fontWeight: 500 }}>
            {new Date(workLog.data + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Data</label>
          <input
            type="date"
            className="input-field"
            value={workLog.data}
            onChange={(e) => setWorkLog({ ...workLog, data: e.target.value })}
          />
        </div>
        <div className="input-group">
          <label className="input-label">Cliente *</label>
          <select className="input-field" value={workLog.clienteId} onChange={(e) => {
            const newCliente = clienti.find(c => c.id === e.target.value);
            const newBillingUnit = newCliente?.billingUnit || 'ore';
            setWorkLog({ ...workLog, clienteId: e.target.value, tipo: newBillingUnit });
          }}>
            <option value="">Seleziona...</option>
            {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">{isHourly ? 'Ore *' : 'Giornate *'}</label>
          <input
            type="number"
            className="input-field"
            value={workLog.quantita ?? ''}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setWorkLog({ ...workLog, quantita: isNaN(val) ? undefined : val });
            }}
            min="0"
            max={isHourly ? "24" : "1"}
            step={isHourly ? "0.25" : "0.01"}
            placeholder={isHourly ? "Es: 2.5" : "Es: 0.5"}
          />
        </div>
        <div className="input-group">
          <label className="input-label">Note</label>
          <input type="text" className="input-field" value={workLog.note || ''} onChange={(e) => setWorkLog({ ...workLog, note: e.target.value })} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onUpdate} disabled={!workLog.clienteId || workLog.quantita === undefined}><Check size={18} /> Salva</button>
    </dialog>
  );
}
