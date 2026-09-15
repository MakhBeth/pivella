import { ExternalTextLink } from './ExternalTextLink';
import type { CassaOrdinisticaId } from '../../types';
import { CASSE_SITI } from '../../lib/constants/previdenza';

export function CassaLink({ cassa }: { cassa?: CassaOrdinisticaId }) {
  return (
      <ExternalTextLink href={(cassa && CASSE_SITI[cassa]) || CASSE_SITI.altra}>
        {cassa && cassa !== 'altra' ? 'Apri il sito ufficiale della cassa' : 'Consulta gli enti previdenziali'}
      </ExternalTextLink>
  );
}

export function CassaHelp({ cassa, anno, simulazione = false, showLink = true }: { cassa?: CassaOrdinisticaId; anno: number; simulazione?: boolean; showLink?: boolean }) {
  return (
    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '12px 0', lineHeight: 1.6 }}>
      {showLink && <CassaLink cassa={cassa} />}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer' }}>Dove trovo gli importi e cosa devo inserire?</summary>
        <p><strong>Contributi annui:</strong> il totale che prevedi di dovere per il {anno}. Cerca il prospetto contributivo o il simulatore nell’area riservata della cassa. L’app non determina ancora aliquote, minimi e agevolazioni delle singole casse.</p>
        <p><strong>Quota deducibile:</strong> {simulazione ? 'quanto ipotizzi di versare e poter dedurre nel corso dell’anno.' : 'i contributi effettivamente versati nell’anno che risultano deducibili.'} Cerca l’attestazione dei contributi versati o la certificazione fiscale della cassa. Non copiare automaticamente il totale dovuto: sono due importi diversi.</p>
        <p>Se l’importo è davvero nullo, inserisci 0. Se non lo conosci, lascia il campo vuoto: la stima resterà segnalata come incompleta.</p>
      </details>
    </div>
  );
}
