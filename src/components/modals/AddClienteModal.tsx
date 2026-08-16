import { X, Check } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import type { Cliente } from '../../types';

interface AddClienteModalProps {
  isOpen: boolean;
  onClose: () => void;
  newCliente: Partial<Cliente>;
  setNewCliente: (cliente: Partial<Cliente>) => void;
  onAdd: () => void;
}

export function AddClienteModal({ isOpen, onClose, newCliente, setNewCliente, onAdd }: AddClienteModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="add-cliente-title">
        <div className="modal-header">
          <h3 id="add-cliente-title" className="modal-title">Nuovo Cliente</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="input-group">
          <label className="input-label">Nome *</label>
          <input type="text" className="input-field" value={newCliente.nome || ''} onChange={(e) => setNewCliente({ ...newCliente, nome: e.target.value })} placeholder="Acme S.r.l." />
        </div>
        <div className="input-group">
          <label className="input-label">P.IVA / CF</label>
          <input type="text" className="input-field" value={newCliente.piva || ''} onChange={(e) => setNewCliente({ ...newCliente, piva: e.target.value })} />
        </div>
        <div className="input-group">
          <label className="input-label">Email</label>
          <input type="email" className="input-field" value={newCliente.email || ''} onChange={(e) => setNewCliente({ ...newCliente, email: e.target.value })} />
        </div>

        {/* Indirizzo per fatturazione */}
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Indirizzo</label>
            <input type="text" className="input-field" value={newCliente.indirizzo || ''} onChange={(e) => setNewCliente({ ...newCliente, indirizzo: e.target.value })} placeholder="Via Roma" />
          </div>
          <div className="input-group">
            <label className="input-label">N. Civico</label>
            <input type="text" className="input-field" value={newCliente.numeroCivico || ''} onChange={(e) => setNewCliente({ ...newCliente, numeroCivico: e.target.value })} placeholder="1" />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 80px', gap: 12 }}>
          <div className="input-group">
            <label className="input-label">CAP</label>
            <input type="text" className="input-field" value={newCliente.cap || ''} onChange={(e) => setNewCliente({ ...newCliente, cap: e.target.value })} placeholder="00100" />
          </div>
          <div className="input-group">
            <label className="input-label">Comune</label>
            <input type="text" className="input-field" value={newCliente.comune || ''} onChange={(e) => setNewCliente({ ...newCliente, comune: e.target.value })} placeholder="Roma" />
          </div>
          <div className="input-group">
            <label className="input-label">Prov.</label>
            <input type="text" className="input-field" value={newCliente.provincia || ''} onChange={(e) => setNewCliente({ ...newCliente, provincia: e.target.value })} placeholder="RM" maxLength={2} />
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Nazione</label>
          <input type="text" className="input-field" value={newCliente.nazione || 'IT'} onChange={(e) => setNewCliente({ ...newCliente, nazione: e.target.value.toUpperCase() })} placeholder="IT" maxLength={2} />
        </div>

        <div className="input-group">
          <label className="input-label">Colore Calendario</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={newCliente.color || '#10b981'}
              onChange={(e) => setNewCliente({ ...newCliente, color: e.target.value })}
              style={{ width: 48, height: 36, padding: 2, border: '1px solid var(--border-color)', borderRadius: 6, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'Space Mono' }}>{newCliente.color || '#10b981'}</span>
          </div>
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onAdd}><Check size={18} /> Aggiungi</button>
    </dialog>
  );
}
