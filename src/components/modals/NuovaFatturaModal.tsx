import { useState, useMemo, useRef } from 'react';
import { X, Download, Plus, Trash2, AlertTriangle, Upload, RefreshCw } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import { useDialog } from '../../hooks/useDialog';
import { generateFatturaXML, downloadXML, generateFileName, parseFatturaXMLForEdit } from '../../lib/xml/generator';
import { getECBRate, convertToEUR } from '../../lib/utils/ecbRates';
import type { NuovaFatturaRiga } from '../../types';

interface NuovaFatturaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NuovaFatturaModal({ isOpen, onClose }: NuovaFatturaModalProps) {
  const { config, clienti, fatture, showToast, addFattura, addCliente } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Valute configurate
  const valute = config.valute?.length ? config.valute : [{ codice: 'EUR', simbolo: '€' }];

  // Form state
  const [clienteId, setClienteId] = useState<string>('');
  const [numero, setNumero] = useState<string>('');
  const [data, setData] = useState<string>(new Date().toISOString().split('T')[0]);
  const [valutaSelezionata, setValutaSelezionata] = useState<string>(valute[0].codice);
  const [tassoCambio, setTassoCambio] = useState<string>('');
  const [dataCambio, setDataCambio] = useState<string>('');
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [righe, setRighe] = useState<NuovaFatturaRiga[]>([
    { descrizione: '', quantita: 1, prezzoUnitario: 0 }
  ]);

  const isMultiCurrency = valutaSelezionata !== 'EUR';
  const tassoCambioNum = parseFloat(tassoCambio) || 0;

  const fetchExchangeRate = async () => {
    setIsFetchingRate(true);
    try {
      const result = await getECBRate(valutaSelezionata);
      if (result) {
        setTassoCambio(result.rate.toString());
        setDataCambio(result.date);
        showToast(`Cambio BCE ${result.date}: 1 EUR = ${result.rate} ${valutaSelezionata}`);
      } else {
        showToast(`Tasso non disponibile per ${valutaSelezionata}`, 'error');
      }
    } catch {
      showToast('Errore nel recupero del cambio BCE', 'error');
    }
    setIsFetchingRate(false);
  };

  // Cliente personalizzato (se non in lista)
  const [clienteCustom, setClienteCustom] = useState({
    denominazione: '',
    partitaIva: '',
    nazione: 'IT',
    indirizzo: '',
    cap: '',
    comune: '',
  });
  const [useCustomCliente, setUseCustomCliente] = useState(false);
  const [aggiungiAFatture, setAggiungiAFatture] = useState(true);

  // Calcola prossimo numero fattura
  const prossimoNumero = useMemo(() => {
    const annoCorrente = new Date().getFullYear();
    const fattureAnno = fatture.filter(f => {
      const anno = new Date(f.data).getFullYear();
      return anno === annoCorrente;
    });

    // Trova il numero più alto
    let maxNumero = 0;
    fattureAnno.forEach(f => {
      const num = parseInt(f.numero || '0', 10);
      if (!isNaN(num) && num > maxNumero) {
        maxNumero = num;
      }
    });

    return String(maxNumero + 1).padStart(2, '0');
  }, [fatture]);

  // Inizializza numero suggerito
  useState(() => {
    if (!numero) {
      setNumero(prossimoNumero);
    }
  });

  // Calcoli
  const totaleImponibile = useMemo(() => {
    return righe.reduce((sum, r) => sum + (r.quantita * r.prezzoUnitario), 0);
  }, [righe]);

  const totaleImponibileEUR = isMultiCurrency && tassoCambioNum > 0
    ? convertToEUR(totaleImponibile, tassoCambioNum)
    : totaleImponibile;
  const bolloImporto = totaleImponibileEUR > 77.47 ? 2.00 : 0;
  const totaleDocumento = totaleImponibile;
  const simboloValuta = (valute.find(v => v.codice === valutaSelezionata) || valute[0]).simbolo;

  // Warning data passata
  const isDataPassata = useMemo(() => {
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    const dataFattura = new Date(data);
    dataFattura.setHours(0, 0, 0, 0);
    return dataFattura < oggi;
  }, [data]);

  // Gestione righe
  const addRiga = () => {
    setRighe([...righe, { descrizione: '', quantita: 1, prezzoUnitario: 0 }]);
  };

  const removeRiga = (index: number) => {
    if (righe.length > 1) {
      setRighe(righe.filter((_, i) => i !== index));
    }
  };

  const updateRiga = (index: number, updates: Partial<NuovaFatturaRiga>) => {
    const newRighe = [...righe];
    newRighe[index] = { ...newRighe[index], ...updates };
    setRighe(newRighe);
  };

  // Carica fattura esistente
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const parsed = parseFatturaXMLForEdit(content);

      if (!parsed) {
        showToast('Errore nel parsing del file XML', 'error');
        return;
      }

      // Popola i campi
      setNumero(parsed.numero);
      setData(parsed.data);
      setRighe(parsed.righe);

      // Cerca cliente esistente per P.IVA
      const clienteEsistente = clienti.find(c =>
        c.piva === parsed.cliente.partitaIva
      );

      if (clienteEsistente) {
        setClienteId(clienteEsistente.id);
        setUseCustomCliente(false);
      } else {
        // Usa cliente custom
        setUseCustomCliente(true);
        setClienteCustom({
          denominazione: parsed.cliente.denominazione || `${parsed.cliente.nome || ''} ${parsed.cliente.cognome || ''}`.trim(),
          partitaIva: parsed.cliente.partitaIva || '',
          nazione: parsed.cliente.nazione,
          indirizzo: parsed.cliente.indirizzo || '',
          cap: parsed.cliente.cap || '',
          comune: parsed.cliente.comune || '',
        });
      }

      showToast('Fattura caricata!');
    } catch (error) {
      showToast('Errore lettura file', 'error');
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Genera XML
  const handleGenerate = async () => {
    // Validazione emittente
    if (!config.emittente?.codiceFiscale || !config.partitaIva) {
      showToast('Configura i dati emittente nelle Impostazioni', 'error');
      return;
    }

    // Validazione cliente
    if (!useCustomCliente && !clienteId) {
      showToast('Seleziona un cliente', 'error');
      return;
    }

    if (useCustomCliente && !clienteCustom.denominazione) {
      showToast('Inserisci il nome del cliente', 'error');
      return;
    }

    // Validazione numero
    if (!numero) {
      showToast('Inserisci il numero fattura', 'error');
      return;
    }

    // Validazione righe
    const righeValide = righe.filter(r => r.descrizione && r.prezzoUnitario > 0);
    if (righeValide.length === 0) {
      showToast('Aggiungi almeno una riga con descrizione e prezzo', 'error');
      return;
    }

    // Prepara dati cliente
    let clienteData;
    if (useCustomCliente) {
      clienteData = {
        denominazione: clienteCustom.denominazione,
        partitaIva: clienteCustom.partitaIva,
        nazione: clienteCustom.nazione,
        indirizzo: clienteCustom.indirizzo,
        cap: clienteCustom.cap,
        comune: clienteCustom.comune,
      };
    } else {
      const cliente = clienti.find(c => c.id === clienteId);
      if (!cliente) {
        showToast('Cliente non trovato', 'error');
        return;
      }
      clienteData = {
        denominazione: cliente.nome,
        partitaIva: cliente.piva,
        nazione: cliente.nazione || 'IT',
        indirizzo: cliente.indirizzo,
        numeroCivico: cliente.numeroCivico,
        cap: cliente.cap,
        comune: cliente.comune,
        provincia: cliente.provincia,
      };
    }

    // Validazione cambio per valuta estera
    if (isMultiCurrency && tassoCambioNum <= 0) {
      showToast('Inserisci il tasso di cambio BCE per la valuta estera', 'error');
      return;
    }

    // Genera XML (importi convertiti in EUR internamente dal generator)
    const xml = generateFatturaXML({
      emittente: config.emittente,
      partitaIva: config.partitaIva,
      cliente: clienteData,
      numero,
      data,
      righe: righeValide,
      iban: config.iban,
      beneficiario: `${config.emittente.nome} ${config.emittente.cognome}`,
      valuta: isMultiCurrency ? valutaSelezionata : undefined,
      tassoCambio: isMultiCurrency ? tassoCambioNum : undefined,
      dataCambio: isMultiCurrency ? dataCambio || data : undefined,
    });

    // Genera nome file e scarica
    const progressivo = Math.random().toString(36).substring(2, 7).toUpperCase();
    const filename = generateFileName(config.partitaIva, progressivo);
    downloadXML(xml, filename);

    // Aggiungi alle fatture se checkbox attiva
    if (aggiungiAFatture) {
      // Se cliente custom, crealo prima
      let finalClienteId = clienteId;
      let finalClienteNome = '';

      if (useCustomCliente) {
        const nuovoCliente = {
          id: Date.now().toString(),
          nome: clienteCustom.denominazione,
          piva: clienteCustom.partitaIva,
          email: '',
          indirizzo: clienteCustom.indirizzo,
          cap: clienteCustom.cap,
          comune: clienteCustom.comune,
          nazione: clienteCustom.nazione,
        };
        await addCliente(nuovoCliente);
        finalClienteId = nuovoCliente.id;
        finalClienteNome = nuovoCliente.nome;
      } else {
        const cliente = clienti.find(c => c.id === clienteId);
        finalClienteNome = cliente?.nome || '';
      }

      const valutaCorrente = valute.find(v => v.codice === valutaSelezionata) || valute[0];
      const nuovaFattura = {
        id: Date.now().toString(),
        numero,
        importo: isMultiCurrency ? Math.round(totaleImponibileEUR * 100) / 100 : totaleImponibile, // Always EUR for tax
        ...(isMultiCurrency ? { importoValuta: totaleImponibile } : {}),
        data,
        dataIncasso: data,
        clienteId: finalClienteId,
        clienteNome: finalClienteNome,
        duplicateKey: `${numero}-${data}-${totaleImponibile}`,
        valuta: valutaCorrente.codice,
        valutaSimbolo: valutaCorrente.simbolo,
        ...(isMultiCurrency ? { tassoCambio: tassoCambioNum } : {}),
      };

      await addFattura(nuovaFattura);
      showToast('Fattura XML generata e aggiunta!');
    } else {
      showToast('Fattura XML generata!');
    }

    onClose();
  };

  // Reset form quando si chiude
  const handleClose = () => {
    setClienteId('');
    setNumero(prossimoNumero);
    setData(new Date().toISOString().split('T')[0]);
    setRighe([{ descrizione: '', quantita: 1, prezzoUnitario: 0 }]);
    setValutaSelezionata(valute[0].codice);
    setTassoCambio('');
    setDataCambio('');
    setUseCustomCliente(false);
    setClienteCustom({
      denominazione: '',
      partitaIva: '',
      nazione: 'IT',
      indirizzo: '',
      cap: '',
      comune: '',
    });
    setAggiungiAFatture(true);
    onClose();
  };

  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, handleClose);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onClose={handleClose}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      aria-labelledby="nuova-fattura-title"
      style={{ maxWidth: 700 }}
    >
        <div className="modal-header">
          <h3 id="nuova-fattura-title" className="modal-title">Nuova Fattura XML</h3>
          <button className="close-btn" onClick={handleClose} aria-label="Chiudi">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Upload fattura esistente */}
        <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Upload size={18} aria-hidden="true" />
            <span style={{ color: 'var(--text-secondary)' }}>Carica fattura esistente da modificare</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* Warning emittente non configurato */}
        {(!config.emittente?.codiceFiscale || !config.partitaIva) && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            background: 'rgba(245, 158, 11, 0.15)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <AlertTriangle size={18} style={{ color: 'var(--accent-orange)' }} />
            <span style={{ color: 'var(--accent-orange)', fontSize: '0.9rem' }}>
              Configura i dati emittente nelle Impostazioni prima di generare fatture
            </span>
          </div>
        )}

        {/* Cliente */}
        <div className="input-group">
          <label className="input-label">Cliente *</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                checked={!useCustomCliente}
                onChange={() => setUseCustomCliente(false)}
              />
              <span>Da lista</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                checked={useCustomCliente}
                onChange={() => setUseCustomCliente(true)}
              />
              <span>Personalizzato</span>
            </label>
          </div>

          {!useCustomCliente ? (
            <select
              className="input-field"
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
            >
              <option value="">Seleziona cliente...</option>
              {clienti.map(c => (
                <option key={c.id} value={c.id}>{c.nome} {c.piva ? `(${c.piva})` : ''}</option>
              ))}
            </select>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="text"
                className="input-field"
                placeholder="Nome / Ragione Sociale *"
                value={clienteCustom.denominazione}
                onChange={(e) => setClienteCustom({ ...clienteCustom, denominazione: e.target.value })}
              />
              <div className="grid-2">
                <input
                  type="text"
                  className="input-field"
                  placeholder="P.IVA"
                  value={clienteCustom.partitaIva}
                  onChange={(e) => setClienteCustom({ ...clienteCustom, partitaIva: e.target.value })}
                />
                <input
                  type="text"
                  className="input-field"
                  placeholder="Nazione (es. IT, DE)"
                  value={clienteCustom.nazione}
                  onChange={(e) => setClienteCustom({ ...clienteCustom, nazione: e.target.value.toUpperCase() })}
                  maxLength={2}
                />
              </div>
              <input
                type="text"
                className="input-field"
                placeholder="Indirizzo"
                value={clienteCustom.indirizzo}
                onChange={(e) => setClienteCustom({ ...clienteCustom, indirizzo: e.target.value })}
              />
              <div className="grid-2">
                <input
                  type="text"
                  className="input-field"
                  placeholder="CAP"
                  value={clienteCustom.cap}
                  onChange={(e) => setClienteCustom({ ...clienteCustom, cap: e.target.value })}
                />
                <input
                  type="text"
                  className="input-field"
                  placeholder="Comune"
                  value={clienteCustom.comune}
                  onChange={(e) => setClienteCustom({ ...clienteCustom, comune: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Numero, Data e Valuta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12 }}>
          <div className="input-group">
            <label className="input-label">Numero Fattura *</label>
            <input
              type="text"
              className="input-field"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder={prossimoNumero}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Data Emissione/Pagamento *</label>
            <input
              type="date"
              className="input-field"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>
          {valute.length > 1 && (
            <div className="input-group">
              <label className="input-label">Valuta</label>
              <select
                className="input-field"
                value={valutaSelezionata}
                onChange={(e) => setValutaSelezionata(e.target.value)}
              >
                {valute.map(v => (
                  <option key={v.codice} value={v.codice}>{v.simbolo} {v.codice}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Tasso di cambio BCE (solo per valuta estera) */}
        {isMultiCurrency && (
          <div style={{
            marginBottom: 16,
            padding: 16,
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="input-label">Cambio BCE (1 EUR = ? {valutaSelezionata}) *</label>
                <input
                  type="number"
                  className="input-field"
                  value={tassoCambio}
                  onChange={(e) => setTassoCambio(e.target.value)}
                  placeholder="Es: 0.835"
                  step="0.0001"
                  min="0"
                  style={{ fontFamily: 'Space Mono' }}
                />
              </div>
              <button
                className="btn btn-secondary"
                onClick={fetchExchangeRate}
                disabled={isFetchingRate}
                title="Recupera ultimo cambio BCE"
                style={{ marginBottom: 0, whiteSpace: 'nowrap' }}
              >
                <RefreshCw size={16} className={isFetchingRate ? 'spinning' : ''} aria-hidden="true" />
                {isFetchingRate ? 'Carico...' : 'Cambio BCE'}
              </button>
            </div>
            {dataCambio && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>
                Tasso del {dataCambio}
              </div>
            )}
            {tassoCambioNum > 0 && totaleImponibile > 0 && (
              <div style={{
                marginTop: 10,
                padding: '8px 12px',
                background: 'var(--bg-primary)',
                borderRadius: 6,
                fontSize: '0.9rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>Controvalore EUR:</span>
                <span style={{ fontFamily: 'Space Mono', fontWeight: 600, color: 'var(--accent-green)' }}>
                  €{totaleImponibileEUR.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Warning data passata */}
        {isDataPassata && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            background: 'rgba(245, 158, 11, 0.15)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <AlertTriangle size={18} style={{ color: 'var(--accent-orange)' }} />
            <span style={{ color: 'var(--accent-orange)', fontSize: '0.9rem' }}>
              Attenzione: la data selezionata è nel passato
            </span>
          </div>
        )}

        {/* Righe fattura */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label className="input-label" style={{ margin: 0 }}>Righe Fattura</label>
            <button className="btn btn-secondary btn-sm" onClick={addRiga}>
              <Plus size={16} aria-hidden="true" /> Aggiungi
            </button>
          </div>

          {righe.map((riga, index) => (
            <div
              key={index}
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Riga {index + 1}</span>
                {righe.length > 1 && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeRiga(index)}
                    style={{ padding: '4px 8px' }}
                    aria-label={`Rimuovi riga ${index + 1}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              <input
                type="text"
                className="input-field"
                placeholder="Descrizione *"
                value={riga.descrizione}
                onChange={(e) => updateRiga(index, { descrizione: e.target.value })}
                style={{ marginBottom: 8 }}
              />
              <div className="grid-2">
                <input
                  type="number"
                  className="input-field"
                  placeholder="Quantità"
                  value={riga.quantita || ''}
                  onChange={(e) => updateRiga(index, { quantita: parseFloat(e.target.value) || 0 })}
                  step="0.01"
                  min="0"
                />
                <input
                  type="number"
                  className="input-field"
                  placeholder="Prezzo Unitario"
                  value={riga.prezzoUnitario || ''}
                  onChange={(e) => updateRiga(index, { prezzoUnitario: parseFloat(e.target.value) || 0 })}
                  step="0.01"
                  min="0"
                />
              </div>
              <div style={{ textAlign: 'right', marginTop: 4, fontFamily: 'Space Mono', fontSize: '0.9rem' }}>
                Totale riga: {simboloValuta}{(riga.quantita * riga.prezzoUnitario).toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        {/* Riepilogo */}
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span>Imponibile:</span>
            <span style={{ fontFamily: 'Space Mono' }}>{simboloValuta}{totaleImponibile.toFixed(2)}</span>
          </div>
          {bolloImporto > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, color: 'var(--text-muted)' }}>
              <span>Bollo virtuale:</span>
              <span style={{ fontFamily: 'Space Mono' }}>€{bolloImporto.toFixed(2)}</span>
            </div>
          )}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontWeight: 600,
            fontSize: '1.1rem',
            paddingTop: 8,
            borderTop: '1px solid var(--border)',
          }}>
            <span>Totale Documento:</span>
            <span style={{ fontFamily: 'Space Mono', color: 'var(--accent-green)' }}>
              {simboloValuta}{totaleDocumento.toFixed(2)}
            </span>
          </div>
          {isMultiCurrency && tassoCambioNum > 0 && totaleImponibile > 0 && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 8,
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
            }}>
              <span>Controvalore EUR (per SDI):</span>
              <span style={{ fontFamily: 'Space Mono' }}>€{totaleImponibileEUR.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Checkbox aggiungi a fatture */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          cursor: 'pointer',
          padding: 12,
          background: 'var(--bg-secondary)',
          borderRadius: 8,
        }}>
          <input
            type="checkbox"
            checked={aggiungiAFatture}
            onChange={(e) => setAggiungiAFatture(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: 'var(--accent-green)' }}
          />
          <span style={{ color: 'var(--text-secondary)' }}>Aggiungi alla lista fatture dopo la generazione</span>
        </label>

        <button
          className="btn btn-success"
          style={{ width: '100%' }}
          onClick={handleGenerate}
          disabled={!config.emittente?.codiceFiscale || !config.partitaIva}
        >
          <Download size={18} aria-hidden="true" /> Genera XML
        </button>
    </dialog>
  );
}
