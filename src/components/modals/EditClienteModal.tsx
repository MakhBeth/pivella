import { useState } from 'react';
import { X, Check, Plus, Trash2 } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import { formatDate } from '../../lib/utils/dateHelpers';
import { getStoricoTariffe, validaStoricoTariffe } from '../../lib/utils/tariffe';
import type { BillingUnit, Cliente, TariffaCliente } from '../../types';

interface EditClienteModalProps {
  isOpen: boolean;
  onClose: () => void;
  cliente: Cliente | null;
  setCliente: (cliente: Cliente) => void;
  onUpdate: () => void;
}

export function EditClienteModal({ isOpen, onClose, cliente, setCliente, onUpdate }: EditClienteModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);
  // Campi lasciati almeno una volta ("riga:campo"): l'errore compare solo dopo il blur.
  const [toccati, setToccati] = useState<Set<string>>(() => new Set());
  // Dopo un Salva con errori si mostrano tutti, anche sui campi mai toccati.
  const [salvaTentato, setSalvaTentato] = useState(false);

  if (!isOpen || !cliente) return null;

  // Bozza nell'ordine in cui l'utente la scrive: si ordina al salvataggio,
  // così le righe non saltano mentre si cambia una data.
  const storico = cliente.rateHistory ?? getStoricoTariffe(cliente);
  const errori = validaStoricoTariffe(storico);
  const setStorico = (next: TariffaCliente[]) => setCliente({ ...cliente, rateHistory: next });
  const aggiornaRiga = (i: number, patch: Partial<TariffaCliente>) => setStorico(storico.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const tocca = (i: number, field: keyof TariffaCliente) => setToccati(prev => new Set(prev).add(`${i}:${field}`));
  const eliminaRiga = (i: number) => {
    setStorico(storico.filter((_, j) => j !== i));
    // Le righe dopo quella eliminata scalano di uno: i campi toccati le seguono.
    setToccati(prev => new Set([...prev].flatMap(key => {
      const [riga, field] = key.split(':');
      const n = Number(riga);
      return n === i ? [] : [`${n > i ? n - 1 : n}:${field}`];
    })));
  };
  const salva = () => {
    if (errori.length === 0) return onUpdate();
    setSalvaTentato(true);
    const primo = errori[0];
    const etichetta = { dal: 'Decorrenza', rate: 'Importo', billingUnit: 'Unità' }[primo.field];
    dialogRef.current?.querySelector<HTMLElement>(`[aria-label^="${etichetta} tariffa ${primo.index + 1}"]`)?.focus();
  };
  const aggiungiTariffa = () => {
    const ultima = storico[storico.length - 1];
    // La prima tariffa vale dall'inizio; le successive partono da oggi.
    setStorico([...storico, { dal: ultima ? formatDate(new Date()) : undefined, rate: NaN, billingUnit: ultima?.billingUnit ?? cliente.billingUnit ?? 'ore' }]);
  };

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
        <div className="input-group">
          <label className="input-label">Codice destinatario SDI</label>
          <input type="text" className="input-field" value={cliente.codiceDestinatario || ''} onChange={(e) => setCliente({ ...cliente, codiceDestinatario: e.target.value.toUpperCase() })} placeholder="0000000" maxLength={7} />
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
          <span className="input-label" id="storico-tariffe-label">Tariffe</span>
          <div style={{ marginBottom: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Ogni attività usa la tariffa in vigore alla sua data. Per un cambio di tariffa aggiungine una nuova con la decorrenza: i giorni precedenti restano alla tariffa vecchia. Senza data, la tariffa vale dall'inizio.
          </div>
          <div role="group" aria-labelledby="storico-tariffe-label" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {storico.map((t, i) => {
              const erroriRiga = errori.filter(e => e.index === i && (salvaTentato || toccati.has(`${i}:${e.field}`)));
              const invalido = (field: keyof TariffaCliente) => erroriRiga.some(e => e.field === field) || undefined;
              return (
                <div key={i}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                    <input type="date" className="input-field" aria-label={`Decorrenza tariffa ${i + 1}`} value={t.dal ?? ''} onChange={(e) => aggiornaRiga(i, { dal: e.target.value || undefined })} onBlur={() => tocca(i, 'dal')} aria-invalid={invalido('dal')} aria-describedby={erroriRiga.length > 0 ? `tariffa-${i}-errori` : undefined} />
                    <input type="number" className="input-field" aria-label={`Importo tariffa ${i + 1} in euro`} value={Number.isFinite(t.rate) ? t.rate : ''} onChange={(e) => aggiornaRiga(i, { rate: parseFloat(e.target.value) })} onBlur={() => tocca(i, 'rate')} aria-invalid={invalido('rate')} aria-describedby={erroriRiga.length > 0 ? `tariffa-${i}-errori` : undefined} placeholder="€ es. 50" min="0" step="0.01" />
                    <select className="input-field" aria-label={`Unità tariffa ${i + 1}`} value={t.billingUnit} onChange={(e) => aggiornaRiga(i, { billingUnit: e.target.value as BillingUnit })} onBlur={() => tocca(i, 'billingUnit')} aria-invalid={invalido('billingUnit')}>
                      <option value="ore">Ore</option>
                      <option value="giornata">Giornata</option>
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => eliminaRiga(i)} aria-label={`Elimina tariffa ${i + 1}`}><Trash2 size={16} aria-hidden="true" /></button>
                  </div>
                  {erroriRiga.length > 0 && (
                    <div id={`tariffa-${i}-errori`} role="alert" style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--accent-red)' }}>
                      {erroriRiga.map(e => e.reason).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {storico.length === 0 && (
            <div style={{ marginTop: 8 }}>
              <label className="input-label" htmlFor="unita-senza-tariffa">Unità di fatturazione (senza tariffa)</label>
              <select id="unita-senza-tariffa" className="input-field" value={cliente.billingUnit || ''} onChange={(e) => setCliente({ ...cliente, billingUnit: (e.target.value || undefined) as BillingUnit | undefined })}>
                <option value="">Non specificato</option>
                <option value="ore">Ore</option>
                <option value="giornata">Giornata</option>
              </select>
            </div>
          )}
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={aggiungiTariffa}>
            <Plus size={16} aria-hidden="true" /> Aggiungi tariffa
          </button>
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
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={salva}><Check size={18} /> Salva</button>
    </dialog>
  );
}
