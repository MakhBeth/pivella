import { z } from 'zod';

import { DEFAULT_CONFIG, LIMITE_FATTURATO } from '../../../src/lib/constants/fiscali';
import { calcolaFiscale } from '../../../src/lib/utils/calculations';
import { getCassaWarning, calcolaContributiPrevidenziali, calcolaAccontiForfettario, calcolaCoefficienteMedioAteco, getAliquotaImpostaSostitutiva, getInpsCalculationInput, getRegimeThresholdStatus } from '../../../src/lib/utils/forfettario';
import { descriviDeduzioneInps, risolviDeduzioneInps, type DeduzioneInps } from '../../../src/lib/utils/deduzioneInps';
import { anno as annoDi, defineTool, euro, isIncassata, round2, snapshotOf, userIdSchema } from './shared';

// Due criteri distinti: il fatturato è sempre per cassa (data di incasso);
// la deduzione dei contributi segue la scelta del profilo.
const NOTA_DEDUZIONE: Record<DeduzioneInps['fonte'], string> = {
  manuale: 'contributi INPS dedotti per cassa, dal totale versato inserito a mano',
  scadenze: 'contributi INPS dedotti per cassa, dai versamenti pagati nell\'anno',
  nessun_versamento: 'contributi INPS dedotti per cassa: nessun versamento noto, deduzione zero',
  dovuti_stimati: 'contributi INPS dedotti per competenza sui dovuti stimati: stima solo previsionale, ai fini fiscali vale la cassa',
  cassa_professionale: 'contributi della cassa professionale dedotti per la quota deducibile configurata',
};

export const notaRiepilogo = (deduzione: DeduzioneInps): string =>
  `Stima indicativa basata sui dati inseriti: fatturato calcolato per cassa (data di incasso); ${NOTA_DEDUZIONE[deduzione.fonte]}. Non sostituisce il commercialista.`;

export const getRiepilogoAnno = defineTool({
  name: 'get_riepilogo_anno',
  title: 'Riepilogo fiscale annuale',
  description: 'Fatturato incassato nell\'anno (principio di cassa: conta la data di incasso, le fatture da incassare sono escluse) e stima di imponibile, imposta sostitutiva, contributi, acconti e soglia del regime forfettario, con gli stessi calcoli della Dashboard. I contributi INPS si deducono per cassa (versamenti con data di pagamento nell\'anno, o totale manuale del profilo); deduzioneContributi dice la fonte e se la stima è previsionale. Risponde a "quanto ho incassato".',
  input: { userId: userIdSchema, anno: z.number().int().describe('Anno di imposta') },
  readOnly: true,
  async handler(ctx, { userId, anno }) {
    const snap = await snapshotOf(ctx, userId);
    const config = snap.config ?? { ...DEFAULT_CONFIG, userId };
    const incassate = snap.fatture.filter((f) => isIncassata(f) && annoDi(f.dataIncasso || f.data) === anno);
    const fatturato = round2(incassate.reduce((sum, f) => sum + f.importo, 0));
    const coefficienteRedditivita = calcolaCoefficienteMedioAteco(config.codiciAteco ?? []);
    const aliquotaApplicata = getAliquotaImpostaSostitutiva({ annoApertura: config.annoApertura, annoImposta: anno, aliquotaOverride: config.aliquotaOverride });
    const deduzione = risolviDeduzioneInps(config, anno, snap.scadenze);
    const fiscale = calcolaFiscale(fatturato, coefficienteRedditivita, aliquotaApplicata, getInpsCalculationInput(config, anno), deduzione.contributiVersati);
    const acconti = calcolaAccontiForfettario({ gestionePrevidenziale: config.gestionePrevidenziale, impostaSostitutiva: fiscale.irpef, inps: fiscale.inps });
    const structured = {
      anno,
      criterio: 'cassa' as const,
      fatturato,
      numeroFatture: incassate.length,
      redditoImponibile: fiscale.imponibile,
      impostaSostitutiva: fiscale.irpef,
      contributiPrevidenziali: fiscale.inps,
      contributiDeducibili: fiscale.deduzioneContributi,
      deduzioneContributi: {
        criterio: deduzione.modalita,
        fonte: deduzione.fonte,
        previsionale: deduzione.previsionale,
        versamentiConteggiati: deduzione.versamentiConteggiati,
        versamentiSenzaData: deduzione.versamentiSenzaData,
        descrizione: descriviDeduzioneInps(deduzione, anno),
      },
      entePrevidenziale: calcolaContributiPrevidenziali(fiscale.imponibile, config, anno).label,
      avvisi: [getCassaWarning(config, anno), ...deduzione.avvisi].filter((warning): warning is string => warning !== null),
      totaleStimato: fiscale.totaleTasse,
      aliquotaApplicata,
      coefficienteRedditivita,
      soglia: {
        limite: LIMITE_FATTURATO,
        percentuale: round2((fatturato / LIMITE_FATTURATO) * 100),
        rimanente: round2(LIMITE_FATTURATO - fatturato),
        stato: getRegimeThresholdStatus(fatturato),
      },
      acconti: {
        irpef: round2(acconti.tax1stAcconto + acconti.tax2ndAcconto),
        inps: round2(acconti.inps1stAcconto + acconti.inps2ndAcconto),
      },
      nota: notaRiepilogo(deduzione),
    };
    const text = `${anno}, per cassa: incassato ${euro(fatturato)} su ${incassate.length} fatture; imponibile ${euro(fiscale.imponibile)}, imposta ${euro(fiscale.irpef)}, contributi ${euro(fiscale.inps)}, totale stimato ${euro(fiscale.totaleTasse)}; deduzione contributi ${euro(fiscale.deduzioneContributi)} (${structured.deduzioneContributi.descrizione}); ${structured.entePrevidenziale}; ${structured.avvisi.join(" ")}; soglia ${structured.soglia.percentuale}% (${structured.soglia.stato})`;
    return { structured, text };
  },
});
