import type { PaymentScheduleInput, PaymentScheduleItem, PaymentComponents } from '../../types';
import {
  INTERESSE_RATEIZZAZIONE_MENSILE,
  GIORNO_SCADENZA_RATE,
  GIORNO_SCADENZA_AGOSTO,
  GIORNO_SCADENZA_SALDO,
} from '../constants/fiscali';
import { formatDate, adjustForWeekend } from './dateHelpers';

const roundToTwoDecimals = (value: number): number => {
  return Math.round(value * 100) / 100;
};

// Quota per rata in centesimi interi, arrotondata per difetto: l'ultima rata
// assorbe il resto e non può mai diventare negativa.
const quotaPerRata = (total: number, numberOfTranches: number): number =>
  Math.floor(Math.round(total * 100) / numberOfTranches) / 100;

const distributeComponents = (
  taxSaldo: number,
  taxAcconto: number,
  inpsSaldo: number,
  inpsAcconto: number,
  numberOfTranches: number,
  trancheIndex: number
): PaymentComponents => {
  const isLastTranche = trancheIndex === numberOfTranches - 1;
  const quota = (total: number): number => isLastTranche
    ? roundToTwoDecimals(total - quotaPerRata(total, numberOfTranches) * trancheIndex)
    : quotaPerRata(total, numberOfTranches);

  return {
    taxSaldo: quota(taxSaldo),
    taxAcconto: quota(taxAcconto),
    inpsSaldo: quota(inpsSaldo),
    inpsAcconto: quota(inpsAcconto),
  };
};

const JUNE = 5;
const AUGUST = 7;

const getTrancheDeadline = (fiscalYear: number, trancheIndex: number): Date => {
  if (trancheIndex === 0) {
    return new Date(fiscalYear, JUNE, GIORNO_SCADENZA_SALDO);
  }
  
  const month = JUNE + trancheIndex;
  const day = month === AUGUST ? GIORNO_SCADENZA_AGOSTO : GIORNO_SCADENZA_RATE;
  
  return new Date(fiscalYear, month, day);
};

const formatTrancheLabel = (trancheIndex: number, totalTranches: number): string => {
  if (totalTranches === 1) {
    return 'Saldo e Primo Acconto imposta sostitutiva/INPS';
  }
  return `Rata ${trancheIndex + 1}/${totalTranches} - Saldo e Primo Acconto`;
};

export const generatePaymentSchedule = (input: PaymentScheduleInput): PaymentScheduleItem[] => {
  const {
    totalTaxSaldo,
    totalTax1stAcconto,
    totalTax2ndAcconto,
    totalInpsSaldo,
    totalInps1stAcconto,
    totalInps2ndAcconto,
    numberOfTranches,
    fiscalYear,
  } = input;

  const schedule: PaymentScheduleItem[] = [];

  for (let i = 0; i < numberOfTranches; i++) {
    const deadline = getTrancheDeadline(fiscalYear, i);
    const adjustedDeadline = adjustForWeekend(deadline);
    
    const monthsFromFirst = i;
    const interestRate = monthsFromFirst * INTERESSE_RATEIZZAZIONE_MENSILE;
    
    const components = distributeComponents(
      totalTaxSaldo,
      totalTax1stAcconto,
      totalInpsSaldo,
      totalInps1stAcconto,
      numberOfTranches,
      i
    );
    
    const componentSum = components.taxSaldo + components.taxAcconto + 
                         components.inpsSaldo + components.inpsAcconto;
    const principalAmount = roundToTwoDecimals(componentSum);
    const interestAmount = roundToTwoDecimals(principalAmount * interestRate);
    
    schedule.push({
      date: formatDate(adjustedDeadline),
      label: formatTrancheLabel(i, numberOfTranches),
      principalAmount,
      interestAmount,
      totalAmount: roundToTwoDecimals(principalAmount + interestAmount),
      components,
    });
  }

  const novemberTotal = totalTax2ndAcconto + totalInps2ndAcconto;
  if (novemberTotal > 0) {
      schedule.push({
        date: formatDate(adjustForWeekend(new Date(fiscalYear, 10, GIORNO_SCADENZA_SALDO))),
        label: 'Secondo Acconto imposta sostitutiva e INPS',
        principalAmount: roundToTwoDecimals(novemberTotal),
        interestAmount: 0,
      totalAmount: roundToTwoDecimals(novemberTotal),
      components: {
        taxSaldo: 0,
        taxAcconto: roundToTwoDecimals(totalTax2ndAcconto),
        inpsSaldo: 0,
        inpsAcconto: roundToTwoDecimals(totalInps2ndAcconto),
      },
    });
  }

  return schedule;
};

export const calculateScheduleTotals = (schedule: PaymentScheduleItem[]): {
  totalPrincipal: number;
  totalInterest: number;
  grandTotal: number;
} => {
  const totalPrincipal = schedule.reduce((sum, item) => sum + item.principalAmount, 0);
  const totalInterest = schedule.reduce((sum, item) => sum + item.interestAmount, 0);
  
  return {
    totalPrincipal: roundToTwoDecimals(totalPrincipal),
    totalInterest: roundToTwoDecimals(totalInterest),
    grandTotal: roundToTwoDecimals(totalPrincipal + totalInterest),
  };
};
