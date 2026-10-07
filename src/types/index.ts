// Type definitions for Pivella

// Special client IDs for non-billable entries (not shown in client management)
export const VACATION_CLIENT_ID = '__vacation__';
export const MISC_CLIENT_ID = '__misc__';

export type StoreName = 'config' | 'clienti' | 'fatture' | 'workLogs' | 'scadenze' | 'users';

// Sync metadata (formato file v2): ogni record degli store porta chi e quando
// lo ha modificato per ultimo. Opzionali perché i dati esistenti non li hanno.
export interface SyncMeta {
  updatedAt?: string; // ISO 8601 UTC
  updatedBy?: string; // writer id
}

// User interface for multi-user support
export interface User extends SyncMeta {
  id: string;
  nome: string;
  createdAt: string;
  color?: string; // Hex color for user theme
}

export type BillingUnit = 'ore' | 'giornata';

// Tariffa del cliente con decorrenza. Senza `dal` vale dall'inizio: è la forma
// in cui entra la tariffa unica dei clienti salvati prima dello storico.
export interface TariffaCliente {
  dal?: string; // YYYY-MM-DD
  rate: number;
  billingUnit: BillingUnit;
}

export interface Cliente extends SyncMeta {
  id: string;
  userId: string;
  nome: string;
  piva?: string;
  email?: string;
  // Specchio dell'ultima tariffa dello storico, per chi legge ancora questi campi.
  // I conti usano rateHistory (vedi lib/utils/tariffe).
  billingUnit?: BillingUnit;
  rate?: number;
  rateHistory?: TariffaCliente[];
  /** @deprecated Non filtra più il riepilogo; si toglie al primo salvataggio dello storico. */
  billingStartDate?: string; // YYYY-MM-DD
  color?: string; // Hex color for calendar display
  // Indirizzo per fatturazione
  indirizzo?: string;
  numeroCivico?: string;
  cap?: string;
  comune?: string;
  provincia?: string;
  nazione?: string; // Default: IT
}

export interface Fattura extends SyncMeta {
  id: string;
  userId: string;
  numero?: string;
  clienteId: string;
  clienteNome: string;
  data: string;
  dataIncasso?: string;
  importo: number; // Always in EUR (for tax calculations)
  importoValuta?: number; // Original amount in foreign currency (only when non-EUR)
  incassato?: boolean;
  duplicateKey?: string;
  valuta?: string;  // Currency code e.g. "EUR", "GBP"
  valutaSimbolo?: string; // Currency symbol e.g. "€", "£"
  tassoCambio?: number; // ECB exchange rate: 1 EUR = X foreign currency
  righe?: FatturaRiga[]; // Righe nella valuta originale; assenti nelle fatture salvate prima della 7.0
  dataCambio?: string; // Data del cambio BCE (YYYY-MM-DD), per rigenerare l'XML in valuta
  righeSource?: 'app' | 'xml'; // Da dove vengono le righe: app (modale o proposta) o XML importato
}

export interface WorkLog extends SyncMeta {
  id: string;
  userId: string;
  clienteId: string;
  data: string;
  ore?: string; // Legacy field, kept for backward compatibility
  tipo: 'ore' | 'giornata';
  quantita?: number; // Fractional quantity (hours or days)
  note?: string;
}

export interface ValutaConfig {
  codice: string;  // e.g. "EUR", "GBP", "USD"
  simbolo: string; // e.g. "€", "£", "$"
}

export type CassaOrdinisticaId = typeof import('../lib/constants/fiscali').CASSE_ORDINISTICHE[number]['value'];
export interface ContributiCassa { annui: number | null; deducibili: number | null }

export type GestionePrevidenziale = 'gestione_separata' | 'artigiani' | 'commercianti' | 'cassa_ordinistica';

export interface Config extends SyncMeta {
  id: string;
  userId: string;
  coefficiente: number;
  aliquota: number;
  ateco: string[];
  aliquotaOverride: number | null;
  nomeAttivita?: string;
  partitaIva?: string;
  annoApertura: number;
  codiciAteco: string[];
  gestionePrevidenziale: GestionePrevidenziale;
  contributiInpsFissi: number | null;
  inpsAnte1996?: boolean;
  gestioneSeparataAltraCopertura?: boolean;
  cassaOrdinistica?: CassaOrdinisticaId;
  contributiCassePerAnno?: Partial<Record<CassaOrdinisticaId, Record<number, ContributiCassa>>>;

  riduzioneContributiva: boolean;
  iban?: string;
  // Coordinate bancarie per conti esteri (es. UK). Il BIC va anche nell'XML SdI
  // accanto all'IBAN; gli altri campi solo sulla fattura di cortesia.
  intestatarioConto?: string;
  bic?: string;
  sortCode?: string;
  numeroConto?: string;
  valute?: ValutaConfig[];
  courtesyInvoice?: CourtesyInvoiceConfig;
  emittente?: EmittenteConfig;
}

export interface Toast {
  message: string;
  type: 'success' | 'error';
}

export interface ImportSummary {
  total: number;
  imported: number;
  duplicates: number;
  enriched: number;
  failed: number;
  failedFiles: Array<{ filename: string; error: string }>;
  righeNonImportate: Array<{ filename: string; motivo: string }>;
}

// Courtesy Invoice Types
export interface ServiceTemplate {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface CourtesyInvoiceConfig {
  // Branding
  logoBase64?: string;
  logoMimeType?: string;
  primaryColor: string;
  textColor: string;

  // Company info
  companyName: string;
  vatNumber: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  iban?: string;
  bankName?: string;

  // Service templates
  defaultServices: ServiceTemplate[];

  // Settings
  includeFooter: boolean;
  footerText?: string;
  footerLink?: string;
  locale: string;
}

export interface CourtesyInvoiceLine {
  id: string;
  number: number;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface CourtesyInvoiceDraft {
  number: string;
  issueDate: Date;
  dueDate?: Date;
  clientId?: string;
  clientName: string;
  clientVat?: string;
  clientAddress?: string;
  description?: string;
  lines: CourtesyInvoiceLine[];
  paymentMethod?: string;
}

// Configurazione emittente per fatture XML FatturaPA
export interface EmittenteConfig {
  // Dati anagrafici
  codiceFiscale: string;
  nome: string;
  cognome: string;
  // Sede
  indirizzo: string;
  numeroCivico: string;
  cap: string;
  comune: string;
  provincia: string;
  nazione: string;
}

// Riga di una fattura: importi nella valuta originale della fattura
export interface FatturaRiga {
  descrizione: string;
  quantita: number;
  prezzoUnitario: number;
}

// Riga fattura per generazione XML
export type NuovaFatturaRiga = FatturaRiga;

// Draft per nuova fattura XML
export interface NuovaFatturaDraft {
  clienteId: string;
  numero: string;
  data: string; // YYYY-MM-DD
  righe: NuovaFatturaRiga[];
}

// Payment Scheduling Types (Regime Forfettario)
export interface PaymentScheduleInput {
  totalTaxSaldo: number;         // Balance for previous year (IRPEF)
  totalTax1stAcconto: number;    // 40% Tax Advance
  totalTax2ndAcconto: number;    // 60% Tax Advance
  totalInpsSaldo: number;        // Social Security Balance
  totalInps1stAcconto: number;   // 40% INPS Advance
  totalInps2ndAcconto: number;   // 60% INPS Advance
  numberOfTranches: 1 | 2 | 3 | 4 | 5 | 6;
  fiscalYear: number;
}

export interface PaymentComponents {
  taxSaldo: number;
  taxAcconto: number;
  inpsSaldo: number;
  inpsAcconto: number;
}

export interface PaymentScheduleItem {
  date: string; // YYYY-MM-DD
  label: string;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  components: PaymentComponents;
}

export type ScadenzaTipo = 'saldo_irpef' | 'acconto_irpef' | 'saldo_inps' | 'acconto_inps';

export interface Scadenza extends SyncMeta {
  id: string;
  userId: string;
  visibleId: string;
  annoRiferimento: number;
  annoVersamento: number;
  date: string; // YYYY-MM-DD
  tipo: ScadenzaTipo;
  label: string;
  importo: number;
  interessi: number;
  totale: number;
  pagato: boolean;
  dataPagamento?: string; // YYYY-MM-DD
  trancheIndex?: number;
  totalTranches?: number;
  // Acconti values used when generating this scadenza (for display/regeneration)
  accontiIrpefUsed?: number;
  accontiInpsUsed?: number;
}
