import { useEffect, useId, useState } from 'react';
import type { Config } from '../../types';
import { descriviDeduzioneInps, getContributiInpsManuali, setContributiInpsManuali, type DeduzioneInps } from '../../lib/utils/deduzioneInps';
import { parseOptionalContribution } from '../../lib/utils/formatting';
import { Currency } from '../ui/Currency';
import { Info } from './icons';

/** Etichetta per importi stimati o previsionali. */
export function BadgeStima({ testo = 'STIMA', tooltip }: { testo?: string; tooltip?: string }) {
  return (
    <span className={tooltip ? 'tooltip' : undefined} data-tooltip={tooltip}
      style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.65rem', padding: '0 5px', borderRadius: 4, fontWeight: 600, marginLeft: 6 }}>
      {testo}
    </span>
  );
}

interface DeduzioneInpsInfoProps {
  config: Config;
  anno: number;
  deduzione: DeduzioneInps;
  /** Importo effettivamente dedotto (fiscale.deduzioneContributi). */
  importoDedotto: number;
  /** In sola lettura: rimanda a Scadenze per inserire i versamenti. */
  linkScadenze?: boolean;
}

/** Deduzione INPS applicata, in sola lettura: fonte, e avvisi come icona con tooltip che porta a Scadenze. */
export function DeduzioneInpsInfo({ anno, deduzione, importoDedotto, linkScadenze }: DeduzioneInpsInfoProps) {
  if (deduzione.fonte === 'cassa_professionale') return null;

  const linkAnno = `#/scadenze?anno=${anno}`;
  const conLink = linkScadenze === true && deduzione.modalita === 'cassa';
  const titoloAvviso = deduzione.avvisi.length === 0 ? null
    : deduzione.previsionale ? 'Stima previsionale: ai fini fiscali vale la cassa'
    : deduzione.fonte === 'stima' ? 'INPS stimato dalle fatture: conferma in Scadenze'
    : deduzione.versamentiPrevisti > 0 ? 'Versamenti INPS previsti, non ancora segnati'
    : deduzione.fonte === 'nessun_versamento' ? 'Nessun versamento INPS'
    : 'Versamenti INPS senza data';

  return (
    <div style={{ fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-muted)' }}>Contributi INPS dedotti: </span>
        <strong><Currency amount={importoDedotto} /></strong>
        {(deduzione.previsionale || deduzione.stimato) && <BadgeStima testo={deduzione.previsionale ? 'PREVISIONALE' : 'STIMA'} />}
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {conLink
          ? <a href={linkAnno} style={{ color: 'inherit' }}>{descriviDeduzioneInps(deduzione, anno)}</a>
          : descriviDeduzioneInps(deduzione, anno)}
        {conLink && titoloAvviso && (
          <a href={linkAnno} className="tooltip" data-tooltip={titoloAvviso}
            aria-label={`${titoloAvviso}. ${deduzione.avvisi.join(' ')} Vai a Scadenze.`}
            style={{ display: 'inline-flex', color: '#fbbf24' }}>
            <Info size={16} aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

const toInput = (value: number | undefined): string => value === undefined ? '' : String(value).replace('.', ',');

/** Totale INPS versato nell'anno inserito a mano: salvato per profilo e anno, sostituisce il calcolo. */
export function ContributiInpsManuale({ config, anno, updateConfig }: { config: Config; anno: number; updateConfig: (updates: Partial<Config>) => void }) {
  const id = useId();
  const manuale = getContributiInpsManuali(config, anno);
  const [testo, setTesto] = useState(toInput(manuale));
  useEffect(() => { setTesto(toInput(manuale)); }, [manuale, anno, config.userId]);
  const parsed = parseOptionalContribution(testo);

  const salva = () => {
    if (parsed.invalid || parsed.amount === manuale) return;
    updateConfig({ contributiInpsVersatiManuali: setContributiInpsManuali(config, anno, parsed.amount) });
  };

  return (
    <div style={{ fontSize: '0.85rem' }}>
      <label htmlFor={`${id}-manuale`} style={{ display: 'block', marginBottom: 6, color: 'var(--text-secondary)' }}>
        INPS versato nel {anno} (totale, dagli F24)
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', maxWidth: 220, flex: '1 1 160px' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>€</span>
          <input
            id={`${id}-manuale`}
            type="text"
            inputMode="decimal"
            className="input-field"
            placeholder="calcolato"
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
            Usa il calcolo
          </button>
        )}
      </div>
      <p id={`${id}-nota`} style={{ margin: '6px 0 0', color: parsed.invalid ? 'var(--accent-red)' : 'var(--text-muted)' }}>
        {parsed.invalid
          ? 'Inserisci un importo valido, per esempio 1.000,50. Finché non lo correggi resta il valore salvato.'
          : 'Saldo dell’anno prima più acconti dell’anno, salvato per questo profilo e usato anche in Dashboard. Vuoto: lo calcola Pivella; 0: nessun versamento.'}
      </p>
    </div>
  );
}
