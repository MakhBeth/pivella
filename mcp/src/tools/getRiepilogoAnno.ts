import { z } from 'zod';

import { DEFAULT_CONFIG, LIMITE_FATTURATO } from '../../../src/lib/constants/fiscali';
import { calcolaFiscale } from '../../../src/lib/utils/calculations';
import { calcolaAccontiForfettario, calcolaCoefficienteMedioAteco, getAliquotaImpostaSostitutiva, getInpsCalculationInput, getRegimeThresholdStatus } from '../../../src/lib/utils/forfettario';
import { anno as annoDi, defineTool, euro, isIncassata, round2, snapshotOf, userIdSchema } from './shared';

export const NOTA_RIEPILOGO = 'Stima indicativa basata sui dati inseriti, calcolata per cassa, non sostituisce il commercialista.';

export const getRiepilogoAnno = defineTool({
  name: 'get_riepilogo_anno',
  title: 'Riepilogo fiscale annuale',
  description: 'Fatturato incassato nell\'anno (principio di cassa: conta la data di incasso, le fatture da incassare sono escluse) e stima di imponibile, imposta sostitutiva, contributi, acconti e soglia del regime forfettario, con gli stessi calcoli della Dashboard. Risponde a "quanto ho incassato".',
  input: { userId: userIdSchema, anno: z.number().int().describe('Anno di imposta') },
  readOnly: true,
  async handler(ctx, { userId, anno }) {
    const snap = await snapshotOf(ctx, userId);
    const config = snap.config ?? { ...DEFAULT_CONFIG, userId };
    const incassate = snap.fatture.filter((f) => isIncassata(f) && annoDi(f.dataIncasso || f.data) === anno);
    const fatturato = round2(incassate.reduce((sum, f) => sum + f.importo, 0));
    const coefficienteRedditivita = calcolaCoefficienteMedioAteco(config.codiciAteco ?? []);
    const aliquotaApplicata = getAliquotaImpostaSostitutiva({ annoApertura: config.annoApertura, annoImposta: anno, aliquotaOverride: config.aliquotaOverride });
    const fiscale = calcolaFiscale(fatturato, coefficienteRedditivita, aliquotaApplicata, getInpsCalculationInput(config));
    const acconti = calcolaAccontiForfettario({ gestionePrevidenziale: config.gestionePrevidenziale, impostaSostitutiva: fiscale.irpef, inps: fiscale.inps });
    const structured = {
      anno,
      criterio: 'cassa' as const,
      fatturato,
      numeroFatture: incassate.length,
      redditoImponibile: fiscale.imponibile,
      impostaSostitutiva: fiscale.irpef,
      contributiPrevidenziali: fiscale.inps,
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
      nota: NOTA_RIEPILOGO,
    };
    const text = `${anno}, per cassa: incassato ${euro(fatturato)} su ${incassate.length} fatture; imponibile ${euro(fiscale.imponibile)}, imposta ${euro(fiscale.irpef)}, contributi ${euro(fiscale.inps)}, totale stimato ${euro(fiscale.totaleTasse)}; soglia ${structured.soglia.percentuale}% (${structured.soglia.stato})`;
    return { structured, text };
  },
});
