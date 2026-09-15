import { ExternalTextLink } from './ExternalTextLink';
import type { Config } from '../../types';
import { INPS_AC_PARAMS, INPS_GS_URL, INPS_SIMULATORE_URL } from '../../lib/constants/previdenza';
import { calculateContribution } from '../../lib/utils/calculations';
import { getInpsCalculationInput } from '../../lib/utils/forfettario';
import { Currency } from '../ui/Currency';

type Changes = Partial<Pick<Config, 'contributiInpsFissi' | 'riduzioneContributiva' | 'inpsAnte1996' | 'gestioneSeparataAltraCopertura'>>;
export function InpsControls({ config, onChange, anno, id, imponibile = 0, compact = false }: {
  config: Config; onChange: (changes: Changes) => void; anno: number; id: string; imponibile?: number; compact?: boolean;
}) {
  const params = INPS_AC_PARAMS[anno];
  if (config.gestionePrevidenziale === 'gestione_separata') return (
    <div className="inps-field">
      <label htmlFor={`${id}-copertura`} className="input-label">Situazione previdenziale</label>
      <select id={`${id}-copertura`} className="input-field" value={config.gestioneSeparataAltraCopertura ? 'altra' : 'esclusiva'}
        onChange={e => onChange({ gestioneSeparataAltraCopertura: e.target.value === 'altra' })}>
        <option value="esclusiva">Solo Gestione Separata — 26,07%</option>
        <option value="altra">Pensionato o altra copertura obbligatoria — 24%</option>
      </select>
      {!compact && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
        Percentuale sul reddito, senza contributo minimo fisso. <ExternalTextLink href={INPS_GS_URL}>Aliquote INPS 2026 e casi particolari</ExternalTextLink>
      </p>}
    </div>
  );
  const automatic = config.contributiInpsFissi == null;
  return (
    <div className="inps-controls" style={{ width: '100%' }}>
      <div className="inps-fields" style={{ display: 'flex', alignItems: 'end', flexWrap: 'wrap', gap: 12 }}>
        <div className="inps-field">
          <label htmlFor={`${id}-metodo`} className="input-label">Calcolo contributi</label>
          <select id={`${id}-metodo`} className="input-field" value={automatic ? 'auto' : 'manuale'}
            onChange={e => onChange({ contributiInpsFissi: e.target.value === 'auto' ? null : calculateContribution(imponibile, getInpsCalculationInput({ ...config, contributiInpsFissi: null, riduzioneContributiva: false }, anno)) })}>
            <option value="auto">Automatico INPS {anno}</option>
            <option value="manuale">Importo personalizzato</option>
          </select>
        </div>
        <div className="inps-field">
          <label htmlFor={`${id}-riduzione`} className="input-label">Agevolazione</label>
          <select id={`${id}-riduzione`} className="input-field" value={config.riduzioneContributiva ? '35' : '0'}
            onChange={e => onChange({ riduzioneContributiva: e.target.value === '35' })}>
            <option value="0">Ordinaria — nessuna riduzione</option>
            <option value="35">Forfettario — riduzione 35% richiesta all’INPS</option>
          </select>
        </div>
        {automatic ? (
          <div className="inps-field">
            <label htmlFor={`${id}-anzianita`} className="input-label">Primi contributi previdenziali</label>
            <select id={`${id}-anzianita`} className="input-field" value={config.inpsAnte1996 ? 'prima' : 'dopo'}
              onChange={e => onChange({ inpsAnte1996: e.target.value === 'prima' })}>
              <option value="dopo">Dal 1996 in poi</option>
              <option value="prima">Anche prima del 1996</option>
            </select>
          </div>
        ) : (
          <div className="inps-field">
            <label htmlFor={`${id}-importo`} className="input-label">Totale annuo prima della riduzione (€)</label>
            <input id={`${id}-importo`} type="number" min={0} step={0.01} className="input-field" value={config.contributiInpsFissi ?? ''}
              onChange={e => { const value = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(value) && value >= 0) onChange({ contributiInpsFissi: value }); }} />
          </div>
        )}
      </div>
      <p className="inps-note" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
        {automatic && params ? <>Per un titolare iscritto tutto l’anno: minimo ordinario <Currency amount={calculateContribution(0, getInpsCalculationInput({ ...config, contributiInpsFissi: null, riduzioneContributiva: false }, anno))} />,
          più la quota sul reddito oltre <Currency amount={params.minimo} />. La riduzione va selezionata solo se richiesta e spettante. </> :
          automatic ? <>Parametri {anno} non disponibili: usa un importo verificato. </> : <>Usa il totale annuo verificato, prima dell’eventuale riduzione selezionata. </>}
        <ExternalTextLink href={params?.fonte ?? INPS_SIMULATORE_URL}>Regole e agevolazioni INPS</ExternalTextLink>
        {' · '}<ExternalTextLink href={INPS_SIMULATORE_URL}>Simulatore ufficiale: periodi parziali e altri casi</ExternalTextLink>
      </p>
    </div>
  );
}
