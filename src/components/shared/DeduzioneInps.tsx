import { useEffect, useId, useState } from 'react';
import type { Config } from '../../types';
import { descriviDeduzioneInps, getContributiInpsManuali, setContributiInpsManuali, type DeduzioneInps } from '../../lib/utils/deduzioneInps';
import { parseOptionalContribution } from '../../lib/utils/formatting';
import { Currency } from '../ui/Currency';
import { Info } from './icons';

interface DeduzioneInpsInfoProps {
  config: Config;
  anno: number;
  deduzione: DeduzioneInps;
  /** Importo effettivamente dedotto (fiscale.deduzioneContributi). */
  importoDedotto: number;
  /** Con updateConfig il totale manuale dell'anno è modificabile qui. */
  updateConfig?: (updates: Partial<Config>) => void;
  /** In sola lettura: rimanda a Scadenze per inserire i versamenti. */
  linkScadenze?: boolean;
}

const toInput = (value: number | undefined): string => value === undefined ? '' : String(value).replace('.', ',');

/** Deduzione INPS applicata, con fonte, avvisi e (se modificabile) il totale manuale dell'anno. */
export function DeduzioneInpsInfo({ config, anno, deduzione, importoDedotto, updateConfig, linkScadenze }: DeduzioneInpsInfoProps) {
  const id = useId();
  const manuale = getContributiInpsManuali(config, anno);
  const [testo, setTesto] = useState(toInput(manuale));
  useEffect(() => { setTesto(toInput(manuale)); }, [manuale, anno, config.userId]);
  const parsed = parseOptionalContribution(testo);

  if (deduzione.fonte === 'cassa_professionale') return null;

  // In sola lettura (Dashboard, Simulatore) gli avvisi diventano un'icona con tooltip che porta a Scadenze.
  const compatto = !updateConfig && linkScadenze === true;
  const linkAnno = `#/scadenze?anno=${anno}`;
  const titoloAvviso = deduzione.avvisi.length === 0 ? null
    : deduzione.previsionale ? 'Stima previsionale: ai fini fiscali vale la cassa'
    : deduzione.fonte === 'stima' ? 'INPS stimato dalle fatture: conferma in Scadenze'
    : deduzione.versamentiPrevisti > 0 ? 'Versamenti INPS previsti, non ancora segnati'
    : deduzione.fonte === 'nessun_versamento' ? 'Nessun versamento INPS'
    : 'Versamenti INPS senza data';

  const salva = () => {
    if (!updateConfig || parsed.invalid || parsed.amount === manuale) return;
    updateConfig({ contributiInpsVersatiManuali: setContributiInpsManuali(config, anno, parsed.amount) });
  };

  return (
    <div style={{ fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-muted)' }}>Contributi INPS dedotti: </span>
        <strong><Currency amount={importoDedotto} /></strong>
        {(deduzione.previsionale || deduzione.stimato) && (
          <span style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
            {deduzione.previsionale ? 'PREVISIONALE' : 'STIMA'}
          </span>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {compatto && deduzione.modalita === 'cassa'
          ? <a href={linkAnno} style={{ color: 'inherit' }}>{descriviDeduzioneInps(deduzione, anno)}</a>
          : descriviDeduzioneInps(deduzione, anno)}
        {compatto && titoloAvviso && (
          <a href={linkAnno} className="tooltip" data-tooltip={titoloAvviso}
            aria-label={`${titoloAvviso}. ${deduzione.avvisi.join(' ')} Vai a Scadenze.`}
            style={{ display: 'inline-flex', color: '#fbbf24' }}>
            <Info size={16} aria-hidden="true" />
          </a>
        )}
      </div>
      {!compatto && deduzione.avvisi.map(avviso => (
        <p key={avviso} role="status" style={{ fontWeight: 600, color: 'var(--text-primary)', margin: '6px 0 0' }}>{avviso}</p>
      ))}
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
