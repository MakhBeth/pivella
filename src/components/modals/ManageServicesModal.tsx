import { useState } from 'react';
import { X, Plus, Trash2, Save } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import { useDialog } from '../../hooks/useDialog';
import type { ServiceTemplate } from '../../types';

interface ManageServicesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ManageServicesModal({ isOpen, onClose }: ManageServicesModalProps) {
  const { config, setConfig, showToast } = useApp();
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  const [services, setServices] = useState<ServiceTemplate[]>(
    config.courtesyInvoice?.defaultServices || []
  );

  const addService = () => {
    const newService: ServiceTemplate = {
      id: Date.now().toString(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      taxRate: 0
    };
    setServices([...services, newService]);
  };

  const removeService = (id: string) => {
    setServices(services.filter(s => s.id !== id));
  };

  const updateService = (id: string, updates: Partial<ServiceTemplate>) => {
    setServices(services.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleSave = () => {
    // Validate - remove empty services
    const validServices = services.filter(s => s.description.trim() !== '');

    // Ensure we have a complete courtesyInvoice config
    const currentCourtesyConfig = config.courtesyInvoice || {
      primaryColor: '#6699cc',
      textColor: '#033243',
      companyName: '',
      vatNumber: '',
      country: 'IT',
      defaultServices: [],
      includeFooter: true,
      locale: 'it'
    };

    setConfig({
      ...config,
      courtesyInvoice: {
        ...currentCourtesyConfig,
        defaultServices: validServices
      }
    });

    showToast(`${validServices.length} servizi salvati`, 'success');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="manage-services-title" style={{ maxWidth: 700 }}>
        <div className="modal-header">
          <h3 id="manage-services-title" className="modal-title">Gestisci Servizi Predefiniti</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>

        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
          I servizi predefiniti possono essere usati come template quando crei una fattura di cortesia.
        </p>

        {services.length > 0 ? (
          <div style={{ marginBottom: 20 }}>
            {services.map((service, index) => (
              <div
                key={service.id}
                style={{
                  padding: 16,
                  background: 'var(--bg-secondary)',
                  borderRadius: 12,
                  marginBottom: 12
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Servizio {index + 1}</span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeService(service.id)}
                    style={{ padding: '4px 8px' }}
                    aria-label={`Elimina servizio ${index + 1}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>

                <div className="input-group" style={{ marginBottom: 12 }}>
                  <label className="input-label">Descrizione</label>
                  <input
                    type="text"
                    className="input-field"
                    value={service.description}
                    onChange={(e) => updateService(service.id, { description: e.target.value })}
                    placeholder="Es: Consulenza informatica"
                  />
                </div>

                <div className="grid-3">
                  <div className="input-group">
                    <label className="input-label">Quantità</label>
                    <input
                      type="number"
                      className="input-field"
                      value={service.quantity}
                      onChange={(e) => updateService(service.id, { quantity: parseFloat(e.target.value) || 0 })}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Prezzo Unitario</label>
                    <input
                      type="number"
                      className="input-field"
                      value={service.unitPrice}
                      onChange={(e) => updateService(service.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">IVA %</label>
                    <input
                      type="number"
                      className="input-field"
                      value={service.taxRate}
                      onChange={(e) => updateService(service.id, { taxRate: parseFloat(e.target.value) || 0 })}
                      min="0"
                      max="100"
                      step="1"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 12, marginBottom: 20 }}>
            Nessun servizio predefinito. Clicca "Aggiungi Servizio" per crearne uno.
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={addService}>
            <Plus size={18} /> Aggiungi Servizio
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={handleSave}
          >
            <Save size={18} /> Salva
          </button>
        </div>
    </dialog>
  );
}
