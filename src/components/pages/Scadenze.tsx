import { CassaWarning } from '../shared/CassaWarning';
import { useState, useMemo, useEffect } from 'react';
import { CalendarClock, Euro, Percent, Info, Save, RefreshCw, Check } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import { calcolaFiscale } from '../../lib/utils/calculations';
import { getCassaWarning, calcolaAccontiForfettario, calcolaContributiPrevidenziali, calcolaCoefficienteMedioAteco, getAliquotaImpostaSostitutiva, getInpsCalculationInput, includeInpsInScadenze, usesFixedContributiPrevidenziali } from '../../lib/utils/forfettario';
import { generatePaymentSchedule, calculateScheduleTotals } from '../../lib/utils/paymentScheduler';
import { parseDateLocal, formatDateLong, formatDate, isIsoDate } from '../../lib/utils/dateHelpers';
import { risolviDeduzioneInps, stimaVersamentiInps } from '../../lib/utils/deduzioneInps';
import { accontiUsatiDalPiano, rigeneraPreservandoPagate } from '../../lib/utils/rigeneraScadenze';
import { convertScheduleToScadenze } from '../../lib/utils/scheduleToScadenze';
import { DeduzioneInpsInfo } from '../shared/DeduzioneInps';
import { parseOptionalContribution, parseCurrency, formatCurrency } from '../../lib/utils/formatting';
import { Currency } from '../ui/Currency';
import type { PaymentScheduleInput, PaymentScheduleItem, Scadenza, ScadenzaTipo } from '../../types';

type NumberOfTranches = 1 | 2 | 3 | 4 | 5 | 6;

export function Scadenze() {
  const { config, updateConfig, fatture, scadenze, getScadenzeByYear, getPaidAccontiForYear, bulkSaveScadenze, removeScadenza, removeScadenzeByYear, updateScadenza, showToast } = useApp();

  const annoCorrente = new Date().getFullYear();
  const [annoRiferimento, setAnnoRiferimento] = useState(annoCorrente - 1);
  const [numberOfTranches, setNumberOfTranches] = useState<NumberOfTranches>(1);
  
  const [manualFatturato, setManualFatturato] = useState<string>('');
  const [useManualFatturato, setUseManualFatturato] = useState(false);
  
  const [manualAccontiIrpef, setManualAccontiIrpef] = useState<string>('');
  const [manualAccontiInps, setManualAccontiInps] = useState<string>('');
  const [useManualAcconti, setUseManualAcconti] = useState(false);
  
  const [manualContributiVersati, setManualContributiVersati] = useState<string>('');

  useEffect(() => { setManualContributiVersati(''); }, [annoRiferimento, config.gestionePrevidenziale, config.cassaOrdinistica]);

  const annoVersamento = annoRiferimento + 1;
  const savedScadenze = getScadenzeByYear(annoVersamento);
  const hasSavedScadenze = savedScadenze.length > 0;

  const paidAccontiFromDb = getPaidAccontiForYear(annoRiferimento);

  const savedAccontiFromScadenze = useMemo(() => accontiUsatiDalPiano(savedScadenze), [savedScadenze]);

  useEffect(() => {
    if (!useManualAcconti) {
      if (savedAccontiFromScadenze) {
        setManualAccontiIrpef(savedAccontiFromScadenze.irpef > 0 ? savedAccontiFromScadenze.irpef.toString() : '');
        setManualAccontiInps(savedAccontiFromScadenze.inps > 0 ? savedAccontiFromScadenze.inps.toString() : '');
      } else {
        setManualAccontiIrpef(paidAccontiFromDb.irpefPaid > 0 ? paidAccontiFromDb.irpefPaid.toString() : '');
        setManualAccontiInps(paidAccontiFromDb.inpsPaid > 0 ? paidAccontiFromDb.inpsPaid.toString() : '');
      }
    }
  }, [paidAccontiFromDb.irpefPaid, paidAccontiFromDb.inpsPaid, useManualAcconti, annoRiferimento, savedAccontiFromScadenze]);

  const aliquotaIrpef = getAliquotaImpostaSostitutiva({
    annoApertura: config.annoApertura,
    annoImposta: annoRiferimento,
    aliquotaOverride: config.aliquotaOverride,
  });

  const coefficienteMedio = useMemo(() => {
    return calcolaCoefficienteMedioAteco(config.codiciAteco);
  }, [config.codiciAteco]);

  const fattureAnnoRiferimento = useMemo(() => {
    return fatture.filter(f => {
      if (f.incassato === false) return false;
      const dataRiferimento = f.dataIncasso || f.data;
      return new Date(dataRiferimento).getFullYear() === annoRiferimento;
    });
  }, [fatture, annoRiferimento]);

  const fatturatoFromRecords = fattureAnnoRiferimento.reduce((sum, f) => sum + f.importo, 0);
  const parsedManualFatturato = parseCurrency(manualFatturato);
  const totaleFatturato = useManualFatturato ? parsedManualFatturato : fatturatoFromRecords;
  
  const parsedAccontiIrpef = parseCurrency(manualAccontiIrpef);
  const parsedAccontiInps = parseCurrency(manualAccontiInps);
  // Casse professionali: importo deducibile inserito qui per la sola stima, come prima.
  // INPS: deduzione per cassa (o previsionale) condivisa con Dashboard e Simulatore.
  const isCassaProfessionale = config.gestionePrevidenziale === 'cassa_ordinistica';
  const contributiInput = isCassaProfessionale ? parseOptionalContribution(manualContributiVersati) : { amount: undefined, invalid: false };
  const deduzioneInps = risolviDeduzioneInps(config, annoRiferimento, scadenze);
  const stimaVersamenti = useMemo(() => stimaVersamentiInps(config, annoRiferimento, fatture, scadenze), [config, annoRiferimento, fatture, scadenze]);

  const fiscale = calcolaFiscale(totaleFatturato, coefficienteMedio, aliquotaIrpef, getInpsCalculationInput(config, annoRiferimento), isCassaProfessionale ? contributiInput.amount : deduzioneInps.contributiVersati);
  const redditoImponibile = fiscale.imponibile;
  const irpefTotale = fiscale.irpef;
  const inpsTotale = fiscale.inps;
  const previdenzialeInfo = calcolaContributiPrevidenziali(redditoImponibile, config, annoRiferimento);
  const includeInpsSchedule = includeInpsInScadenze(config.gestionePrevidenziale);
  const usesFixedInps = usesFixedContributiPrevidenziali(config.gestionePrevidenziale);

  const taxAmounts = useMemo(() => {
    return calcolaAccontiForfettario({
      gestionePrevidenziale: config.gestionePrevidenziale,
      impostaSostitutiva: irpefTotale,
      inps: inpsTotale,
      accontiImpostaPagati: parsedAccontiIrpef,
      accontiInpsPagati: parsedAccontiInps,
    });
  }, [config.gestionePrevidenziale, irpefTotale, inpsTotale, parsedAccontiIrpef, parsedAccontiInps]);

  const scheduleInput: PaymentScheduleInput = useMemo(() => ({
    totalTaxSaldo: taxAmounts.taxSaldo,
    totalTax1stAcconto: taxAmounts.tax1stAcconto,
    totalTax2ndAcconto: taxAmounts.tax2ndAcconto,
    totalInpsSaldo: includeInpsSchedule ? taxAmounts.inpsSaldo : 0,
    totalInps1stAcconto: includeInpsSchedule ? taxAmounts.inps1stAcconto : 0,
    totalInps2ndAcconto: includeInpsSchedule ? taxAmounts.inps2ndAcconto : 0,
    numberOfTranches,
    fiscalYear: annoVersamento,
  }), [taxAmounts, numberOfTranches, annoVersamento, includeInpsSchedule]);

  const schedule = useMemo(() => generatePaymentSchedule(scheduleInput), [scheduleInput]);
  const totals = useMemo(() => calculateScheduleTotals(schedule), [schedule]);
  // Con un piano salvato i riepiloghi seguono le scadenze registrate (rate pagate
  // comprese), non il piano ipotetico ricalcolato dai dati attuali.
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const savedTotals = useMemo(() => {
    const totalPrincipal = round2(savedScadenze.reduce((sum, s) => sum + s.importo, 0));
    const totalInterest = round2(savedScadenze.reduce((sum, s) => sum + s.interessi, 0));
    return { totalPrincipal, totalInterest, grandTotal: round2(totalPrincipal + totalInterest) };
  }, [savedScadenze]);
  const shownTotals = hasSavedScadenze ? savedTotals : totals;
  const previewDiffers = hasSavedScadenze && (savedTotals.totalPrincipal !== totals.totalPrincipal || savedTotals.totalInterest !== totals.totalInterest);

  const isUpcoming = (dateStr: string) => {
    const date = parseDateLocal(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return date >= today && date <= thirtyDaysFromNow;
  };

  const isPast = (dateStr: string) => {
    const date = parseDateLocal(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const handleSaveScadenze = async () => {
    if (contributiInput.invalid || getCassaWarning(config, annoRiferimento)) {
      showToast(contributiInput.invalid ? 'Correggi l’importo dei contributi versati prima di salvare.' : 'Completa i contributi della cassa per l’anno selezionato in Impostazioni.', 'error');
      return;
    }
    try {
      const newScadenze = convertScheduleToScadenze(schedule, { annoRiferimento, annoVersamento, accontiIrpef: parsedAccontiIrpef, accontiInps: parsedAccontiInps });
      await removeScadenzeByYear(annoVersamento);
      await bulkSaveScadenze(newScadenze);
      showToast(`Scadenze ${annoVersamento} salvate!`);
    } catch (error) {
      showToast('Errore salvataggio scadenze', 'error');
    }
  };

  const handleRegenerateScadenze = async () => {
    if (contributiInput.invalid || getCassaWarning(config, annoRiferimento)) {
      showToast(contributiInput.invalid ? 'Correggi l’importo dei contributi versati prima di salvare.' : 'Completa i contributi della cassa per l’anno selezionato in Impostazioni.', 'error');
      return;
    }
    try {
      // Le scadenze pagate non si eliminano né si ricalcolano: sono versamenti
      // avvenuti e alimentano la deduzione per cassa.
      const piano = rigeneraPreservandoPagate(
        savedScadenze,
        convertScheduleToScadenze(schedule, { annoRiferimento, annoVersamento, accontiIrpef: parsedAccontiIrpef, accontiInps: parsedAccontiInps }),
        { accontiIrpefUsed: parsedAccontiIrpef, accontiInpsUsed: parsedAccontiInps },
      );
      if (piano.blocchi.length > 0) {
        showToast(`Rigenerazione annullata, nessuna scadenza modificata. ${piano.blocchi.join(' ')}`, 'error');
        return;
      }
      for (const id of piano.daEliminare) await removeScadenza(id);
      await bulkSaveScadenze(piano.daSalvare);
      for (const pagata of piano.pagateDaAggiornare) await updateScadenza(pagata);
      if (piano.avvisi.length > 0) showToast(`Scadenze ${annoVersamento} rigenerate, rate pagate invariate. ${piano.avvisi.join(' ')}`, 'error');
      else showToast(`Scadenze ${annoVersamento} rigenerate, rate pagate invariate.`);
    } catch (error) {
      showToast('Errore rigenerazione scadenze', 'error');
    }
  };

  const handleTogglePaid = async (scadenza: Scadenza) => {
    try {
      const updated: Scadenza = {
        ...scadenza,
        pagato: !scadenza.pagato,
        dataPagamento: !scadenza.pagato ? formatDate(new Date()) : undefined,
      };
      await updateScadenza(updated);
    } catch (error) {
      showToast('Errore aggiornamento scadenza', 'error');
    }
  };

  // Data effettiva del versamento: decide l'anno della deduzione per cassa.
  const handleChangeDataPagamento = async (scadenza: Scadenza, value: string) => {
    if (!isIsoDate(value) || value === scadenza.dataPagamento) return;
    try {
      await updateScadenza({ ...scadenza, dataPagamento: value });
    } catch (error) {
      showToast('Errore aggiornamento data di pagamento', 'error');
    }
  };

  const displayScadenze = hasSavedScadenze ? savedScadenze : [];
  const groupedByDate = displayScadenze.reduce((acc, s) => {
    if (!acc[s.date]) acc[s.date] = [];
    acc[s.date].push(s);
    return acc;
  }, {} as Record<string, Scadenza[]>);

  const sortedDates = Object.keys(groupedByDate).sort();

  const getTipoColor = (tipo: ScadenzaTipo) => {
    switch (tipo) {
      case 'saldo_irpef':
      case 'acconto_irpef':
        return 'var(--accent-orange)';
      case 'saldo_inps':
      case 'acconto_inps':
        return 'var(--accent-primary)';
    }
  };

  return (
    <>
      <CassaWarning config={config} anno={annoRiferimento} />
      <div className="page-header">
        <h1 className="page-title">Scadenze Fiscali</h1>
        <p className="page-subtitle">Piano dei pagamenti per tasse e contributi</p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="card-title">Configurazione</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Anno di riferimento (fatturato)
            </label>
            <select
              className="input-field"
              value={annoRiferimento}
              onChange={(e) => setAnnoRiferimento(parseInt(e.target.value))}
              style={{ width: '100%' }}
            >
              {Array.from({ length: 5 }, (_, i) => {
                const year = annoCorrente - i;
                const hasScadenze = scadenze.some(s => s.annoRiferimento === year);
                return <option key={year} value={year}>{year} {hasScadenze ? '✓' : ''}</option>;
              })}
            </select>
          </div>

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Numero di rate (saldo + 1° acconto)
            </label>
            <select
              className="input-field"
              value={numberOfTranches}
              onChange={(e) => setNumberOfTranches(parseInt(e.target.value) as NumberOfTranches)}
              style={{ width: '100%' }}
            >
              <option value={1}>1 rata (unica soluzione)</option>
              <option value={2}>2 rate</option>
              <option value={3}>3 rate</option>
              <option value={4}>4 rate</option>
              <option value={5}>5 rate</option>
              <option value={6}>6 rate</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 20, padding: '16px', background: 'var(--bg-secondary)', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useManualFatturato}
                onChange={(e) => setUseManualFatturato(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Inserisci fatturato manualmente
              </span>
            </label>
            {!useManualFatturato && fatturatoFromRecords > 0 && (
              <span style={{ fontSize: '0.8rem', color: 'var(--accent-green)' }}>
                (da {fattureAnnoRiferimento.length} fatture registrate)
              </span>
            )}
          </div>
          
          {useManualFatturato && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Fatturato {annoRiferimento}
              </label>
              <div style={{ position: 'relative', maxWidth: 250 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>€</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field"
                  placeholder="es. 50000"
                  value={manualFatturato}
                  onChange={(e) => setManualFatturato(e.target.value)}
                  style={{ paddingLeft: 32, fontFamily: 'Space Mono, monospace' }}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Fatturato {annoRiferimento}: </span>
              <strong style={{ color: useManualFatturato ? 'var(--accent-primary)' : 'var(--text-primary)' }}><Currency amount={totaleFatturato} /></strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Imponibile: </span>
              <strong><Currency amount={redditoImponibile} /></strong>
              <span style={{ color: 'var(--text-muted)' }}> ({coefficienteMedio}%)</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Imposta sostitutiva dovuta: </span>
              <strong><Currency amount={irpefTotale} /></strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Contributi dovuti: </span>
              <strong><Currency amount={inpsTotale} /></strong>
              <span style={{ color: 'var(--text-muted)' }}> ({previdenzialeInfo.label}{previdenzialeInfo.reductionApplied ? ' · riduzione 35%' : ''})</span>
            </div>
          </div>

          {isCassaProfessionale ? (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 250px' }}>
                <label htmlFor="contributi-versati-input" style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Contributi deducibili versati nel {annoRiferimento}
                </label>
                <div style={{ position: 'relative', maxWidth: 250 }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>€</span>
                  <input
                    id="contributi-versati-input"
                    type="text"
                    inputMode="decimal"
                    className="input-field"
                    placeholder="0"
                    aria-invalid={contributiInput.invalid}
                    aria-describedby={contributiInput.invalid ? "contributi-versati-errore" : undefined}
                    value={manualContributiVersati}
                    onChange={(e) => setManualContributiVersati(e.target.value)}
                    style={{ paddingLeft: 32, fontFamily: 'Space Mono, monospace' }}
                  />
                </div>
              </div>
              <div style={{ flex: '1 1 250px', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Importo deducibile effettivamente pagato durante l'anno {annoRiferimento} (per cassa).
                Viene dedotto dall'imponibile per calcolare l'imposta sostitutiva.
                {contributiInput.invalid && <p id="contributi-versati-errore" role="alert">Inserisci un importo valido, per esempio 1.000,50. Finché non lo correggi, la stima usa la deduzione configurata.</p>}
                {contributiInput.amount === undefined && (
                  <span style={{ display: 'block', marginTop: 4, color: 'var(--accent-orange)' }}>
                    Se non specificato, si usa la quota deducibile configurata in Impostazioni.
                  </span>
                )}
              </div>
            </div>
          </div>
          ) : (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <DeduzioneInpsInfo config={config} anno={annoRiferimento} deduzione={deduzioneInps} importoDedotto={fiscale.deduzioneContributi} updateConfig={updateConfig} stima={stimaVersamenti} />
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="card-title">Versamenti già registrati (anno precedente)</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          {paidAccontiFromDb.irpefPaid > 0 || paidAccontiFromDb.inpsPaid > 0 
            ? 'Acconti calcolati dalle scadenze marcate come pagate. Puoi sovrascrivere manualmente.'
            : usesFixedInps
              ? 'Inserisci gli acconti di imposta sostitutiva e gli eventuali contributi previdenziali già versati per stimare il residuo annuo.'
              : 'Inserisci gli acconti di imposta sostitutiva e INPS già versati per calcolare il saldo netto.'
          }
        </p>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useManualAcconti}
              onChange={(e) => setUseManualAcconti(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Modifica manualmente
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Acconti imposta sostitutiva già pagati
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>€</span>
              <input
                type="text"
                inputMode="decimal"
                className="input-field"
                placeholder="0"
                value={manualAccontiIrpef}
                onChange={(e) => { setManualAccontiIrpef(e.target.value); setUseManualAcconti(true); }}
                style={{ paddingLeft: 32, fontFamily: 'Space Mono, monospace' }}
              />
            </div>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {usesFixedInps ? 'Contributi già pagati' : 'Acconti INPS già pagati'}
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>€</span>
              <input
                type="text"
                inputMode="decimal"
                className="input-field"
                placeholder="0"
                value={manualAccontiInps}
                onChange={(e) => { setManualAccontiInps(e.target.value); setUseManualAcconti(true); }}
                style={{ paddingLeft: 32, fontFamily: 'Space Mono, monospace' }}
              />
            </div>
          </div>
        </div>
        
        {(taxAmounts.accontiIrpefPagati > 0 || taxAmounts.accontiInpsPagati > 0) && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(4, 120, 87, 0.1)', border: '1px solid rgba(4, 120, 87, 0.3)', borderRadius: 12, fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
              {taxAmounts.accontiIrpefPagati > 0 && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Saldo imposta sostitutiva: </span>
                  <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}><Currency amount={taxAmounts.taxSaldoLordo} /></span>
                  <span style={{ color: 'var(--accent-green)', fontWeight: 600, marginLeft: 8 }}><Currency amount={taxAmounts.taxSaldo} /></span>
                </div>
              )}
              {taxAmounts.accontiInpsPagati > 0 && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Saldo contributi: </span>
                  <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}><Currency amount={taxAmounts.inpsSaldoLordo} /></span>
                  <span style={{ color: 'var(--accent-green)', fontWeight: 600, marginLeft: 8 }}><Currency amount={taxAmounts.inpsSaldo} /></span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {!includeInpsSchedule && (
        <div className="card" style={{ marginBottom: 24, borderLeft: '4px solid var(--accent-primary)' }}>
          <h2 className="card-title"><Info size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Contributi fuori piano scadenze</h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            L’app usa i contributi stimati nelle stime fiscali. Ente: {previdenzialeInfo.label}. I versamenti restano fuori dal piano di giugno/novembre: consulta le scadenze previste dal tuo ente previdenziale.
          </p>
        </div>
      )}

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <h2 className="card-title"><Euro size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Totale Principale</h2>
          <div className="stat-value" style={{ color: 'var(--accent-orange)' }}><Currency amount={shownTotals.totalPrincipal} /></div>
          <div className="stat-label">{hasSavedScadenze ? 'Capitale del piano salvato' : 'Capitale da versare'}</div>
        </div>
        <div className="card">
          <h2 className="card-title"><Percent size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Interessi Rateizzazione</h2>
          <div className="stat-value" style={{ color: shownTotals.totalInterest > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}><Currency amount={shownTotals.totalInterest} /></div>
          <div className="stat-label">0.33% mensile dalla 2ª rata</div>
        </div>
        <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(239,68,68,0.1) 100%)' }}>
          <h2 className="card-title"><CalendarClock size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Totale da Versare</h2>
          <div className="stat-value" style={{ fontSize: '2rem', color: 'var(--accent-red)' }}><Currency amount={shownTotals.grandTotal} /></div>
          <div className="stat-label">Principale + interessi{hasSavedScadenze ? ', rate pagate comprese' : ''}</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 className="card-title" style={{ margin: 0 }}>Piano dei Pagamenti {annoVersamento}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasSavedScadenze ? (
              <button className="btn btn-secondary" onClick={handleRegenerateScadenze}>
                <RefreshCw size={16} /> Rigenera
              </button>
            ) : (
              <button className="btn btn-primary" onClick={handleSaveScadenze}>
                <Save size={16} /> Salva Scadenze
              </button>
            )}
          </div>
        </div>

        {previewDiffers && (
          <div role="status" style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 12, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Anteprima con i dati attuali: capitale <Currency amount={totals.totalPrincipal} />, interessi <Currency amount={totals.totalInterest} />. È un piano ipotetico: con <strong>Rigenera</strong> le rate già pagate restano invariate e si ripianifica solo il residuo, quindi i totali salvati possono differire.
          </div>
        )}

        {numberOfTranches > 1 && !hasSavedScadenze && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={18} style={{ color: '#fbbf24', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Rateizzando pagherai <strong style={{ color: '#fbbf24' }}><Currency amount={totals.totalInterest} /></strong> di interessi.
            </span>
          </div>
        )}

        {hasSavedScadenze ? (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>Pagato</th>
                  <th>Scadenza</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Importo</th>
                  <th style={{ textAlign: 'right' }}>Interessi</th>
                  <th style={{ textAlign: 'right' }}>Totale</th>
                  <th>Pagato il</th>
                </tr>
              </thead>
              <tbody>
                {sortedDates.map(date => (
                  groupedByDate[date].map((scadenza, idx) => {
                    const upcoming = isUpcoming(scadenza.date);
                    const past = isPast(scadenza.date);
                    return (
                      <tr 
                        key={scadenza.id}
                        style={{
                          background: scadenza.pagato ? 'rgba(4, 120, 87, 0.1)' : upcoming ? 'rgba(251, 191, 36, 0.1)' : past ? 'var(--bg-secondary)' : undefined,
                          opacity: scadenza.pagato ? 0.7 : past && !scadenza.pagato ? 0.6 : 1,
                        }}
                      >
                        <td>
                          <button
                            onClick={() => handleTogglePaid(scadenza)}
                            aria-label={scadenza.pagato ? `Segna come non pagato: ${scadenza.label}` : `Segna come pagato: ${scadenza.label}`}
                            aria-pressed={scadenza.pagato}
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
                            }}
                          >
                            {scadenza.pagato && <Check size={16} />}
                          </button>
                        </td>
                        <td>
                          {idx === 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {upcoming && !scadenza.pagato && (
                                <span style={{ background: '#fbbf24', color: '#000', fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>PROSSIMA</span>
                              )}
                              <span style={{ fontWeight: upcoming ? 600 : 400 }}>{formatDateLong(date)}</span>
                            </div>
                          )}
                        </td>
                        <td>
                          <span style={{ color: getTipoColor(scadenza.tipo), fontWeight: 500 }}>{scadenza.label}</span>
                        </td>
                        <td style={{ textAlign: 'right', textDecoration: scadenza.pagato ? 'line-through' : undefined }}>
                          <Currency amount={scadenza.importo} tabular />
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'Space Mono, monospace', color: scadenza.interessi > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          {scadenza.interessi > 0 ? `+€${formatCurrency(scadenza.interessi)}` : '-'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: scadenza.pagato ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                          <Currency amount={scadenza.totale} tabular />
                        </td>
                        <td>
                          {scadenza.pagato && (
                            <>
                              <input
                                type="date"
                                className="input-field"
                                aria-label={`Data di pagamento: ${scadenza.label}`}
                                aria-invalid={!isIsoDate(scadenza.dataPagamento)}
                                value={scadenza.dataPagamento ?? ''}
                                onChange={(e) => handleChangeDataPagamento(scadenza, e.target.value)}
                                style={{ padding: '4px 8px', fontSize: '0.8rem', width: 'auto' }}
                              />
                              {!isIsoDate(scadenza.dataPagamento) && (
                                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--accent-orange)' }}>Data mancante</span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Scadenza</th>
                    <th>Descrizione</th>
                    <th style={{ textAlign: 'right' }}>Capitale</th>
                    <th style={{ textAlign: 'right' }}>Interessi</th>
                    <th style={{ textAlign: 'right' }}>Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((item: PaymentScheduleItem, index: number) => {
                    const upcoming = isUpcoming(item.date);
                    const past = isPast(item.date);
                    return (
                      <tr key={index} style={{ background: upcoming ? 'rgba(251, 191, 36, 0.1)' : past ? 'var(--bg-secondary)' : undefined, opacity: past ? 0.6 : 1 }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {upcoming && <span style={{ background: '#fbbf24', color: '#000', fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>PROSSIMA</span>}
                            <span style={{ fontWeight: upcoming ? 600 : 400 }}>{formatDateLong(item.date)}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 500 }}>{item.label}</span>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          {item.components.taxSaldo > 0 && `Saldo imposta sostitutiva €${formatCurrency(item.components.taxSaldo)}`}
                          {item.components.taxAcconto > 0 && ` · Acc. imposta sostitutiva €${formatCurrency(item.components.taxAcconto)}`}
                            {item.components.inpsSaldo > 0 && ` · Saldo INPS €${formatCurrency(item.components.inpsSaldo)}`}
                            {item.components.inpsAcconto > 0 && ` · Acc. INPS €${formatCurrency(item.components.inpsAcconto)}`}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}><Currency amount={item.principalAmount} tabular /></td>
                        <td style={{ textAlign: 'right', fontFamily: 'Space Mono, monospace', color: item.interestAmount > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          {item.interestAmount > 0 ? `+€${formatCurrency(item.interestAmount)}` : '-'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent-orange)' }}><Currency amount={item.totalAmount} tabular /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 12, textAlign: 'center' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                Clicca <strong>"Salva Scadenze"</strong> per registrare le scadenze e poterle marcare come pagate.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 24, padding: '16px 20px' }}>
        <h3 style={{ fontSize: '0.9rem', marginBottom: 12, color: 'var(--text-secondary)' }}>Come funziona</h3>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <p style={{ marginBottom: 8 }}>
            <strong>Saldo + Primo Acconto</strong>: da versare entro il 30 giugno, rateizzabile fino a 6 rate mensili con interessi dello 0.33% al mese.
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>Secondo Acconto</strong>: da versare in unica soluzione entro il 30 novembre, senza possibilità di rateizzazione.
          </p>
          <p>
            <strong>Nota</strong>: l'imposta sostitutiva usa due acconti del 50%. L'INPS viene rateizzato nel piano solo per la Gestione Separata (40% + 40% con metodo storico); per Artigiani, Commercianti e casse professionali resta fuori da questo calendario. Se il 30 giugno cade di sabato o domenica, la scadenza slitta al lunedì successivo. Le rate di agosto hanno scadenza il 20 invece del 16.
          </p>
        </div>
      </div>
    </>
  );
}
