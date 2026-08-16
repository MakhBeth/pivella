import { X, Check } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import type { Fattura } from '../../types';

interface EditDataIncassoModalProps {
  isOpen: boolean;
  onClose: () => void;
  fattura: Fattura | null;
  setFattura: (fattura: Fattura) => void;
  onUpdate: () => void;
}

export function EditDataIncassoModal({ isOpen, onClose, fattura, setFattura, onUpdate }: EditDataIncassoModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  if (!isOpen || !fattura) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="edit-incasso-title">
        <div className="modal-header">
          <h3 id="edit-incasso-title" className="modal-title">Modifica Data Incasso</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        <div style={{ padding: 16, background: 'var(--bg-secondary)', borderRadius: 12, marginBottom: 20 }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>Fattura</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{fattura.numero || 'N/A'} - {fattura.clienteNome}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Data emissione: {new Date(fattura.data).toLocaleDateString('it-IT')}
          </div>
        </div>
        <div className="input-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={fattura.incassato === false}
              onChange={(e) => setFattura({ ...fattura, incassato: e.target.checked ? false : undefined })}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: fattura.incassato === false ? 'var(--accent-red)' : 'var(--text-primary)' }}>
              Non ancora incassata
            </span>
          </label>
          <label className="input-label">Data Incasso (Principio di Cassa)</label>
          <input
            type="date"
            className="input-field"
            value={fattura.dataIncasso || fattura.data}
            onChange={(e) => setFattura({ ...fattura, dataIncasso: e.target.value })}
            disabled={fattura.incassato === false}
            style={fattura.incassato === false ? { opacity: 0.5 } : undefined}
          />
          <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {fattura.incassato === false
              ? 'Questa fattura non verrà conteggiata nel fatturato fino a quando non sarà incassata.'
              : 'Per il regime forfettario, il fatturato si conta quando viene effettivamente incassato (principio di cassa).'
            }
          </div>
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onUpdate}>
          <Check size={18} /> Salva
        </button>
    </dialog>
  );
}
