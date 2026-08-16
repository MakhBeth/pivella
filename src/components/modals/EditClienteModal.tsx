import { X, Check } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import type { Cliente } from '../../types';

interface EditClienteModalProps {
  isOpen: boolean;
  onClose: () => void;
  cliente: Cliente | null;
  setCliente: (cliente: Cliente) => void;
  onUpdate: () => void;
}

export function EditClienteModal({ isOpen, onClose, cliente, setCliente, onUpdate }: EditClienteModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  if (!isOpen || !cliente) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="edit-cliente-title">
        <div className="modal-header">
          <h3 id="edit-cliente-title" className="modal-title">Modifica Cliente</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="input-group">
          <label className="input-label">Nome *</label>
          <input type="text" className="input-field" value={cliente.nome} onChange={(e) => setCliente({ ...cliente, nome: e.target.value })} placeholder="Acme S.r.l." />
        </div>
        <div className="input-group">
          <label className="input-label">P.IVA / CF</label>
          <input type="text" className="input-field" value={cliente.piva || ''} onChange={(e) => setCliente({ ...cliente, piva: e.target.value })} />
        </div>
        <div className="input-group">
          <label className="input-label">Email</label>
          <input type="email" className="input-field" value={cliente.email || ''} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} />
        </div>

        {/* Indirizzo per fatturazione */}
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Indirizzo</label>
            <input type="text" className="input-field" value={cliente.indirizzo || ''} onChange={(e) => setCliente({ ...cliente, indirizzo: e.target.value })} placeholder="Via Roma" />
          </div>
          <div className="input-group">
            <label className="input-label">N. Civico</label>
            <input type="text" className="input-field" value={cliente.numeroCivico || ''} onChange={(e) => setCliente({ ...cliente, numeroCivico: e.target.value })} placeholder="1" />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 80px', gap: 12 }}>
          <div className="input-group">
            <label className="input-label">CAP</label>
            <input type="text" className="input-field" value={cliente.cap || ''} onChange={(e) => setCliente({ ...cliente, cap: e.target.value })} placeholder="00100" />
          </div>
          <div className="input-group">
            <label className="input-label">Comune</label>
            <input type="text" className="input-field" value={cliente.comune || ''} onChange={(e) => setCliente({ ...cliente, comune: e.target.value })} placeholder="Roma" />
          </div>
          <div className="input-group">
            <label className="input-label">Prov.</label>
            <input type="text" className="input-field" value={cliente.provincia || ''} onChange={(e) => setCliente({ ...cliente, provincia: e.target.value })} placeholder="RM" maxLength={2} />
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Nazione</label>
          <input type="text" className="input-field" value={cliente.nazione || 'IT'} onChange={(e) => setCliente({ ...cliente, nazione: e.target.value.toUpperCase() })} placeholder="IT" maxLength={2} />
        </div>

        <div className="input-group">
          <label className="input-label">Unità di Fatturazione</label>
          <select className="input-field" value={cliente.billingUnit || ''} onChange={(e) => setCliente({ ...cliente, billingUnit: e.target.value as 'ore' | 'giornata' })}>
            <option value="">Non specificato</option>
            <option value="ore">Ore</option>
            <option value="giornata">Giornata</option>
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Tariffa (€)</label>
          <input type="number" className="input-field" value={cliente.rate || ''} onChange={(e) => setCliente({ ...cliente, rate: parseFloat(e.target.value) || undefined })} placeholder="Es: 50" min="0" step="0.01" />
        </div>
        <div className="input-group">
          <label className="input-label">Data Inizio Fatturazione</label>
          <input type="date" className="input-field" value={cliente.billingStartDate || ''} onChange={(e) => setCliente({ ...cliente, billingStartDate: e.target.value })} />
          <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Il riepilogo mensile includerà solo le attività da questa data in poi
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Colore Calendario</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={cliente.color || '#10b981'}
              onChange={(e) => setCliente({ ...cliente, color: e.target.value })}
              style={{ width: 48, height: 36, padding: 2, border: '1px solid var(--border-color)', borderRadius: 6, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'Space Mono' }}>{cliente.color || '#10b981'}</span>
            {cliente.color && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => setCliente({ ...cliente, color: undefined })}
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onUpdate}><Check size={18} /> Salva</button>
    </dialog>
  );
}
