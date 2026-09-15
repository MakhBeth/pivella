import type { Config, GestionePrevidenziale } from '../../types';

// Database constants
export const DB_NAME = 'ForfettarioDB';
export const DB_VERSION = 3;
export const STORES = ['config', 'clienti', 'fatture', 'workLogs', 'scadenze', 'users'] as const;

// Fiscal constants
export const LIMITE_FATTURATO = 85000;
export const LIMITE_USCITA_IMMEDIATA = 100000;
export const INPS_GESTIONE_SEPARATA = 0.2607;
export const RIDUZIONE_CONTRIBUTIVA_FORFETTARIO = 0.35;
export const ALIQUOTA_RIDOTTA = 0.05;
export const ALIQUOTA_STANDARD = 0.15;
export const MAX_HISTORICAL_YEARS = 10;

export const GESTIONI_PREVIDENZIALI: Array<{ value: GestionePrevidenziale; label: string }> = [
  { value: 'gestione_separata', label: 'Gestione Separata (INPS)' },
  { value: 'artigiani', label: 'Gestione Artigiani' },
  { value: 'commercianti', label: 'Gestione Commercianti' },
  { value: 'cassa_ordinistica', label: 'Cassa professionale / ordinistica' },
];

// ATECO coefficients
export const COEFFICIENTI_ATECO: Record<string, number> = {
  '62': 67, '63': 67, '70': 78, '71': 78, '72': 78,
  '73': 78, '74': 78, '69': 78, '85': 78, '86': 78,
  'default': 78
};

// Payment scheduling constants
export const INTERESSE_RATEIZZAZIONE_MENSILE = 0.0033; // 0.33% monthly interest
export const GIORNO_SCADENZA_RATE = 16; // Standard monthly deadline
export const GIORNO_SCADENZA_AGOSTO = 20; // August exception
export const GIORNO_SCADENZA_SALDO = 30; // June 30 and November 30

// Default configuration
export const DEFAULT_CONFIG: Config = {
  id: 'main',
  userId: '',
  coefficiente: 0,
  aliquota: 0,
  ateco: [],
  partitaIva: '',
  annoApertura: new Date().getFullYear(),
  codiciAteco: [],
  nomeAttivita: '',
  aliquotaOverride: null,
  gestionePrevidenziale: 'gestione_separata',
  contributiInpsFissi: null,
  riduzioneContributiva: false,
  valute: [{ codice: 'EUR', simbolo: '€' }],
  courtesyInvoice: {
    primaryColor: '#6699cc',
    textColor: '#033243',
    companyName: '',
    vatNumber: '',
    country: 'IT',
    defaultServices: [],
    includeFooter: true,
    locale: 'it'
  }
};

// Fonte: Ministero del Lavoro, elenco enti previdenziali di diritto privato.
// https://lavoro.gov.it/temi-e-priorita/previdenza/focus-on/vigilanza-enti-previdenza-privata/pagine/elenco-enti-previdenziali-di-diritto-privato
export const CASSE_ORDINISTICHE = [
  { value: 'forense', label: 'Cassa Forense — Avvocati' },
  { value: 'geometri', label: 'Cassa Geometri' },
  { value: 'notariato', label: 'Cassa del Notariato' },
  { value: 'cnpadc', label: 'CNPADC — Dottori commercialisti' },
  { value: 'cnpr', label: 'CNPR — Ragionieri e periti commerciali' },
  { value: 'enpab', label: 'ENPAB — Biologi' },
  { value: 'enpacl', label: 'ENPACL — Consulenti del lavoro' },
  { value: 'enpaf', label: 'ENPAF — Farmacisti' },
  { value: 'enpaia_agrotecnici', label: 'ENPAIA — Agrotecnici' },
  { value: 'enpaia_periti_agrari', label: 'ENPAIA — Periti agrari' },
  { value: 'enpam', label: 'ENPAM — Medici e odontoiatri' },
  { value: 'enpap', label: 'ENPAP — Psicologi' },
  { value: 'enpapi', label: 'ENPAPI — Infermieri' },
  { value: 'enpav', label: 'ENPAV — Veterinari' },
  { value: 'epap', label: 'EPAP — Attuari, chimici e fisici, agronomi e forestali, geologi' },
  { value: 'eppi', label: 'EPPI — Periti industriali' },
  { value: 'inarcassa', label: 'Inarcassa — Ingegneri e architetti' },
  { value: 'inpgi', label: 'INPGI — Giornalisti autonomi' },
  { value: 'altra', label: 'Altra cassa professionale' },
] as const;
