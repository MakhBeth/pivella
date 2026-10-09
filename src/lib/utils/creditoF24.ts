/**
 * Credito da compensare nell'F24: nasce quando gli acconti versati superano il
 * dovuto dell'anno (saldo negativo). Come nell'F24, i debiti restano interi e
 * il credito si usa a parte, dalla prima scadenza in poi finché non si esaurisce.
 */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Credito complessivo dell'anno: acconti versati oltre il dovuto, imposta e contributi. */
export function creditoDaCompensare(voci: Array<{ accontiPagati: number; dovuto: number }>): number {
  return round2(voci.reduce((sum, v) => sum + Math.max(0, v.accontiPagati - v.dovuto), 0));
}

/** Quanto credito si usa in ciascuna scadenza, nell'ordine dato (importi da versare per data). */
export function ripartisciCredito(importi: readonly number[], credito: number): number[] {
  let residuo = round2(Math.max(0, credito));
  return importi.map(importo => {
    const usato = round2(Math.min(residuo, Math.max(0, importo)));
    residuo = round2(residuo - usato);
    return usato;
  });
}
