import { useState } from 'react';
import { Download, Upload, Database, Plus, X, Edit, Trash2, Users, Palette, Building, FolderSync, RefreshCw, FolderOpen, AlertCircle, UserCircle, Coins, ChevronUp, ChevronDown, BookOpen } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import type { Cliente, EmittenteConfig, User, ValutaConfig } from '../../types';
import { calcolaCoefficienteMedioAteco, getAliquotaImpostaSostitutiva } from '../../lib/utils/forfettario';
import { GESTIONI_PREVIDENZIALI } from '../../lib/constants/fiscali';
import { ThemeSwitch } from '../shared/ThemeSwitch';
import { DesignStyleSwitch } from '../shared/DesignStyleSwitch';
import { getClientColor } from '../../lib/utils/colorUtils';
import {
  isFileSystemAccessSupported,
  getUnsupportedBrowserMessage,
  selectSyncFolder,
  clearStoredDirectoryHandle,
  getFolderName
} from '../../lib/utils/fileSystemSync';

const getClientDisplayColor = (cliente: Cliente): string => {
  return cliente.color || getClientColor(cliente.id);
};

interface ImpostazioniProps {
  setShowModal: (modal: string | null) => void;
  setEditingCliente: (cliente: Cliente) => void;
  handleExport: () => void;
}

export function Impostazioni({ setShowModal, setEditingCliente, handleExport }: ImpostazioniProps) {
  const {
    config,
    clienti,
    removeCliente,
    setConfig,
    showToast,
    syncFolderHandle,
    syncFolderName,
    isSyncing,
    lastSyncTime,
    syncToFolder,
    setSyncFolderHandle,
    setSyncFolderName,
    setLastSyncTime,
    users,
    currentUser,
    addUser,
    updateUser,
    deleteUser
  } = useApp();
  const [newAteco, setNewAteco] = useState<string>('');
  const [showUnsupportedMessage, setShowUnsupportedMessage] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUserName, setNewUserName] = useState('');
  const [newValuta, setNewValuta] = useState<ValutaConfig>({ codice: '', simbolo: '' });

  const handleSelectSyncFolder = async () => {
    if (!isFileSystemAccessSupported()) {
      setShowUnsupportedMessage(true);
      return;
    }

    try {
      const handle = await selectSyncFolder();
      if (handle) {
        setSyncFolderHandle(handle);
        setSyncFolderName(getFolderName(handle));
        showToast('Cartella di sincronizzazione selezionata!');
        // Trigger initial sync
        syncToFolder();
      }
    } catch (err) {
      showToast('Errore nella selezione della cartella', 'error');
    }
  };

  const handleRemoveSyncFolder = async () => {
    await clearStoredDirectoryHandle();
    setSyncFolderHandle(null);
    setSyncFolderName(null);
    setLastSyncTime(null);
    showToast('Cartella di sincronizzazione rimossa');
  };

  const annoCorrente = new Date().getFullYear();
  const anniAttivita = annoCorrente - config.annoApertura;

  const addAteco = () => {
    if (!newAteco || config.codiciAteco.includes(newAteco)) return;
    setConfig({ ...config, codiciAteco: [...config.codiciAteco, newAteco] });
    setNewAteco('');
  };

  const coefficienteMedio = calcolaCoefficienteMedioAteco(config.codiciAteco);
  const aliquotaCorrente = getAliquotaImpostaSostitutiva({
    annoApertura: config.annoApertura,
    annoImposta: annoCorrente,
    aliquotaOverride: config.aliquotaOverride,
  });

  const handleAddUser = async () => {
    if (!newUserName.trim()) return;
    try {
      await addUser(newUserName.trim());
      setNewUserName('');
      showToast('Utente creato!');
    } catch (error) {
      showToast('Errore nella creazione utente', 'error');
    }
  };

  const handleUpdateUser = async () => {
    if (!editingUser || !editingUser.nome.trim()) return;
    try {
      await updateUser(editingUser);
      setEditingUser(null);
      showToast('Utente aggiornato!');
    } catch (error) {
      showToast('Errore nell\'aggiornamento utente', 'error');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (users.length <= 1) {
      showToast('Impossibile eliminare l\'ultimo utente', 'error');
      return;
    }
    if (!confirm('Sei sicuro di voler eliminare questo utente e tutti i suoi dati?')) return;
    try {
      await deleteUser(userId);
      showToast('Utente eliminato!');
    } catch (error) {
      showToast('Errore nell\'eliminazione utente', 'error');
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Impostazioni</h1>
        <p className="page-subtitle">Configura P.IVA e backup</p>
      </div>

      <div className="card">
        <h2 className="card-title"><BookOpen size={16} aria-hidden="true" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Guida di Pivella</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: '1 1 260px' }}>
            Come funziona Pivella, pagina per pagina, e perché esiste.
          </p>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => { window.location.hash = '#/guida'; }}>
            <BookOpen size={18} aria-hidden="true" /> Apri la guida
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title"><Database size={16} aria-hidden="true" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Backup & Ripristino</h2>
        <div className="backup-section">
          <button className="btn btn-ghost" onClick={handleExport}><Download size={18} aria-hidden="true" /> Esporta backup</button>
          <button className="btn btn-primary" onClick={() => setShowModal('import')}><Upload size={18} aria-hidden="true" /> Importa backup</button>
        </div>
        <div className="backup-info">
          <h2>ℹ️ Info backup</h2>
          <p>I dati sono in IndexedDB (locale). Esporta regolarmente per sicurezza. Il JSON contiene: config, clienti, fatture e ore.</p>
        </div>
      </div>

      {/* Gestione Utenti */}
      <div className="card">
        <h2 className="card-title"><UserCircle size={16} aria-hidden="true" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Gestione Utenti</h2>

        <div style={{ marginBottom: 16 }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 12 }}>
            Utente corrente: <strong style={{ color: 'var(--accent-green)' }}>{currentUser?.nome}</strong>
          </p>
        </div>

        {/* Lista utenti */}
        <div className="table-wrapper" style={{ marginBottom: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Colore</th>
                <th scope="col">Creato il</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td style={{ fontWeight: user.id === currentUser?.id ? 600 : 400 }}>
                    {editingUser?.id === user.id ? (
                      <input
                        type="text"
                        className="input-field"
                        value={editingUser.nome}
                        onChange={(e) => setEditingUser({ ...editingUser, nome: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateUser();
                          if (e.key === 'Escape') setEditingUser(null);
                        }}
                        autoFocus
                        style={{ padding: '6px 10px', fontSize: '0.9rem' }}
                      />
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {user.nome}
                        {user.id === currentUser?.id && (
                          <span className="badge badge-green">Attivo</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td>
                    {editingUser?.id === user.id ? (
                      <input
                        type="color"
                        value={editingUser.color || '#047857'}
                        onChange={(e) => setEditingUser({ ...editingUser, color: e.target.value })}
                        style={{ width: 40, height: 32, padding: 0, border: 'none', borderRadius: 6, cursor: 'pointer' }}
                      />
                    ) : (
                      <span
                        style={{
                          display: 'inline-block',
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          backgroundColor: user.color || '#047857',
                          border: '2px solid var(--border)'
                        }}
                        title={user.color || '#047857'}
                      />
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {new Date(user.createdAt).toLocaleDateString('it-IT')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {editingUser?.id === user.id ? (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={handleUpdateUser}
                          >
                            Salva
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingUser(null)}
                          >
                            Annulla
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingUser({ ...user })}
                            aria-label={`Modifica ${user.nome}`}
                          >
                            <Edit size={16} aria-hidden="true" />
                          </button>
                          <button
                            className="btn btn-danger"
                            onClick={() => handleDeleteUser(user.id)}
                            aria-label={`Elimina ${user.nome}`}
                            disabled={users.length <= 1}
                            title={users.length <= 1 ? 'Impossibile eliminare l\'ultimo utente' : ''}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Aggiungi nuovo utente */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="input-field"
            placeholder="Nome nuovo utente..."
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddUser()}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAddUser}
            disabled={!newUserName.trim()}
          >
            <Plus size={18} aria-hidden="true" /> Aggiungi
          </button>
        </div>

        <div className="backup-info" style={{ marginTop: 16 }}>
          <h2>Info multi-utenza</h2>
          <p>Ogni utente ha dati separati: clienti, fatture, ore lavorate e configurazione P.IVA. Cambia utente dal selettore in alto.</p>
        </div>
      </div>

      {/* Dati P.IVA */}
      <div className="card">
        <h2 className="card-title"><Building size={16} aria-hidden="true" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Dati P.IVA</h2>

        <div className="grid-2">
          <div className="input-group">
            <label className="input-label" htmlFor="partita-iva">Partita IVA</label>
            <input type="text" id="partita-iva" className="input-field" value={config.partitaIva} onChange={(e) => setConfig({ ...config, partitaIva: e.target.value })} placeholder="12345678901" maxLength={11} style={{ fontFamily: 'Space Mono' }} />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="iban">IBAN</label>
            <input
              type="text"
              id="iban"
              className="input-field"
              value={config.iban || ''}
              onChange={(e) => setConfig({ ...config, iban: e.target.value.replace(/\s/g, '').toUpperCase() })}
              placeholder="IT60X0542811101000000123456"
              style={{ fontFamily: 'Space Mono' }}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="input-group">
            <label className="input-label" htmlFor="anno-apertura">Anno Apertura</label>
            <input type="number" id="anno-apertura" className="input-field" value={config.annoApertura} onChange={(e) => setConfig({ ...config, annoApertura: parseInt(e.target.value) })} min={2000} max={annoCorrente} />
            <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {config.aliquotaOverride !== null
                ? `✓ Override attivo: ${(aliquotaCorrente * 100).toFixed(2)}%`
                : anniAttivita < 5
                  ? `✓ Aliquota agevolata 5% (${5 - anniAttivita} anni rimasti)`
                  : 'Aliquota standard 15%'}
            </div>
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="aliquota-override">Override aliquota imposta sostitutiva</label>
            <input
              type="number"
              id="aliquota-override"
              className="input-field"
              value={config.aliquotaOverride !== null ? config.aliquotaOverride : ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setConfig({ ...config, aliquotaOverride: null });
                } else {
                  const num = parseFloat(val);
                  if (!isNaN(num) && num >= 0 && num <= 100) {
                    setConfig({ ...config, aliquotaOverride: num });
                  }
                }
              }}
              placeholder="Automatico"
              min={0}
              max={100}
              step={0.01}
            />
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="input-group">
            <label className="input-label" htmlFor="gestione-previdenziale">Gestione Contributi Previdenziali</label>
            <select
              id="gestione-previdenziale"
              className="input-field"
              value={config.gestionePrevidenziale}
              onChange={(e) => setConfig({
                ...config,
                gestionePrevidenziale: e.target.value as typeof config.gestionePrevidenziale,
              })}
            >
              {GESTIONI_PREVIDENZIALI.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {config.gestionePrevidenziale === 'gestione_separata'
                ? 'Calcolo percentuale sul reddito imponibile.'
                : 'Usa un importo INPS annuo fisso e opzionalmente applica la riduzione del 35%.'}
            </div>
          </div>

          {config.gestionePrevidenziale !== 'gestione_separata' ? (
            <div className="input-group">
              <label className="input-label" htmlFor="contributi-inps-fissi">Contributi INPS annui base</label>
              <input
                type="number"
                id="contributi-inps-fissi"
                className="input-field"
                value={config.contributiInpsFissi ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setConfig({
                    ...config,
                    contributiInpsFissi: value === '' ? null : parseFloat(value),
                  });
                }}
                placeholder="Es. 4521.36"
                min={0}
                step={0.01}
              />
              <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Inserisci l'importo annuo senza riduzione, come da tuo cassetto previdenziale INPS.
              </div>
            </div>
          ) : (
            <div className="input-group">
              <label className="input-label" htmlFor="gestione-separata-note">Aliquota INPS</label>
              <input
                id="gestione-separata-note"
                className="input-field"
                value="26.07%"
                disabled
                readOnly
              />
              <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Modello predefinito per professionisti senza cassa, dedotto automaticamente dal reddito imponibile.
              </div>
            </div>
          )}
        </div>

        {config.gestionePrevidenziale !== 'gestione_separata' && (
          <div className="input-group" style={{ marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.riduzioneContributiva}
                onChange={(e) => setConfig({ ...config, riduzioneContributiva: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
              <span>
                Applica riduzione contributiva del 35%
                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                  Riduce l'importo INPS annuo usato nei calcoli e nell'accantonamento.
                </span>
              </span>
            </label>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <label className="input-label">Codici ATECO</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input type="text" className="input-field" value={newAteco} onChange={(e) => setNewAteco(e.target.value)} placeholder="Es: 62.01.00" style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={addAteco} aria-label="Aggiungi codice ATECO"><Plus size={18} aria-hidden="true" /></button>
          </div>
          {config.codiciAteco.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {config.codiciAteco.map((code, i) => (
                <div key={i} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {code}
                  <button
                    type="button"
                    aria-label={`Rimuovi codice ${code}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', borderRadius: 4 }}
                    onClick={() => setConfig({ ...config, codiciAteco: config.codiciAteco.filter((_, j) => j !== i) })}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Coefficiente: <strong style={{ color: 'var(--accent-green)' }}>{coefficienteMedio}%</strong>
              </span>
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Aggiungi ATECO per coefficiente redditività</p>}
        </div>
      </div>

      {/* Dati Emittente per fatture XML */}
      <div className="card">
        <h2 className="card-title">Dati Emittente (per fatture XML)</h2>

        <div className="input-group">
          <label className="input-label" htmlFor="emittente-cf">Codice Fiscale</label>
          <input
            type="text"
            id="emittente-cf"
            className="input-field"
            value={config.emittente?.codiceFiscale || ''}
            onChange={(e) => setConfig({
              ...config,
              emittente: { ...config.emittente, codiceFiscale: e.target.value.toUpperCase() } as EmittenteConfig
            })}
            placeholder="RSSMRA85M01H501Z"
            maxLength={16}
            style={{ fontFamily: 'Space Mono' }}
          />
        </div>

        <div className="grid-2">
          <div className="input-group">
            <label className="input-label" htmlFor="emittente-nome">Nome</label>
            <input
              type="text"
              id="emittente-nome"
              className="input-field"
              value={config.emittente?.nome || ''}
              onChange={(e) => setConfig({
                ...config,
                emittente: { ...config.emittente, nome: e.target.value.toUpperCase() } as EmittenteConfig
              })}
              placeholder="MARIO"
            />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="emittente-cognome">Cognome</label>
            <input
              type="text"
              id="emittente-cognome"
              className="input-field"
              value={config.emittente?.cognome || ''}
              onChange={(e) => setConfig({
                ...config,
                emittente: { ...config.emittente, cognome: e.target.value.toUpperCase() } as EmittenteConfig
              })}
              placeholder="ROSSI"
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="input-group">
            <label className="input-label" htmlFor="emittente-indirizzo">Indirizzo</label>
            <input
              type="text"
              id="emittente-indirizzo"
              className="input-field"
              value={config.emittente?.indirizzo || ''}
              onChange={(e) => setConfig({
                ...config,
                emittente: { ...config.emittente, indirizzo: e.target.value.toUpperCase() } as EmittenteConfig
              })}
              placeholder="VIA ROMA"
            />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="emittente-civico">N. Civico</label>
            <input
              type="text"
              id="emittente-civico"
              className="input-field"
              value={config.emittente?.numeroCivico || ''}
              onChange={(e) => setConfig({
                ...config,
                emittente: { ...config.emittente, numeroCivico: e.target.value } as EmittenteConfig
              })}
              placeholder="1"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 80px', gap: 12 }}>
          <div className="input-group">
            <label className="input-label" htmlFor="emittente-cap">CAP</label>
            <input
              type="text"
              id="emittente-cap"
              className="input-field"
              value={config.emittente?.cap || ''}
              onChange={(e) => setConfig({
                ...config,
                emittente: { ...config.emittente, cap: e.target.value } as EmittenteConfig
              })}
              placeholder="00100"
              maxLength={5}
            />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="emittente-comune">Comune</label>
            <input
              type="text"
              id="emittente-comune"
              className="input-field"
              value={config.emittente?.comune || ''}
              onChange={(e) => setConfig({
                ...config,
                emittente: { ...config.emittente, comune: e.target.value.toUpperCase() } as EmittenteConfig
              })}
              placeholder="ROMA"
            />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="emittente-provincia">Prov.</label>
            <input
              type="text"
              id="emittente-provincia"
              className="input-field"
              value={config.emittente?.provincia || ''}
              onChange={(e) => setConfig({
                ...config,
                emittente: { ...config.emittente, provincia: e.target.value.toUpperCase() } as EmittenteConfig
              })}
              placeholder="RM"
              maxLength={2}
            />
          </div>
        </div>
      </div>

      {/* Valute */}
      <div className="card">
        <h2 className="card-title"><Coins size={16} aria-hidden="true" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Valute</h2>

        {(config.valute || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {(config.valute || []).map((v, i) => (
              <div key={`${v.codice}-${i}`} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: i === 0 ? 'rgba(4, 120, 87, 0.1)' : 'var(--bg-secondary)',
                borderRadius: 8,
                border: i === 0 ? '1px solid var(--accent-green)' : '1px solid var(--border)',
              }}>
                <span style={{ fontWeight: 600, minWidth: 24, textAlign: 'center' }}>{v.simbolo}</span>
                <span style={{ flex: 1 }}>{v.codice}</span>
                {i === 0 && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)', fontWeight: 500 }}>default</span>
                )}
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    aria-label={`Sposta ${v.codice} su`}
                    disabled={i === 0}
                    style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: i === 0 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: i === 0 ? 0.3 : 1 }}
                    onClick={() => {
                      const arr = [...(config.valute || [])];
                      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                      setConfig({ ...config, valute: arr });
                    }}
                  >
                    <ChevronUp size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Sposta ${v.codice} giù`}
                    disabled={i === (config.valute || []).length - 1}
                    style={{ background: 'none', border: 'none', cursor: i === (config.valute || []).length - 1 ? 'default' : 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: i === (config.valute || []).length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: i === (config.valute || []).length - 1 ? 0.3 : 1 }}
                    onClick={() => {
                      const arr = [...(config.valute || [])];
                      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                      setConfig({ ...config, valute: arr });
                    }}
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={`Rimuovi valuta ${v.codice}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', borderRadius: 4 }}
                  onClick={() => setConfig({ ...config, valute: (config.valute || []).filter((_, j) => j !== i) })}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label" htmlFor="nuova-valuta-codice">Codice ISO 4217</label>
            <input
              type="text"
              id="nuova-valuta-codice"
              className="input-field"
              value={newValuta.codice}
              onChange={(e) => setNewValuta({ ...newValuta, codice: e.target.value.toUpperCase() })}
              placeholder="Es: GBP"
              maxLength={3}
            />
          </div>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label" htmlFor="nuova-valuta-simbolo">Simbolo</label>
            <input
              type="text"
              id="nuova-valuta-simbolo"
              className="input-field"
              value={newValuta.simbolo}
              onChange={(e) => setNewValuta({ ...newValuta, simbolo: e.target.value })}
              placeholder="Es: £"
              maxLength={3}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ marginBottom: 16 }}
            onClick={() => {
              if (!newValuta.codice || !newValuta.simbolo) return;
              if ((config.valute || []).some(v => v.codice === newValuta.codice)) return;
              setConfig({ ...config, valute: [...(config.valute || []), { ...newValuta }] });
              setNewValuta({ codice: '', simbolo: '' });
            }}
            disabled={!newValuta.codice || !newValuta.simbolo}
            aria-label="Aggiungi valuta"
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
          La prima valuta è quella predefinita. Per fatture in valuta estera, il cambio BCE verrà richiesto in fase di generazione XML.
        </p>
      </div>

      {/* Clienti */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Clienti ({clienti.length})</h2>
          <button className="btn btn-primary" onClick={() => setShowModal('add-cliente')}><Plus size={18} aria-hidden="true" /> Aggiungi</button>
        </div>
        {clienti.length > 0 ? (
          <div className="table-wrapper" style={{ marginTop: 16 }}>
          <table className="table">
            <thead><tr><th scope="col">Nome</th><th scope="col">P.IVA</th><th scope="col">Email</th><th scope="col">Tariffa</th><th scope="col"></th></tr></thead>
            <tbody>
              {clienti.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: getClientDisplayColor(c), flexShrink: 0, display: 'inline-block' }} />
                      {c.nome}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'Space Mono' }}>{c.piva || '-'}</td>
                  <td>{c.email || '-'}</td>
                  <td>{c.rate && c.billingUnit ? `€${c.rate}/${c.billingUnit === 'ore' ? 'h' : 'gg'}` : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditingCliente({ ...c }); setShowModal('edit-cliente'); }} aria-label={`Modifica ${c.nome}`}><Edit size={16} aria-hidden="true" /></button>
                      <button className="btn btn-danger" onClick={() => removeCliente(c.id)} aria-label={`Elimina ${c.nome}`}><Trash2 size={16} aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : <div className="empty-state"><Users size={40} aria-hidden="true" /><p>Nessun cliente</p></div>}
      </div>

      {/* Aspetto */}
      <div className="card">
        <h2 className="card-title"><Palette size={16} aria-hidden="true" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Aspetto</h2>

        <div style={{ marginBottom: 20 }}>
          <label className="input-label">Modalità colore</label>
          <ThemeSwitch />
        </div>

        <div>
          <label className="input-label">Tema</label>
          <DesignStyleSwitch />
        </div>
      </div>

      {/* Sincronizzazione Cartella */}
      <div className="card">
        <h2 className="card-title"><FolderSync size={16} aria-hidden="true" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Sincronizzazione Cartella</h2>

        {showUnsupportedMessage && (
          <div className="backup-info" style={{ marginBottom: 16, borderColor: 'var(--accent-orange)' }}>
            <h2><AlertCircle size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} /> Browser non supportato</h2>
            <p>{getUnsupportedBrowserMessage()}</p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowUnsupportedMessage(false)}
              style={{ marginTop: 8 }}
            >
              Chiudi
            </button>
          </div>
        )}

        {syncFolderHandle && syncFolderName ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <FolderOpen size={20} style={{ color: 'var(--accent-green)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{syncFolderName}</div>
                {lastSyncTime && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Ultimo sync: {lastSyncTime.toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
            <div className="backup-section">
              <button
                className="btn btn-primary"
                onClick={syncToFolder}
                disabled={isSyncing}
              >
                <RefreshCw size={18} className={isSyncing ? 'spinning' : ''} aria-hidden="true" />
                {isSyncing ? 'Sincronizzazione...' : 'Sincronizza Ora'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleSelectSyncFolder}
              >
                <FolderOpen size={18} aria-hidden="true" /> Cambia Cartella
              </button>
              <button
                className="btn btn-danger"
                onClick={handleRemoveSyncFolder}
              >
                <X size={18} aria-hidden="true" /> Rimuovi
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              Seleziona una cartella sincronizzata (Dropbox, iCloud Drive, Google Drive) per mantenere i dati aggiornati su tutti i dispositivi.
            </p>
            <button className="btn btn-primary" onClick={handleSelectSyncFolder}>
              <FolderOpen size={18} aria-hidden="true" /> Seleziona Cartella
            </button>
          </>
        )}

        <div className="backup-info" style={{ marginTop: 16 }}>
          <h2>ℹ️ Come funziona</h2>
          <p>I dati vengono salvati in un file JSON nella cartella selezionata. Se la cartella è sincronizzata da un servizio cloud, i dati saranno disponibili su tutti i dispositivi che puntano alla stessa cartella.</p>
        </div>
      </div>
    </>
  );
}
