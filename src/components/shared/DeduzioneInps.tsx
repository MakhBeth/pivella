import { useEffect, useId, useState } from 'react';
import type { Config } from '../../types';
import { descriviDeduzioneInps, getContributiInpsManuali, setContributiInpsManuali, type DeduzioneInps, type StimaVersamentiInps } from '../../lib/utils/deduzioneInps';
import { formatCurrency } from '../../lib/utils/formatting';
import { parseOptionalContribution } from '../../lib/utils/formatting';
import { Currency } from '../ui/Currency';

interface DeduzioneInpsInfoProps {
  config: Config;
  anno: number;
  deduzione: DeduzioneInps;
  /** Importo effettivamente dedotto (fiscale.deduzioneContributi). */
  importoDedotto: number;
  /** Con updateConfig il totale manuale dell'anno è modificabile qui. */
  updateConfig?: (updates: Partial<Config>) => void;
  /** Stima dei versamenti da proporre (mai applicata senza conferma). */
  stima?: StimaVersamentiInps | null;
  /** In sola lettura: rimanda a Scadenze per inserire i versamenti. */
  linkScadenze?: boolean;
}

const toInput = (value: number | undefined): string => value === undefined ? '' : String(value).replace('.', ',');

/** Deduzione INPS applicata, con fonte, avvisi e (se modificabile) il totale manuale dell'anno. */
export function DeduzioneInpsInfo({ config, anno, deduzione, importoDedotto, updateConfig, stima, linkScadenze }: DeduzioneInpsInfoProps) {
  const id = useId();
  const manuale = getContributiInpsManuali(config, anno);
  const [testo, setTesto] = useState(toInput(manuale));
  useEffect(() => { setTesto(toInput(manuale)); }, [manuale, anno, config.userId]);
  const parsed = parseOptionalContribution(testo);

  if (deduzione.fonte === 'cassa_professionale') return null;

  const salva = () => {
    if (!updateConfig || parsed.invalid || parsed.amount === manuale) return;
    updateConfig({ contributiInpsVersatiManuali: setContributiInpsManuali(config, anno, parsed.amount) });
  };
  const usaStima = (importo: number) => {
    if (!updateConfig) return;
    setTesto(toInput(importo));
    updateConfig({ contributiInpsVersatiManuali: setContributiInpsManuali(config, anno, importo) });
  };

  return (
    <div style={{ fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-muted)' }}>Contributi INPS dedotti: </span>
        <strong><Currency amount={importoDedotto} /></strong>
        {deduzione.previsionale && (
          <span style={{ background: 'var(--accent-orange)', color: '#000', fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>PREVISIONALE</span>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{descriviDeduzioneInps(deduzione, anno)}</div>
      {deduzione.avvisi.map(avviso => (
        <p key={avviso} role="status" style={{ color: 'var(--accent-orange)', margin: '6px 0 0' }}>{avviso}</p>
      ))}
      {!updateConfig && linkScadenze && deduzione.modalita === 'cassa' && (
        <p style={{ margin: '6px 0 0' }}>
          <a href="#/scadenze">Inserisci o correggi i versamenti INPS in Scadenze</a>
        </p>
      )}
      {updateConfig && deduzione.modalita === 'cassa' && deduzione.fonte === 'nessun_versamento' && stima && (
        <div role="status" style={{ marginTop: 12, padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 8 }}>
          <div>
            Stima dei versamenti INPS nel {anno}: <strong><Currency amount={stima.importo} /></strong>
          </div>
          <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Calcolata dal {stima.descrizione}. È una proposta: controlla gli F24 effettivamente pagati prima di usarla.
          </div>
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => usaStima(stima.importo)}
            aria-label={`Usa la stima di ${formatCurrency(stima.importo)} euro come totale versato nel ${anno}`}>
            Usa la stima
          </button>
        </div>
      )}
      {updateConfig && deduzione.modalita === 'cassa' && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={`${id}-manuale`} style={{ display: 'block', marginBottom: 6, color: 'var(--text-secondary)' }}>
            Totale INPS versato nel {anno} (facoltativo)
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', maxWidth: 220, flex: '1 1 160px' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>€</span>
              <input
                id={`${id}-manuale`}
                type="text"
                inputMode="decimal"
                className="input-field"
                placeholder="dalle scadenze"
                aria-invalid={parsed.invalid}
                aria-describedby={`${id}-nota`}
                value={testo}
                onChange={e => setTesto(e.target.value)}
                onBlur={salva}
                onKeyDown={e => { if (e.key === 'Enter') salva(); }}
                style={{ paddingLeft: 32, fontFamily: 'Space Mono, monospace' }}
              />
            </div>
            {manuale !== undefined && (
              <button type="button" className="btn btn-secondary" onClick={() => { setTesto(''); updateConfig({ contributiInpsVersatiManuali: setContributiInpsManuali(config, anno, undefined) }); }}>
                Usa le scadenze
              </button>
            )}
          </div>
          <p id={`${id}-nota`} style={{ margin: '6px 0 0', color: parsed.invalid ? 'var(--accent-red)' : 'var(--text-muted)' }}>
            {parsed.invalid
              ? 'Inserisci un importo valido, per esempio 1.000,50. Finché non lo correggi resta il valore salvato.'
              : 'Sostituisce la somma delle scadenze INPS pagate nell’anno, per questo profilo. Vuoto: si usano le scadenze; 0: nessun versamento.'}
          </p>
        </div>
      )}
    </div>
  );
}
