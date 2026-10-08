import type { PaymentScheduleItem, Scadenza } from '../../types';

const round2 = (v: number) => Math.round(v * 100) / 100;

// Scompone le rate del piano in scadenze per voce (saldo e acconti di imposta e INPS).
export function convertScheduleToScadenze(
  scheduleItems: PaymentScheduleItem[],
  { annoRiferimento, annoVersamento, accontiIrpef, accontiInps }: { annoRiferimento: number; annoVersamento: number; accontiIrpef: number; accontiInps: number },
): Array<Omit<Scadenza, 'userId'>> {
  const result: Array<Omit<Scadenza, 'userId'>> = [];
  let idCounter = Date.now();

  for (const item of scheduleItems) {
    const isSummerBundle = item.label.includes('Saldo') || item.label.includes('Rata');
    const trancheMatch = item.label.match(/Rata (\d+)\/(\d+)/);
    const trancheIndex = trancheMatch ? parseInt(trancheMatch[1]) - 1 : 0;
    const totalTranches = trancheMatch ? parseInt(trancheMatch[2]) : 1;

    // Compute interest shares for each active component, rounded to 2 decimals.
    // The last active component absorbs the rounding remainder so the sum
    // of per-component interest equals item.interestAmount exactly.
    const activeComponents: { key: string; principal: number }[] = [];
    if (item.components.taxSaldo > 0) activeComponents.push({ key: 'taxSaldo', principal: item.components.taxSaldo });
    if (item.components.taxAcconto > 0) activeComponents.push({ key: 'taxAcconto', principal: item.components.taxAcconto });
    if (item.components.inpsSaldo > 0) activeComponents.push({ key: 'inpsSaldo', principal: item.components.inpsSaldo });
    if (item.components.inpsAcconto > 0) activeComponents.push({ key: 'inpsAcconto', principal: item.components.inpsAcconto });

    const interestByKey: Record<string, number> = {};
    if (item.principalAmount > 0 && item.interestAmount > 0 && activeComponents.length > 0) {
      let allocated = 0;
      for (let ci = 0; ci < activeComponents.length; ci++) {
        const comp = activeComponents[ci];
        if (ci === activeComponents.length - 1) {
          // Last component gets the remainder to avoid cent drift
          interestByKey[comp.key] = round2(item.interestAmount - allocated);
        } else {
          const share = round2(item.interestAmount * (comp.principal / item.principalAmount));
          interestByKey[comp.key] = share;
          allocated = round2(allocated + share);
        }
      }
    }

    if (item.components.taxSaldo > 0) {
      const interessi = interestByKey['taxSaldo'] ?? 0;
      result.push({
        id: `${idCounter++}`,
        visibleId: `${annoVersamento}-saldo-irpef-${trancheIndex}`,
        annoRiferimento,
        annoVersamento,
        date: item.date,
        tipo: 'saldo_irpef',
        label: isSummerBundle && totalTranches > 1 ? `Saldo imposta sostitutiva (${trancheIndex + 1}/${totalTranches})` : 'Saldo imposta sostitutiva',
        importo: item.components.taxSaldo,
        interessi,
        totale: round2(item.components.taxSaldo + interessi),
        pagato: false,
        trancheIndex,
        totalTranches,
        accontiIrpefUsed: accontiIrpef,
        accontiInpsUsed: accontiInps,
      });
    }

    if (item.components.taxAcconto > 0) {
      const isSecondAcconto = item.label.includes('Secondo');
      const interessi = interestByKey['taxAcconto'] ?? 0;
      result.push({
        id: `${idCounter++}`,
        visibleId: `${annoVersamento}-acconto-irpef-${isSecondAcconto ? '2' : '1'}-${trancheIndex}`,
        annoRiferimento,
        annoVersamento,
        date: item.date,
        tipo: 'acconto_irpef',
        label: isSecondAcconto 
          ? 'Secondo acconto imposta sostitutiva' 
          : (isSummerBundle && totalTranches > 1 ? `Primo acconto imposta sostitutiva (${trancheIndex + 1}/${totalTranches})` : 'Primo acconto imposta sostitutiva'),
        importo: item.components.taxAcconto,
        interessi,
        totale: round2(item.components.taxAcconto + interessi),
        pagato: false,
        trancheIndex: isSecondAcconto ? 0 : trancheIndex,
        totalTranches: isSecondAcconto ? 1 : totalTranches,
        accontiIrpefUsed: accontiIrpef,
        accontiInpsUsed: accontiInps,
      });
    }

    if (item.components.inpsSaldo > 0) {
      const interessi = interestByKey['inpsSaldo'] ?? 0;
      result.push({
        id: `${idCounter++}`,
        visibleId: `${annoVersamento}-saldo-inps-${trancheIndex}`,
        annoRiferimento,
        annoVersamento,
        date: item.date,
        tipo: 'saldo_inps',
        label: isSummerBundle && totalTranches > 1 ? `Saldo INPS (${trancheIndex + 1}/${totalTranches})` : 'Saldo INPS',
        importo: item.components.inpsSaldo,
        interessi,
        totale: round2(item.components.inpsSaldo + interessi),
        pagato: false,
        trancheIndex,
        totalTranches,
        accontiIrpefUsed: accontiIrpef,
        accontiInpsUsed: accontiInps,
      });
    }

    if (item.components.inpsAcconto > 0) {
      const isSecondAcconto = item.label.includes('Secondo');
      const interessi = interestByKey['inpsAcconto'] ?? 0;
      result.push({
        id: `${idCounter++}`,
        visibleId: `${annoVersamento}-acconto-inps-${isSecondAcconto ? '2' : '1'}-${trancheIndex}`,
        annoRiferimento,
        annoVersamento,
        date: item.date,
        tipo: 'acconto_inps',
        label: isSecondAcconto 
          ? 'Secondo Acconto INPS' 
          : (isSummerBundle && totalTranches > 1 ? `Primo Acconto INPS (${trancheIndex + 1}/${totalTranches})` : 'Primo Acconto INPS'),
        importo: item.components.inpsAcconto,
        interessi,
        totale: round2(item.components.inpsAcconto + interessi),
        pagato: false,
        trancheIndex: isSecondAcconto ? 0 : trancheIndex,
        totalTranches: isSecondAcconto ? 1 : totalTranches,
        accontiIrpefUsed: accontiIrpef,
        accontiInpsUsed: accontiInps,
      });
    }
  }

  return result;
}
