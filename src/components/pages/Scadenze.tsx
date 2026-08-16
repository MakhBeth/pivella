import { useState, useMemo, useEffect } from 'react';
import { CalendarClock, Euro, Percent, Info, Save, RefreshCw, Check } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import { calcolaFiscale } from '../../lib/utils/calculations';
import { calcolaAccontiForfettario, calcolaContributiPrevidenziali, calcolaCoefficienteMedioAteco, getAliquotaImpostaSostitutiva, getInpsCalculationInput, includeInpsInScadenze, usesFixedContributiPrevidenziali } from '../../lib/utils/forfettario';
import { generatePaymentSchedule, calculateScheduleTotals } from '../../lib/utils/paymentScheduler';
import { parseDateLocal, formatDateLong } from '../../lib/utils/dateHelpers';
import { parseCurrency, formatCurrency } from '../../lib/utils/formatting';
import { Currency } from '../ui/Currency';
import type { PaymentScheduleInput, PaymentScheduleItem, Scadenza, ScadenzaTipo } from '../../types';

type NumberOfTranches = 1 | 2 | 3 | 4 | 5 | 6;

export function Scadenze() {
  const { config, fatture, scadenze, getScadenzeByYear, getPaidAccontiForYear, bulkSaveScadenze, removeScadenzeByYear, updateScadenza, showToast } = useApp();

  const annoCorrente = new Date().getFullYear();
  const [annoRiferimento, setAnnoRiferimento] = useState(annoCorrente - 1);
  const [numberOfTranches, setNumberOfTranches] = useState<NumberOfTranches>(1);
  
  const [manualFatturato, setManualFatturato] = useState<string>('');
  const [useManualFatturato, setUseManualFatturato] = useState(false);
  
  const [manualAccontiIrpef, setManualAccontiIrpef] = useState<string>('');
  const [manualAccontiInps, setManualAccontiInps] = useState<string>('');
  const [useManualAcconti, setUseManualAcconti] = useState(false);
  
  const [manualContributiVersati, setManualContributiVersati] = useState<string>('');

  const annoVersamento = annoRiferimento + 1;
  const savedScadenze = getScadenzeByYear(annoVersamento);
  const hasSavedScadenze = savedScadenze.length > 0;

  const paidAccontiFromDb = getPaidAccontiForYear(annoRiferimento);

  const savedAccontiFromScadenze = useMemo(() => {
    if (savedScadenze.length === 0) return null;
    const first = savedScadenze[0];
    if (first.accontiIrpefUsed !== undefined || first.accontiInpsUsed !== undefined) {
      return {
        irpef: first.accontiIrpefUsed ?? 0,
        inps: first.accontiInpsUsed ?? 0,
      };
    }
    return null;
  }, [savedScadenze]);

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
  const parsedContributiVersati = parseCurrency(manualContributiVersati);

  const fiscale = calcolaFiscale(totaleFatturato, coefficienteMedio, aliquotaIrpef, getInpsCalculationInput(config), parsedContributiVersati || undefined);
  const redditoImponibile = fiscale.imponibile;
  const irpefTotale = fiscale.irpef;
  const inpsTotale = fiscale.inps;
  const previdenzialeInfo = calcolaContributiPrevidenziali(redditoImponibile, config);
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

  const round2 = (v: number) => Math.round(v * 100) / 100;

  const convertScheduleToScadenze = (scheduleItems: PaymentScheduleItem[], accontiIrpef: number, accontiInps: number): Array<Omit<Scadenza, 'userId'>> => {
    const result: Array<Omit<Scadenza, 'userId'>> = [];
    let idCounter = Date.now();

    for (const item of scheduleItems) {
      const isSummerBundle = item.label.includes('Saldo') || item.label.includes('Rata');
      const trancheMatch = item.label.match(/Rata (\d+)\/(\d+)/);
      const trancheIndex = trancheMatch ? parseInt(trancheMatch[1]) - 1 : 0;
      const totalTranches = trancheMatch ? parseInt(trancheMatch[2]) : 1;

      // Compute interest shares for each active component, rounded to 2 decimals.
      // The last active component absorbs the rounding remainder so the sum
      // of per-component interest equals item.interestAmount exactly.
      const activeComponents: { key: string; principal: number }[] = [];
      if (item.components.taxSaldo > 0) activeComponents.push({ key: 'taxSaldo', principal: item.components.taxSaldo });
      if (item.components.taxAcconto > 0) activeComponents.push({ key: 'taxAcconto', principal: item.components.taxAcconto });
      if (item.components.inpsSaldo > 0) activeComponents.push({ key: 'inpsSaldo', principal: item.components.inpsSaldo });
      if (item.components.inpsAcconto > 0) activeComponents.push({ key: 'inpsAcconto', principal: item.components.inpsAcconto });

      const interestByKey: Record<string, number> = {};
      if (item.principalAmount > 0 && item.interestAmount > 0 && activeComponents.length > 0) {
        let allocated = 0;
        for (let ci = 0; ci < activeComponents.length; ci++) {
          const comp = activeComponents[ci];
          if (ci === activeComponents.length - 1) {
            // Last component gets the remainder to avoid cent drift
            interestByKey[comp.key] = round2(item.interestAmount - allocated);
          } else {
            const share = round2(item.interestAmount * (comp.principal / item.principalAmount));
            interestByKey[comp.key] = share;
            allocated = round2(allocated + share);
          }
        }
      }

      if (item.components.taxSaldo > 0) {
        const interessi = interestByKey['taxSaldo'] ?? 0;
        result.push({
          id: `${idCounter++}`,
          visibleId: `${annoVersamento}-saldo-irpef-${trancheIndex}`,
          annoRiferimento,
          annoVersamento,
          date: item.date,
          tipo: 'saldo_irpef',
          label: isSummerBundle && totalTranches > 1 ? `Saldo imposta sostitutiva (${trancheIndex + 1}/${totalTranches})` : 'Saldo imposta sostitutiva',
          importo: item.components.taxSaldo,
          interessi,
          totale: round2(item.components.taxSaldo + interessi),
          pagato: false,
          trancheIndex,
          totalTranches,
          accontiIrpefUsed: accontiIrpef,
          accontiInpsUsed: accontiInps,
        });
      }

      if (item.components.taxAcconto > 0) {
        const isSecondAcconto = item.label.includes('Secondo');
        const interessi = interestByKey['taxAcconto'] ?? 0;
        result.push({
          id: `${idCounter++}`,
          visibleId: `${annoVersamento}-acconto-irpef-${isSecondAcconto ? '2' : '1'}-${trancheIndex}`,
          annoRiferimento,
          annoVersamento,
          date: item.date,
          tipo: 'acconto_irpef',
          label: isSecondAcconto 
            ? 'Secondo acconto imposta sostitutiva' 
            : (isSummerBundle && totalTranches > 1 ? `Primo acconto imposta sostitutiva (${trancheIndex + 1}/${totalTranches})` : 'Primo acconto imposta sostitutiva'),
          importo: item.components.taxAcconto,
          interessi,
          totale: round2(item.components.taxAcconto + interessi),
          pagato: false,
          trancheIndex: isSecondAcconto ? 0 : trancheIndex,
          totalTranches: isSecondAcconto ? 1 : totalTranches,
          accontiIrpefUsed: accontiIrpef,
          accontiInpsUsed: accontiInps,
        });
      }

      if (item.components.inpsSaldo > 0) {
        const interessi = interestByKey['inpsSaldo'] ?? 0;
        result.push({
          id: `${idCounter++}`,
          visibleId: `${annoVersamento}-saldo-inps-${trancheIndex}`,
          annoRiferimento,
          annoVersamento,
          date: item.date,
          tipo: 'saldo_inps',
          label: isSummerBundle && totalTranches > 1 ? `Saldo INPS (${trancheIndex + 1}/${totalTranches})` : 'Saldo INPS',
          importo: item.components.inpsSaldo,
          interessi,
          totale: round2(item.components.inpsSaldo + interessi),
          pagato: false,
          trancheIndex,
          totalTranches,
          accontiIrpefUsed: accontiIrpef,
          accontiInpsUsed: accontiInps,
        });
      }

      if (item.components.inpsAcconto > 0) {
        const isSecondAcconto = item.label.includes('Secondo');
        const interessi = interestByKey['inpsAcconto'] ?? 0;
        result.push({
          id: `${idCounter++}`,
          visibleId: `${annoVersamento}-acconto-inps-${isSecondAcconto ? '2' : '1'}-${trancheIndex}`,
          annoRiferimento,
          annoVersamento,
          date: item.date,
          tipo: 'acconto_inps',
          label: isSecondAcconto 
            ? 'Secondo Acconto INPS' 
            : (isSummerBundle && totalTranches > 1 ? `Primo Acconto INPS (${trancheIndex + 1}/${totalTranches})` : 'Primo Acconto INPS'),
          importo: item.components.inpsAcconto,
          interessi,
          totale: round2(item.components.inpsAcconto + interessi),
          pagato: false,
          trancheIndex: isSecondAcconto ? 0 : trancheIndex,
          totalTranches: isSecondAcconto ? 1 : totalTranches,
          accontiIrpefUsed: accontiIrpef,
          accontiInpsUsed: accontiInps,
        });
      }
    }

    return result;
  };

  const handleSaveScadenze = async () => {
    try {
      const newScadenze = convertScheduleToScadenze(schedule, parsedAccontiIrpef, parsedAccontiInps);
      await removeScadenzeByYear(annoVersamento);
      await bulkSaveScadenze(newScadenze);
      showToast(`Scadenze ${annoVersamento} salvate!`);
    } catch (error) {
      showToast('Errore salvataggio scadenze', 'error');
    }
  };

  const handleRegenerateScadenze = async () => {
    try {
      const newScadenze = convertScheduleToScadenze(schedule, parsedAccontiIrpef, parsedAccontiInps);
      const existingPaidStatus = new Map(
        savedScadenze.map(s => [s.visibleId, { pagato: s.pagato, dataPagamento: s.dataPagamento }])
      );
      
      const mergedScadenze = newScadenze.map(s => {
        const existing = existingPaidStatus.get(s.visibleId);
        if (existing) {
          return { ...s, pagato: existing.pagato, dataPagamento: existing.dataPagamento };
        }
        return s;
      });

      await removeScadenzeByYear(annoVersamento);
      await bulkSaveScadenze(mergedScadenze);
      showToast(`Scadenze ${annoVersamento} rigenerate!`);
    } catch (error) {
      showToast('Errore rigenerazione scadenze', 'error');
    }
  };

  const handleTogglePaid = async (scadenza: Scadenza) => {
    try {
      const updated: Scadenza = {
        ...scadenza,
        pagato: !scadenza.pagato,
        dataPagamento: !scadenza.pagato ? new Date().toISOString().split('T')[0] : undefined,
      };
      await updateScadenza(updated);
    } catch (error) {
      showToast('Errore aggiornamento scadenza', 'error');
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
              <span style={{ color: 'var(--text-muted)' }}>INPS dovuta: </span>
              <strong><Currency amount={inpsTotale} /></strong>
              <span style={{ color: 'var(--text-muted)' }}> ({previdenzialeInfo.label}{previdenzialeInfo.reductionApplied ? ' · riduzione 35%' : ''})</span>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 250px' }}>
                <label htmlFor="contributi-versati-input" style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Contributi INPS versati nel {annoRiferimento}
                </label>
                <div style={{ position: 'relative', maxWidth: 250 }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>€</span>
                  <input
                    id="contributi-versati-input"
                    type="text"
                    inputMode="decimal"
                    className="input-field"
                    placeholder="0"
                    value={manualContributiVersati}
                    onChange={(e) => setManualContributiVersati(e.target.value)}
                    style={{ paddingLeft: 32, fontFamily: 'Space Mono, monospace' }}
                  />
                </div>
              </div>
              <div style={{ flex: '1 1 250px', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Importo INPS effettivamente pagato durante l'anno {annoRiferimento} (per cassa).
                Viene dedotto dall'imponibile per calcolare l'imposta sostitutiva.
                {!parsedContributiVersati && (
                  <span style={{ display: 'block', marginTop: 4, color: 'var(--accent-orange)' }}>
                    Se non specificato, si deduce l'intero INPS dovuto.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="card-title">Versamenti già registrati (anno precedente)</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          {paidAccontiFromDb.irpefPaid > 0 || paidAccontiFromDb.inpsPaid > 0 
            ? 'Acconti calcolati dalle scadenze marcate come pagate. Puoi sovrascrivere manualmente.'
            : usesFixedInps
              ? 'Inserisci gli acconti di imposta sostitutiva e gli eventuali contributi INPS già versati per stimare il residuo annuo.'
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
              {usesFixedInps ? 'Contributi INPS già pagati' : 'Acconti INPS già pagati'}
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
                  <span style={{ color: 'var(--text-muted)' }}>Saldo INPS: </span>
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
          <h2 className="card-title"><Info size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />INPS fuori piano scadenze</h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Per {previdenzialeInfo.label} l'app usa l'importo INPS annuo fisso nelle stime fiscali, ma non lo inserisce nel piano di giugno/novembre perché questi contributi seguono scadenze trimestrali dedicate.
          </p>
        </div>
      )}

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <h2 className="card-title"><Euro size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Totale Principale</h2>
          <div className="stat-value" style={{ color: 'var(--accent-orange)' }}><Currency amount={totals.totalPrincipal} /></div>
          <div className="stat-label">Capitale da versare</div>
        </div>
        <div className="card">
          <h2 className="card-title"><Percent size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Interessi Rateizzazione</h2>
          <div className="stat-value" style={{ color: numberOfTranches > 1 ? 'var(--accent-red)' : 'var(--text-muted)' }}><Currency amount={totals.totalInterest} /></div>
          <div className="stat-label">0.33% mensile dalla 2ª rata</div>
        </div>
        <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(239,68,68,0.1) 100%)' }}>
          <h2 className="card-title"><CalendarClock size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Totale da Versare</h2>
          <div className="stat-value" style={{ fontSize: '2rem', color: 'var(--accent-red)' }}><Currency amount={totals.grandTotal} /></div>
          <div className="stat-label">Principale + interessi</div>
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

        {numberOfTranches > 1 && (
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
            <strong>Nota</strong>: l'imposta sostitutiva usa due acconti del 50%. L'INPS viene rateizzato nel piano solo per la Gestione Separata (40% + 40% con metodo storico); per Artigiani e Commercianti resta fuori da questo calendario. Se il 30 giugno cade di sabato o domenica, la scadenza slitta al lunedì successivo. Le rate di agosto hanno scadenza il 20 invece del 16.
          </p>
        </div>
      </div>
    </>
  );
}
