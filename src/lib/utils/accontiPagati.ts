import type { Scadenza } from '../../types';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Acconti pagati per l'anno d'imposta `anno`, da scalare dal suo saldo.
 * Gli acconti dell'anno N stanno nel piano con annoVersamento N (quello che ha
 * annoRiferimento N - 1, insieme al saldo dell'anno prima): per questo si
 * filtra su annoVersamento e non su annoRiferimento.
 */
export function accontiPagatiPerAnno(scadenze: readonly Scadenza[], anno: number): { irpefPaid: number; inpsPaid: number } {
  const pagati = scadenze.filter(s => s.annoVersamento === anno && s.pagato);
  return {
    irpefPaid: round2(pagati.filter(s => s.tipo === 'acconto_irpef').reduce((sum, s) => sum + s.importo, 0)),
    inpsPaid: round2(pagati.filter(s => s.tipo === 'acconto_inps').reduce((sum, s) => sum + s.importo, 0)),
  };
}
