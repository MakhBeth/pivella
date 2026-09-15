import '../shared/Previdenza.css';
import { CassaHelp, CassaLink } from '../shared/CassaHelp';
import { InpsControls } from '../shared/InpsControls';
import type { Config, CassaOrdinisticaId, GestionePrevidenziale } from '../../types';
import { useState, useMemo, useEffect } from "react";
import {
  Calculator,
  TrendingUp,
  Percent,
  PiggyBank,
  Wallet,
} from '../shared/icons';
import { useApp } from "../../context/AppContext";
import {
  CASSE_ORDINISTICHE,
  GESTIONI_PREVIDENZIALI,
  LIMITE_FATTURATO,
  LIMITE_USCITA_IMMEDIATA,
} from "../../lib/constants/fiscali";
import { calcolaFiscale } from "../../lib/utils/calculations";
import {
  calcolaContributiPrevidenziali,
  calcolaCoefficienteMedioAteco,
  getGestionePrevidenzialeLabel,
  getAliquotaImpostaSostitutiva,
  getInpsCalculationInput,
  getRegimeThresholdStatus,
  getCassaAmounts,
  getCassaWarning,
} from "../../lib/utils/forfettario";
import { parseCurrency, formatCurrency } from "../../lib/utils/formatting";
import { Currency } from "../ui/Currency";

export function Simulatore() {
  const { config } = useApp();
  const [fatturato, setFatturato] = useState<string>("");

  const annoCorrente = new Date().getFullYear();
  const [previdenzaCustom, setPrevidenzaCustom] = useState<Partial<Pick<Config,
    'gestionePrevidenziale' | 'cassaOrdinistica' | 'contributiCassePerAnno' | 'contributiInpsFissi' | 'riduzioneContributiva' | 'inpsAnte1996' | 'gestioneSeparataAltraCopertura'>>>({});
  useEffect(() => { setPrevidenzaCustom({}); }, [config.userId]);
  const simulationConfig = useMemo(() => ({ ...config, ...previdenzaCustom }), [config, previdenzaCustom]);
  const cassaAmounts = getCassaAmounts(simulationConfig, annoCorrente);
  const cassaIncomplete = getCassaWarning(simulationConfig, annoCorrente) !== null;

  const anniAttivita = annoCorrente - config.annoApertura;
  const aliquotaIrpefDefault = getAliquotaImpostaSostitutiva({
    annoApertura: config.annoApertura,
    annoImposta: annoCorrente,
    aliquotaOverride: config.aliquotaOverride,
  });

  const coefficienteDefault = useMemo(() => {
    return calcolaCoefficienteMedioAteco(config.codiciAteco);
  }, [config.codiciAteco]);

  // Stati per valori editabili con default dai calcoli
  const [coefficienteCustom, setCoefficienteCustom] = useState<string>("");
  const [aliquotaIrpefCustom, setAliquotaIrpefCustom] = useState<string>("");
  const isGestioneSeparata = simulationConfig.gestionePrevidenziale === "gestione_separata";
  const inpsInput = useMemo(() => getInpsCalculationInput(simulationConfig, annoCorrente), [simulationConfig, annoCorrente]);

  // Valori effettivi usati nei calcoli
  const coefficienteMedio = coefficienteCustom !== ""
    ? parseFloat(coefficienteCustom) || coefficienteDefault
    : coefficienteDefault;
  const aliquotaIrpef = aliquotaIrpefCustom !== ""
    ? (parseFloat(aliquotaIrpefCustom) || 0) / 100
    : aliquotaIrpefDefault;

  const fatturatoNum = parseCurrency(fatturato);

  const calculations = useMemo(() => {
    return calcolaFiscale(fatturatoNum, coefficienteMedio, aliquotaIrpef, inpsInput);
  }, [fatturatoNum, coefficienteMedio, aliquotaIrpef, inpsInput]);

  const previdenzialeInfo = useMemo(() => {
    if (isGestioneSeparata) {
      const effectiveRate = typeof inpsInput === "number" ? inpsInput : null;
      return {
        label: getGestionePrevidenzialeLabel(simulationConfig.gestionePrevidenziale),
        amount: calculations.inps,
        usesFixedAmount: false,
        includeInpsInScadenze: true,
        effectiveRate,
        baseFixedAmount: null,
        reductionApplied: false,
      };
    }

    return calcolaContributiPrevidenziali(calculations.imponibile, simulationConfig, annoCorrente);
  }, [calculations.imponibile, calculations.inps, simulationConfig, inpsInput, isGestioneSeparata, annoCorrente]);

  const thresholdStatus = getRegimeThresholdStatus(fatturatoNum);
  const isOverLimit = thresholdStatus !== "within_limit";

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Simulatore Reddito</h1>
        <p className="page-subtitle">
          Stima il tuo reddito netto in base al fatturato
        </p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="card-title">Fatturato Stimato</h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              htmlFor="fatturato-input"
              className="input-label"
            >
              Inserisci fatturato
            </label>
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 16,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                  fontSize: "1.2rem",
                  fontWeight: 600,
                }}
              >
                &euro;
              </span>
              <input
                id="fatturato-input"
                type="text"
                inputMode="decimal"
                className="input-field"
                placeholder="es. 50000"
                value={fatturato}
                onChange={(e) => setFatturato(e.target.value)}
                style={{
                  paddingLeft: 40,
                  fontSize: "1.4rem",
                  fontFamily: "Space Mono, monospace",
                  fontWeight: 700,
                }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setFatturato("30000")}
              type="button"
            >
              30k
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setFatturato("50000")}
              type="button"
            >
              50k
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setFatturato("85000")}
              type="button"
            >
              85k
            </button>
          </div>
        </div>

        {isOverLimit && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: 12,
              color: "var(--accent-red)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <TrendingUp size={18} aria-hidden="true" />
            <span>
              {thresholdStatus === "immediate_exit"
                ? <>
                    Attenzione: superi <Currency amount={LIMITE_USCITA_IMMEDIATA} />. L'uscita dal regime forfettario è immediata.
                  </>
                : <>
                    Attenzione: superi la soglia ordinaria di <Currency amount={LIMITE_FATTURATO} />. L'uscita dal regime forfettario avviene dall'anno successivo.
                  </>}
            </span>
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            background: "var(--bg-secondary)",
            borderRadius: 12,
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 24px", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label htmlFor="coefficiente-input" style={{ color: "var(--text-muted)" }}>Coefficiente:</label>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <input
                  id="coefficiente-input"
                  type="text"
                  inputMode="decimal"
                  value={coefficienteCustom !== "" ? coefficienteCustom : coefficienteDefault.toString()}
                  onChange={(e) => setCoefficienteCustom(e.target.value)}
                  style={{
                    width: "fit-content",
                    minWidth: "4ch",
                    fieldSizing: "content",
                    padding: "6px 28px 6px 10px",
                    fontSize: "1rem",
                    fontWeight: 600,
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontFamily: "Space Mono, monospace",
                  } as React.CSSProperties}
                />
                <span style={{ position: "absolute", right: 10, color: "var(--text-muted)", fontSize: "1rem" }}>%</span>
              </div>
              {config.codiciAteco.length > 0 && (
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                  (ATECO: {config.codiciAteco.join(", ")})
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label htmlFor="irpef-input" style={{ color: "var(--text-muted)" }}>Imposta:</label>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <input
                  id="irpef-input"
                  type="text"
                  inputMode="decimal"
                  value={aliquotaIrpefCustom !== "" ? aliquotaIrpefCustom : (aliquotaIrpefDefault * 100).toString()}
                  onChange={(e) => setAliquotaIrpefCustom(e.target.value)}
                  style={{
                    width: "fit-content",
                    minWidth: "3ch",
                    fieldSizing: "content",
                    padding: "6px 28px 6px 10px",
                    fontSize: "1rem",
                    fontWeight: 600,
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontFamily: "Space Mono, monospace",
                  } as React.CSSProperties}
                />
                <span style={{ position: "absolute", right: 10, color: "var(--text-muted)", fontSize: "1rem" }}>%</span>
              </div>
              {aliquotaIrpefCustom === "" && config.aliquotaOverride !== null && (
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>(custom)</span>
              )}
              {aliquotaIrpefCustom === "" && config.aliquotaOverride === null && anniAttivita < 5 && (
                <span style={{ color: "var(--accent-green)", fontSize: "0.75rem" }}>(agevolata)</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card previdenza-form" style={{ marginBottom: 24 }}>
        <div className={`previdenza-grid${simulationConfig.gestionePrevidenziale === 'artigiani' || simulationConfig.gestionePrevidenziale === 'commercianti' ? ' previdenza-grid-four' : ''}`}>
          <div className="previdenza-field">
            <label htmlFor="sim-gestione" className="input-label">Previdenza</label>
            <select id="sim-gestione" className="input-field" value={simulationConfig.gestionePrevidenziale}
              onChange={e => setPrevidenzaCustom({ ...previdenzaCustom, gestionePrevidenziale: e.target.value as GestionePrevidenziale })}>
              {GESTIONI_PREVIDENZIALI.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {simulationConfig.gestionePrevidenziale !== 'cassa_ordinistica' ? (
            <InpsControls config={simulationConfig} anno={annoCorrente} imponibile={calculations.imponibile} id="sim-inps" compact
              onChange={changes => setPrevidenzaCustom({ ...previdenzaCustom, ...changes })} />
          ) : (
            <div className="previdenza-field">
              <label className="input-label" htmlFor="sim-cassa">Cassa professionale</label>
              <select id="sim-cassa" className="input-field" value={simulationConfig.cassaOrdinistica ?? ''}
                onChange={e => setPrevidenzaCustom({ ...previdenzaCustom, cassaOrdinistica: e.target.value as CassaOrdinisticaId })}>
                <option value="" disabled>Seleziona la cassa</option>
                {CASSE_ORDINISTICHE.map(cassa => <option key={cassa.value} value={cassa.value}>{cassa.label}</option>)}
              </select>
            </div>
          )}
        </div>
        {simulationConfig.gestionePrevidenziale === 'cassa_ordinistica' && (
          <>
        <p style={{ margin: '12px 0', fontSize: '0.85rem' }}><CassaLink cassa={simulationConfig.cassaOrdinistica} /></p>
        {simulationConfig.gestionePrevidenziale === 'cassa_ordinistica' && simulationConfig.cassaOrdinistica && (
          <>
            <div className="previdenza-grid" style={{ marginTop: 16 }}>
              {([
                ['annui', 'Contributi annui (€)'],
                ['deducibili', 'Quota deducibile ipotizzata (€)'],
              ] as const).map(([field, label]) => (
                <div className="previdenza-field" key={field}>
                  <label className="input-label" htmlFor={`sim-cassa-${field}`}>{label}</label>
                  <input id={`sim-cassa-${field}`} className="input-field" type="number" min={0} step={0.01}
                    placeholder="Inserisci importo" value={cassaAmounts?.[field] ?? ''}
                    onChange={e => {
                      const value = e.target.value === '' ? null : Number(e.target.value);
                      if (value !== null && (!Number.isFinite(value) || value < 0)) return;
                      const key = simulationConfig.cassaOrdinistica!;
                      setPrevidenzaCustom({ ...previdenzaCustom, contributiCassePerAnno: {
                        ...simulationConfig.contributiCassePerAnno,
                        [key]: { ...simulationConfig.contributiCassePerAnno?.[key],
                          [annoCorrente]: { annui: null, deducibili: null, ...cassaAmounts, [field]: value },
                        },
                      } });
                    }} />
                </div>
              ))}
            </div>
          </>
        )}
        <CassaHelp cassa={simulationConfig.cassaOrdinistica} anno={annoCorrente} simulazione showLink={false} />
          </>
        )}
        {simulationConfig.gestionePrevidenziale !== 'cassa_ordinistica' && cassaIncomplete && (
          <p role="status" style={{ color: 'var(--accent-orange)' }}>{getCassaWarning(simulationConfig, annoCorrente)}</p>
        )}
      </div>

      <div className="grid-4">
        <div className="card">
          <h2 className="card-title">
            <Percent
              size={16}
              style={{ marginRight: 6, verticalAlign: "middle" }}
              aria-hidden="true"
            />
            Imponibile
          </h2>
          <div className="stat-value" style={{ color: "var(--text-primary)" }}>
            <Currency amount={calculations.imponibile} />
          </div>
          <div className="stat-label">{coefficienteMedio}% del fatturato</div>
        </div>

        <div className="card">
          <h2 className="card-title">
            <Calculator
              size={16}
              style={{ marginRight: 6, verticalAlign: "middle" }}
              aria-hidden="true"
            />
            Imposta sostitutiva
          </h2>
          <div className="stat-value" style={{ color: "var(--accent-orange)" }}>
            {cassaIncomplete ? <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Da configurare</span> : <Currency amount={calculations.irpef} />}
          </div>
            <div className="stat-label">{(aliquotaIrpef * 100).toFixed(0)}% di (imponibile − contributi deducibili)</div>
        </div>

        <div className="card">
          <h2 className="card-title">
            <PiggyBank
              size={16}
              style={{ marginRight: 6, verticalAlign: "middle" }}
              aria-hidden="true"
            />
            Contributi
          </h2>
          <div className="stat-value" style={{ color: "var(--accent-orange)" }}>
            {cassaIncomplete ? <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Da configurare</span> : <Currency amount={calculations.inps} />}
          </div>
          <div className="stat-label">
            {previdenzialeInfo.usesFixedAmount
              ? `${previdenzialeInfo.label}${previdenzialeInfo.reductionApplied ? " · riduzione 35%" : ""}`
              : `${previdenzialeInfo.label} ${((previdenzialeInfo.effectiveRate ?? 0) * 100).toFixed(2)}%`}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">
            <Wallet
              size={16}
              style={{ marginRight: 6, verticalAlign: "middle" }}
              aria-hidden="true"
            />
            Totale Tasse
          </h2>
          <div className="stat-value" style={{ color: "var(--accent-red)" }}>
            {cassaIncomplete ? <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Da configurare</span> : <Currency amount={calculations.totaleTasse} />}
          </div>
          <div className="stat-label">Imposta sostitutiva + contributi</div>
        </div>
      </div>

      <div className="grid-3">
        <div
          className="card"
          style={{
            background:
              "linear-gradient(135deg, var(--bg-card) 0%, rgba(4,120,87,0.1) 100%)",
          }}
        >
          <h2 className="card-title">Reddito Netto Stimato</h2>
          <div
            className="stat-value"
            style={{ fontSize: "2.4rem", color: "var(--accent-green)" }}
          >
            {cassaIncomplete ? <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Da configurare</span> : <Currency amount={calculations.nettoStimato} />}
          </div>
          <div className="stat-label">Fatturato meno tasse</div>
        </div>

        <div className="card">
          <h2 className="card-title">% del Fatturato</h2>
          <div
            className="stat-value"
            style={{ color: "var(--accent-primary)" }}
          >
            {cassaIncomplete ? '—' : `${calculations.percentualeNetto.toFixed(1)}%`}
          </div>
          <div className="stat-label">Netto su lordo</div>
        </div>

        <div className="card">
          <h2 className="card-title">Netto Mensile</h2>
          <div className="stat-value" style={{ color: "var(--text-primary)" }}>
            {cassaIncomplete ? <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Da configurare</span> : <Currency amount={calculations.nettoStimato / 12} />}
          </div>
          <div className="stat-label">Diviso 12 mesi</div>
        </div>
      </div>

      {fatturatoNum > 0 && !cassaIncomplete && (
        <div className="card">
          <h2 className="card-title">Riepilogo Calcolo</h2>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Voce</th>
                  <th style={{ textAlign: "right" }}>Importo</th>
                  <th style={{ textAlign: "right" }}>% Fatturato</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Fatturato lordo</td>
                  <td style={{ textAlign: "right" }}>
                    <Currency amount={fatturatoNum} tabular />
                  </td>
                  <td
                    style={{ textAlign: "right", color: "var(--text-muted)" }}
                  >
                    100%
                  </td>
                </tr>
                <tr>
                  <td>Reddito imponibile ({coefficienteMedio}%)</td>
                  <td style={{ textAlign: "right" }}>
                    <Currency amount={calculations.imponibile} tabular />
                  </td>
                  <td
                    style={{ textAlign: "right", color: "var(--text-muted)" }}
                  >
                    {((calculations.imponibile / fatturatoNum) * 100).toFixed(
                      1,
                    )}
                    %
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "var(--accent-orange)" }}>
                    - Imposta sostitutiva ({(aliquotaIrpef * 100).toFixed(0)}%)
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      color: "var(--accent-orange)",
                    }}
                  >
                    -<Currency amount={calculations.irpef} tabular />
                  </td>
                  <td
                    style={{ textAlign: "right", color: "var(--text-muted)" }}
                  >
                    {((calculations.irpef / fatturatoNum) * 100).toFixed(1)}%
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "var(--accent-orange)" }}>
                    - Contributi {previdenzialeInfo.usesFixedAmount
                      ? `(${previdenzialeInfo.label}${previdenzialeInfo.reductionApplied ? " · -35%" : ""})`
                      : `(${((previdenzialeInfo.effectiveRate ?? 0) * 100).toFixed(2)}%)`}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      color: "var(--accent-orange)",
                    }}
                  >
                    -<Currency amount={calculations.inps} tabular />
                  </td>
                  <td
                    style={{ textAlign: "right", color: "var(--text-muted)" }}
                  >
                    {((calculations.inps / fatturatoNum) * 100).toFixed(1)}%
                  </td>
                </tr>
                <tr style={{ borderTop: "2px solid var(--border)" }}>
                  <td style={{ fontWeight: 700, color: "var(--accent-green)" }}>
                    = Reddito netto
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: "var(--accent-green)",
                    }}
                  >
                    <Currency amount={calculations.nettoStimato} tabular />
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: "var(--accent-green)",
                    }}
                  >
                    {cassaIncomplete ? '—' : `${calculations.percentualeNetto.toFixed(1)}%`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {fatturatoNum > 0 && !cassaIncomplete && (
        <div className="card">
          <h2 className="card-title">Distanza dal Limite Forfettario</h2>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>
              <Currency amount={fatturatoNum} />
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              {" "}
              / <Currency amount={LIMITE_FATTURATO} />
            </span>
          </div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(calculations.percentualeLimite, 100)}%`,
                background: isOverLimit
                  ? "var(--accent-red)"
                  : calculations.percentualeLimite > 90
                    ? "var(--accent-orange)"
                    : "var(--accent-green)",
              }}
            />
          </div>
          <div className="stat-label" style={{ marginTop: 8 }}>
            {isOverLimit
              ? `Superato di €${formatCurrency(fatturatoNum - LIMITE_FATTURATO)}`
              : `Rimangono €${formatCurrency(LIMITE_FATTURATO - fatturatoNum)} (${(100 - calculations.percentualeLimite).toFixed(1)}%) prima della soglia ordinaria`}
          </div>
        </div>
      )}
    </>
  );
}
