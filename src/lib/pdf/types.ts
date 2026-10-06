// PDF Invoice Types - adapted from digital-invoice-to-pdf for browser use

export interface Company {
  name?: string;
  vat: string;
  contacts?: {
    tel?: string;
    email?: string;
  };
  office?: {
    address?: string;
    number?: string;
    cap?: string;
    city?: string;
    district?: string;
    country?: string;
  };
}

export interface Line {
  number: number;
  description: string;
  quantity: number;
  singlePrice: number;
  amount: number;
  tax: number;
}

export interface Payment {
  amount: number;
  iban?: string;
  accountHolder?: string;
  bic?: string;
  sortCode?: string;
  accountNumber?: string;
  method?: string;
  type?: string;
  regularPaymentDate?: Date;
  bank?: string;
}

export interface TaxSummary {
  taxPercentage: number;
  taxAmount: number;
  paymentAmount: number;
  legalRef?: string;
}

export interface Installment {
  number: string;
  currency: string;
  totalAmount: number;
  rounding?: number;
  issueDate: Date;
  description?: string;
  lines: Line[];
  payment?: Payment;
  taxSummary: TaxSummary;
  delay?: number;
  attachments?: Array<{ name: string; description: string }>;
  stampDuty?: number;
}

export interface Invoice {
  invoicer: Company;
  invoicee: Company;
  thirdParty?: Company;
  installments: Installment[];
}

export interface Colors {
  primary?: string;
  text?: string;
  lighterText?: string;
  lighterGray?: string;
  footerText?: string;
  tableHeader?: string;
}

export interface PDFOptions {
  colors?: Colors;
  footer?: boolean;
  footerText?: string;
  footerLink?: string;
  locale?: string;
  logoSrc?: string;
  currencyMap?: Record<string, string>; // e.g. { "EUR": "€", "GBP": "£" }
  exchangeRateNote?: string; // e.g. "Cambio BCE del 31/03/2026: 1 EUR = 0.835 GBP"
}
