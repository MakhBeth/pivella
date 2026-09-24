# Righe in fattura, XML alla conferma, cortesia da fatture salvate e da MCP: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le fatture salvate conservano le righe; alla conferma di una proposta l'app scarica l'XML; XML e fattura di cortesia si generano da una fattura salvata, nell'app e dal server MCP.

**Architecture:** campo opzionale `righe` in `Fattura`, schema di sync v3. Un modulo puro `src/lib/fatturaDocumento.ts` costruisce da (fattura, cliente, config) sia l'input di `generateFatturaXML` sia l'`Invoice` del renderer PDF: lo usano app e MCP. L'import XML estrae le righe solo quando l'XML è rappresentabile (`src/lib/xml/righeFromXml.ts`, basato solo su `getElementsByTagName` per girare anche in Node). L'MCP aggiunge due tool che scrivono file in modo esclusivo in una cartella documenti.

**Tech Stack:** TypeScript, React 18, `@react-pdf/renderer` 4, test con `node:test` via `tsx --test` (file `*.test.ts` accanto al sorgente), `@xmldom/xmldom` (nuova devDependency) per il DOM nei test, MCP SDK, esbuild.

**Spec:** `docs/superpowers/specs/2026-09-24-righe-fattura-xml-cortesia-design.md`

## Global Constraints

- Versioni di arrivo: app `7.0.0` (`package.json`), `pivella-mcp` `1.0.0` (`mcp/package.json`), `SYNC_SCHEMA_VERSION = 3`.
- La v3 legge file v2 e v3, scrive sempre v3; ogni altra versione resta rifiutata con `SOURCE_UNAVAILABLE` "Versione del file di sync non supportata".
- Righe di un record: array non vuoto, `descrizione` non vuota, `quantita` finito > 0, `prezzoUnitario` finito >= 0, totale > 0. Proposte: `prezzoUnitario` > 0 (invariato).
- Nessun punto di scrittura salva righe che `validateFatturaRighe` rifiuta: fallback a fattura senza righe.
- L'MCP non scrive mai il file di sync fuori da `addProposal`/`withdrawProposal`; i nuovi tool scrivono solo file XML/PDF.
- File MCP: componenti del nome da `safeFileComponent` (`[^A-Za-z0-9_-]` → `-`), percorso risolto dentro la cartella di destinazione, creazione con `fs.open(path, 'wx')`, suffissi `-2`...`-100` su `EEXIST`.
- Testi user-facing in italiano, niente em-dash (vedi memoria "no em-dash").
- Commit senza `Co-Authored-By` e senza "Generated with Claude Code" (istruzioni utente). Si lavora su `main`, push diretto (richiesta dell'utente).
- Comandi: test `npm test`; singolo file `npx tsx --test <file>`; typecheck `npm run lint`; build app `npm run build`; build MCP `npm run mcp:build`.

## Review Focus

1. Fattura in valuta estera generata dall'app e reimportata: le righe devono tornare nella valuta originale con lo stesso cambio, e l'XML rigenerato deve avere gli stessi importi EUR (test di andata e ritorno nel Task 4).
2. Conferma di una proposta con nuovo cliente: l'XML scaricato deve usare il cliente appena creato, che non è ancora nello stato React (Task 6 usa i record del piano, non lo stato).
3. File di sync scritto da un'app 6.x (v2) con fatture senza righe: la 7.0 lo legge, le fatture restano senza righe e XML/PDF usano il fallback (Task 1 e Task 2).
4. Numero fattura con `/` o `..` nel nome del file MCP: il file resta nella cartella scelta (Task 9).
5. Un XML esterno con bollo addebitato (imponibile 100, totale 102): importato senza righe e segnalato, mai con righe che rigenererebbero 100 (Task 4 e Task 5).

---

### Task 1: Tipi, validatore delle righe, schema di sync v3

**Files:**
- Modify: `src/types/index.ts` (interfaccia `Fattura` righe 43-58, `NuovaFatturaRiga` righe 195-200)
- Modify: `src/lib/sync/validate.ts` (tipo `FatturaRigaPayload` righe 57-61, nuova funzione dopo `validateRighe`)
- Modify: `src/lib/sync/schema.ts` (righe 10, 58, 125-141, 164-170)
- Test: `src/lib/sync/schema.test.ts`, `src/lib/sync/validate.test.ts`

**Interfaces:**
- Produces: `FatturaRiga` (tipo in `src/types`), `Fattura.righe?`, `Fattura.dataCambio?`, `Fattura.righeSource?`; `validateFatturaRighe(raw: unknown): { ok: true; righe: FatturaRiga[] } | { ok: false; reason: string }` in `src/lib/sync/validate.ts`; `SYNC_SCHEMA_VERSION = 3`, `SUPPORTED_SCHEMA_VERSIONS = [2, 3]` in `schema.ts`.

- [ ] **Step 1: Test del validatore (falliscono)**

In `src/lib/sync/validate.test.ts` aggiungi in fondo (l'import di `validateFatturaRighe` va aggiunto a quello esistente da `./validate`):

```ts
test('validateFatturaRighe accepts zero-priced lines but not a zero total', () => {
  assert.deepEqual(validateFatturaRighe([{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 50 }, { descrizione: 'Nota', quantita: 1, prezzoUnitario: 0 }]), {
    ok: true,
    righe: [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 50 }, { descrizione: 'Nota', quantita: 1, prezzoUnitario: 0 }],
  });
  assert.equal(validateFatturaRighe([{ descrizione: 'Nota', quantita: 1, prezzoUnitario: 0 }]).ok, false);
});

test('validateFatturaRighe rejects empty, negative, non-finite and malformed lines', () => {
  for (const raw of [
    [],
    'x',
    [{ descrizione: '', quantita: 1, prezzoUnitario: 10 }],
    [{ descrizione: 'A', quantita: 0, prezzoUnitario: 10 }],
    [{ descrizione: 'A', quantita: 1, prezzoUnitario: -5 }],
    [{ descrizione: 'A', quantita: Number.NaN, prezzoUnitario: 10 }],
    [{ descrizione: 'A', quantita: 1, prezzoUnitario: Infinity }],
    [null],
  ]) {
    assert.equal(validateFatturaRighe(raw).ok, false, JSON.stringify(raw));
  }
});

test('validateFatturaRighe keeps only the three known fields', () => {
  const out = validateFatturaRighe([{ descrizione: 'A', quantita: 1, prezzoUnitario: 10, extra: true }]);
  assert.deepEqual(out, { ok: true, righe: [{ descrizione: 'A', quantita: 1, prezzoUnitario: 10 }] });
});
```

- [ ] **Step 2: Test dello schema (falliscono)**

In `src/lib/sync/schema.test.ts`: cambia `assert.equal(SYNC_SCHEMA_VERSION, 2);` (riga 34) in `assert.equal(SYNC_SCHEMA_VERSION, 3);`. Il test di riga 76 costruisce un file con `schemaVersion: 3` e si aspetta il rifiuto: cambialo in `schemaVersion: 4`. Poi aggiungi:

```ts
test('a v2 file is read by v3 and written back as v3', () => {
  const v2 = { ...createEmptySnapshot({ now: NOW, writer: WRITER }), schemaVersion: 2 };
  v2.fatture.push({ id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'Acme', data: '2026-01-10', importo: 100 });
  const { snapshot } = parseSyncFile(JSON.stringify(v2), { now: NOW, writer: WRITER });
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.fatture[0].righe, undefined);
});

test('fatture with valid righe and dataCambio pass, malformed ones make the file unusable', () => {
  const base = createEmptySnapshot({ now: NOW, writer: WRITER });
  const good = { ...base, fatture: [{ id: 'f1', userId: 'u1', clienteId: 'c1', clienteNome: 'A', data: '2026-01-10', importo: 100, righe: [{ descrizione: 'X', quantita: 1, prezzoUnitario: 100 }], dataCambio: '2026-01-09' }] };
  assert.equal(parseSyncFile(JSON.stringify(good), { now: NOW, writer: WRITER }).snapshot.fatture[0].righe?.length, 1);
  const badRighe = { ...base, fatture: [{ ...good.fatture[0], righe: [{ descrizione: 'X', quantita: -1, prezzoUnitario: 100 }] }] };
  assert.throws(() => parseSyncFile(JSON.stringify(badRighe), { now: NOW, writer: WRITER }), (e: unknown) => (e as SyncSchemaError).code === 'SOURCE_UNAVAILABLE');
  const badData = { ...base, fatture: [{ ...good.fatture[0], dataCambio: '09/01/2026' }] };
  assert.throws(() => parseSyncFile(JSON.stringify(badData), { now: NOW, writer: WRITER }), (e: unknown) => (e as SyncSchemaError).code === 'SOURCE_UNAVAILABLE');
});
```

Se `SyncSchemaError` non è già importato nel file, aggiungilo all'import da `./schema`.

- [ ] **Step 3: Esegui e verifica il fallimento**

Run: `npx tsx --test src/lib/sync/validate.test.ts src/lib/sync/schema.test.ts`
Expected: FAIL (`validateFatturaRighe` non esportata, versione 2 invece di 3).

- [ ] **Step 4: Tipi**

In `src/types/index.ts` sostituisci `NuovaFatturaRiga` con:

```ts
// Riga di una fattura: importi nella valuta originale della fattura
export interface FatturaRiga {
  descrizione: string;
  quantita: number;
  prezzoUnitario: number;
}

// Riga fattura per generazione XML
export type NuovaFatturaRiga = FatturaRiga;
```

e in `Fattura`, dopo `tassoCambio?`:

```ts
  righe?: FatturaRiga[]; // Righe nella valuta originale; assenti nelle fatture salvate prima della 7.0
  dataCambio?: string; // Data del cambio BCE (YYYY-MM-DD), per rigenerare l'XML in valuta
  righeSource?: 'app' | 'xml'; // Da dove vengono le righe: app (modale o proposta) o XML importato
```

In `src/lib/sync/validate.ts` sostituisci l'interfaccia `FatturaRigaPayload` con `export type FatturaRigaPayload = FatturaRiga;` e aggiungi `type FatturaRiga` all'import da `'../../types'`.

- [ ] **Step 5: Validatore**

In `src/lib/sync/validate.ts`, dopo `validateRighe`:

```ts
export type FatturaRigheCheck = { ok: true; righe: FatturaRiga[] } | { ok: false; reason: string };

/**
 * Righe ammesse in un record `Fattura` (non in una proposta, che resta più
 * severa): prezzo zero consentito per le righe descrittive, totale positivo.
 * Chi scrive una fattura passa di qui prima di salvare le righe.
 */
export function validateFatturaRighe(raw: unknown): FatturaRigheCheck {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: 'righe: almeno una riga' };
  const righe: FatturaRiga[] = [];
  for (const [i, riga] of raw.entries()) {
    if (typeof riga !== 'object' || riga === null || Array.isArray(riga)) return { ok: false, reason: `righe[${i}]: deve essere un oggetto` };
    const { descrizione, quantita, prezzoUnitario } = riga as Record<string, unknown>;
    if (typeof descrizione !== 'string' || descrizione.trim().length === 0) return { ok: false, reason: `righe[${i}].descrizione: obbligatoria` };
    if (typeof quantita !== 'number' || !Number.isFinite(quantita) || quantita <= 0) return { ok: false, reason: `righe[${i}].quantita: numero positivo` };
    if (typeof prezzoUnitario !== 'number' || !Number.isFinite(prezzoUnitario) || prezzoUnitario < 0) return { ok: false, reason: `righe[${i}].prezzoUnitario: numero non negativo` };
    righe.push({ descrizione, quantita, prezzoUnitario });
  }
  const totale = righe.reduce((sum, r) => sum + r.quantita * r.prezzoUnitario, 0);
  if (!(totale > 0)) return { ok: false, reason: 'righe: il totale deve essere positivo' };
  return { ok: true, righe };
}
```

- [ ] **Step 6: Schema v3**

In `src/lib/sync/schema.ts`:

```ts
export const SYNC_SCHEMA_VERSION = 3 as const;
/** Versioni leggibili: la v2 non ha righe nelle fatture, per il resto è identica. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [2, 3];
```

Il controllo di versione in `parseSyncFile` diventa:

```ts
  const version = obj.schemaVersion;
  if (typeof version !== 'number' || !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    throw new SyncSchemaError('SOURCE_UNAVAILABLE', `Versione del file di sync non supportata: ${String(version)}`, {
      schemaVersion: version,
      supported: SYNC_SCHEMA_VERSION,
    });
  }
```

(`createEmptySnapshot` scrive già `SYNC_SCHEMA_VERSION`, quindi lo snapshot letto è v3.) In `validateStore`, dopo `seen.add(id);`:

```ts
    if (store === 'fatture') validateFatturaFields(record as Record<string, unknown>, id);
```

e sopra `validateStore`:

```ts
function validateFatturaFields(record: Record<string, unknown>, id: string): void {
  if (record.righe !== undefined) {
    const check = validateFatturaRighe(record.righe);
    if (!check.ok) throw new SyncSchemaError('SOURCE_UNAVAILABLE', `Fattura ${id}: ${check.reason}`, { store: 'fatture', id });
  }
  if (record.dataCambio !== undefined && !isIsoDate(record.dataCambio)) {
    throw new SyncSchemaError('SOURCE_UNAVAILABLE', `Fattura ${id}: dataCambio non valida`, { store: 'fatture', id });
  }
}
```

con `import { isIsoDate, validateFatturaRighe } from './validate';`. Se nasce un ciclo di import (`validate.ts` importa `ProposalKind` da `schema.ts` solo come tipo, quindi non dovrebbe), verificalo al passo successivo.

- [ ] **Step 7: Esegui tutti i test**

Run: `npm test && npm run lint`
Expected: PASS. Se qualche test esistente costruisce file con `schemaVersion: 2` e confronta l'output letteralmente, aggiorna l'atteso a 3.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/lib/sync/validate.ts src/lib/sync/validate.test.ts src/lib/sync/schema.ts src/lib/sync/schema.test.ts
git commit -m "feat(sync): righe nelle fatture e schema di sync v3"
```

---

### Task 2: Modulo condiviso `fatturaDocumento`

**Files:**
- Create: `src/lib/fatturaDocumento.ts`
- Test: `src/lib/fatturaDocumento.test.ts`

**Interfaces:**
- Consumes: `FatturaRiga`, `validateFatturaRighe` (Task 1); `FatturaXMLData`, `generateFatturaXML` da `src/lib/xml/generator.ts`; `Invoice`, `PDFOptions` da `src/lib/pdf/types.ts`.
- Produces:
  - `FALLBACK_DESCRIZIONE = 'Prestazione professionale'`
  - `righeOrFallback(f: Fattura): { righe: FatturaRiga[]; fallback: boolean }`
  - `clienteXMLData(c: Cliente | undefined, clienteNome: string): FatturaXMLData['cliente']`
  - `class DatiEmittenteMancantiError extends Error { campi: string[] }`
  - `emittenteMancante(config: Config | null): string[]`
  - `buildFatturaXMLData(f: Fattura, c: Cliente | undefined, config: Config): FatturaXMLData`
  - `buildCourtesyInvoice(f: Fattura, c: Cliente | undefined, config: Config): Invoice`
  - `buildPdfOptions(config: Config, overrides?: { locale?: string }): PDFOptions`
  - `FORFETTARIO_LEGAL_REF` (stringa)

- [ ] **Step 1: Test (falliscono)**

Crea `src/lib/fatturaDocumento.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG } from './constants/fiscali';
import type { Cliente, Config, Fattura } from '../types';
import { buildCourtesyInvoice, buildFatturaXMLData, buildPdfOptions, clienteXMLData, DatiEmittenteMancantiError, emittenteMancante, righeOrFallback } from './fatturaDocumento';
import { generateFatturaXML } from './xml/generator';

const config: Config = {
  ...DEFAULT_CONFIG, id: 'config_u1', userId: 'u1', partitaIva: '01234567890', iban: 'IT60X0542811101000000123456',
  valute: [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }],
  emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via Roma', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
  courtesyInvoice: { ...DEFAULT_CONFIG.courtesyInvoice!, primaryColor: '#112233', textColor: '#000000', locale: 'en', includeFooter: false, logoBase64: 'data:image/png;base64,AAAA' },
};
const cliente: Cliente = { id: 'c1', userId: 'u1', nome: 'Acme Srl', piva: '09876543210', indirizzo: 'Via Milano', numeroCivico: '2', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT' };
const conRighe: Fattura = { id: 'f1', userId: 'u1', numero: '07', data: '2026-03-10', clienteId: 'c1', clienteNome: 'Acme Srl', importo: 1000, valuta: 'EUR', valutaSimbolo: '€', righe: [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }] };
const senzaRighe: Fattura = { id: 'f2', userId: 'u1', numero: '08', data: '2026-03-11', clienteId: 'c1', clienteNome: 'Acme Srl', importo: 50 };
const gbp: Fattura = { id: 'f3', userId: 'u1', numero: '09', data: '2026-04-01', clienteId: 'c1', clienteNome: 'Acme Srl', importo: 1190.48, importoValuta: 1000, valuta: 'GBP', valutaSimbolo: '£', tassoCambio: 0.84, dataCambio: '2026-03-31', righe: [{ descrizione: 'Workshop', quantita: 1, prezzoUnitario: 1000 }] };

test('righeOrFallback returns saved righe or a single line with the original-currency total', () => {
  assert.deepEqual(righeOrFallback(conRighe), { righe: conRighe.righe, fallback: false });
  assert.deepEqual(righeOrFallback(senzaRighe), { righe: [{ descrizione: 'Prestazione professionale', quantita: 1, prezzoUnitario: 50 }], fallback: true });
  const { righe, ...gbpSenza } = gbp;
  assert.deepEqual(righeOrFallback(gbpSenza).righe, [{ descrizione: 'Prestazione professionale', quantita: 1, prezzoUnitario: 1000 }]);
  assert.ok(righe);
});

test('clienteXMLData maps the anagrafica and falls back to the saved name', () => {
  assert.deepEqual(clienteXMLData(cliente, 'x'), { denominazione: 'Acme Srl', partitaIva: '09876543210', nazione: 'IT', indirizzo: 'Via Milano', numeroCivico: '2', cap: '20100', comune: 'Milano', provincia: 'MI' });
  assert.deepEqual(clienteXMLData(undefined, 'Cliente sparito'), { denominazione: 'Cliente sparito', nazione: 'IT' });
});

test('emittenteMancante lists the missing fields', () => {
  assert.deepEqual(emittenteMancante(config), []);
  assert.deepEqual(emittenteMancante({ ...config, partitaIva: '', emittente: { ...config.emittente!, codiceFiscale: '', comune: '' } }), ['partitaIva', 'emittente.codiceFiscale', 'emittente.comune']);
  assert.ok(emittenteMancante(null).length > 0);
});

test('buildFatturaXMLData carries righe, iban, currency and exchange date', () => {
  const eur = buildFatturaXMLData(conRighe, cliente, config);
  assert.equal(eur.numero, '07');
  assert.equal(eur.iban, config.iban);
  assert.equal(eur.beneficiario, 'Mario Rossi');
  assert.equal(eur.valuta, undefined);
  const g = buildFatturaXMLData(gbp, cliente, config);
  assert.equal(g.valuta, 'GBP');
  assert.equal(g.tassoCambio, 0.84);
  assert.equal(g.dataCambio, '2026-03-31');
  const xml = generateFatturaXML(g);
  assert.match(xml, /<ImportoTotaleDocumento>1190\.48<\/ImportoTotaleDocumento>/);
  assert.match(xml, /<RiferimentoData>2026-03-31<\/RiferimentoData>/);
});

test('buildFatturaXMLData throws DatiEmittenteMancantiError when the emittente is incomplete', () => {
  assert.throws(() => buildFatturaXMLData(conRighe, cliente, { ...config, partitaIva: '' }), (e: unknown) => e instanceof DatiEmittenteMancantiError && e.campi.includes('partitaIva'));
});

test('buildCourtesyInvoice builds lines, stamp duty over 77.47 EUR and payment', () => {
  const inv = buildCourtesyInvoice(conRighe, cliente, config);
  const inst = inv.installments[0];
  assert.equal(inv.invoicee.name, 'Acme Srl');
  assert.equal(inv.invoicer.vat, '01234567890');
  assert.equal(inst.number, '07');
  assert.equal(inst.currency, 'EUR');
  assert.equal(inst.totalAmount, 1000);
  assert.equal(inst.stampDuty, 2);
  assert.deepEqual(inst.lines.map((l) => [l.description, l.quantity, l.singlePrice, l.amount, l.tax]), [['Sviluppo', 2, 500, 1000, 0]]);
  assert.equal(inst.payment?.iban, config.iban);
  assert.equal(buildCourtesyInvoice(senzaRighe, cliente, config).installments[0].stampDuty, undefined);
  const g = buildCourtesyInvoice(gbp, cliente, config).installments[0];
  assert.equal(g.currency, 'GBP');
  assert.equal(g.totalAmount, 1000);
  assert.equal(g.stampDuty, 2);
});

test('buildPdfOptions reads the courtesy settings and allows a locale override', () => {
  const o = buildPdfOptions(config);
  assert.equal(o.colors?.primary, '#112233');
  assert.equal(o.locale, 'en');
  assert.equal(o.footer, false);
  assert.equal(o.logoSrc, 'data:image/png;base64,AAAA');
  assert.deepEqual(o.currencyMap, { EUR: '€', GBP: '£' });
  assert.equal(buildPdfOptions(config, { locale: 'it' }).locale, 'it');
});
```

Se `DEFAULT_CONFIG.courtesyInvoice` non definisce `includeFooter`/`locale`, i campi espliciti nel test li coprono.

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `npx tsx --test src/lib/fatturaDocumento.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementazione**

Crea `src/lib/fatturaDocumento.ts`:

```ts
/**
 * Da una fattura salvata ai suoi documenti: input dell'XML FatturaPA e
 * fattura di cortesia per il renderer PDF. Modulo puro, senza DOM né Node:
 * lo usano l'app (modale, conferma delle proposte, lista, pagina Cortesia)
 * e il server MCP, così i documenti escono uguali da entrambe le parti.
 */
import type { Cliente, Config, Fattura, FatturaRiga } from '../types';
import type { FatturaXMLData } from './xml/generator';
import type { Invoice, PDFOptions } from './pdf/types';

export const FALLBACK_DESCRIZIONE = 'Prestazione professionale';
export const FORFETTARIO_LEGAL_REF = "Operazione in franchigia da IVA ai sensi dell'art. 1, commi 54-89, L. 190/2014";
const BOLLO_SOGLIA_EUR = 77.47;
const BOLLO_IMPORTO = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;
const isForeign = (f: Fattura) => Boolean(f.valuta && f.valuta !== 'EUR' && f.tassoCambio);

/** Righe salvate, oppure una riga unica con il totale nella valuta originale. */
export function righeOrFallback(f: Fattura): { righe: FatturaRiga[]; fallback: boolean } {
  if (f.righe && f.righe.length > 0) return { righe: f.righe, fallback: false };
  const totale = f.importoValuta ?? f.importo;
  return { righe: [{ descrizione: FALLBACK_DESCRIZIONE, quantita: 1, prezzoUnitario: totale }], fallback: true };
}

/** Blocco cliente dell'XML dall'anagrafica, come in NuovaFatturaModal. */
export function clienteXMLData(c: Cliente | undefined, clienteNome: string): FatturaXMLData['cliente'] {
  if (!c) return { denominazione: clienteNome, nazione: 'IT' };
  const out: FatturaXMLData['cliente'] = { denominazione: c.nome, nazione: c.nazione || 'IT' };
  if (c.piva) out.partitaIva = c.piva;
  if (c.indirizzo) out.indirizzo = c.indirizzo;
  if (c.numeroCivico) out.numeroCivico = c.numeroCivico;
  if (c.cap) out.cap = c.cap;
  if (c.comune) out.comune = c.comune;
  if (c.provincia) out.provincia = c.provincia;
  return out;
}

export class DatiEmittenteMancantiError extends Error {
  campi: string[];
  constructor(campi: string[]) {
    super(`Dati emittente mancanti: ${campi.join(', ')}. Completali nelle Impostazioni.`);
    this.name = 'DatiEmittenteMancantiError';
    this.campi = campi;
  }
}

const EMITTENTE_OBBLIGATORI = ['codiceFiscale', 'nome', 'cognome', 'indirizzo', 'cap', 'comune'] as const;

/** Campi obbligatori per un XML valido che mancano nella configurazione. */
export function emittenteMancante(config: Config | null): string[] {
  const campi: string[] = [];
  if (!config?.partitaIva) campi.push('partitaIva');
  for (const k of EMITTENTE_OBBLIGATORI) if (!config?.emittente?.[k]) campi.push(`emittente.${k}`);
  return campi;
}

export function buildFatturaXMLData(f: Fattura, c: Cliente | undefined, config: Config): FatturaXMLData {
  const mancanti = emittenteMancante(config);
  if (mancanti.length > 0) throw new DatiEmittenteMancantiError(mancanti);
  const emittente = config.emittente!;
  const foreign = isForeign(f);
  return {
    emittente,
    partitaIva: config.partitaIva!,
    cliente: clienteXMLData(c, f.clienteNome),
    numero: f.numero ?? '',
    data: f.data,
    righe: righeOrFallback(f).righe,
    iban: config.iban,
    beneficiario: `${emittente.nome} ${emittente.cognome}`,
    valuta: foreign ? f.valuta : undefined,
    tassoCambio: foreign ? f.tassoCambio : undefined,
    dataCambio: foreign ? f.dataCambio || f.data : undefined,
  };
}

export function buildCourtesyInvoice(f: Fattura, c: Cliente | undefined, config: Config): Invoice {
  const { righe } = righeOrFallback(f);
  const lines = righe.map((r, i) => ({ number: i + 1, description: r.descrizione, quantity: r.quantita, singlePrice: r.prezzoUnitario, amount: round2(r.quantita * r.prezzoUnitario), tax: 0 }));
  const totale = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const totaleEUR = isForeign(f) ? round2(totale / f.tassoCambio!) : totale;
  const emittente = config.emittente;
  const ci = config.courtesyInvoice;
  const nomeEmittente = emittente ? `${emittente.nome} ${emittente.cognome}`.trim() : '';
  return {
    invoicer: {
      name: nomeEmittente || ci?.companyName || config.nomeAttivita,
      vat: config.partitaIva ?? ci?.vatNumber ?? '',
      contacts: { tel: ci?.phone, email: ci?.email },
      office: emittente ? { address: emittente.indirizzo, number: emittente.numeroCivico, cap: emittente.cap, city: emittente.comune, district: emittente.provincia, country: emittente.nazione || 'IT' } : undefined,
    },
    invoicee: {
      name: c?.nome ?? f.clienteNome,
      vat: c?.piva ?? '',
      contacts: c?.email ? { email: c.email } : undefined,
      office: c ? { address: c.indirizzo, number: c.numeroCivico, cap: c.cap, city: c.comune, district: c.provincia, country: c.nazione || 'IT' } : undefined,
    },
    installments: [{
      number: f.numero ?? '',
      currency: f.valuta || 'EUR',
      totalAmount: totale,
      issueDate: new Date(`${f.data}T00:00:00`),
      lines,
      payment: config.iban || ci?.iban ? { amount: totale, iban: config.iban || ci?.iban, method: 'MP05', bank: ci?.bankName } : undefined,
      taxSummary: { taxPercentage: 0, taxAmount: 0, paymentAmount: totale, legalRef: FORFETTARIO_LEGAL_REF },
      stampDuty: totaleEUR > BOLLO_SOGLIA_EUR ? BOLLO_IMPORTO : undefined,
    }],
  };
}

export function buildPdfOptions(config: Config, overrides: { locale?: string } = {}): PDFOptions {
  const ci = config.courtesyInvoice;
  const valute = config.valute?.length ? config.valute : [{ codice: 'EUR', simbolo: '€' }];
  return {
    colors: { primary: ci?.primaryColor || '#6699cc', text: ci?.textColor || '#033243' },
    footer: ci?.includeFooter !== false,
    footerText: ci?.footerText || undefined,
    footerLink: ci?.footerLink || undefined,
    locale: overrides.locale ?? ci?.locale ?? 'it',
    logoSrc: ci?.logoBase64,
    currencyMap: Object.fromEntries(valute.map((v) => [v.codice, v.simbolo])),
  };
}
```

Verifica sul renderer (`src/lib/pdf/renderer.tsx`) che `taxSummary.legalRef` e `payment` vengano mostrati; se il campo per la nota del cambio è `exchangeRateNote` in `PDFOptions`, per le fatture estere aggiungilo in `buildPdfOptions` solo se il chiamante passa la fattura: fuori scope, non serve.

- [ ] **Step 4: Esegui i test**

Run: `npx tsx --test src/lib/fatturaDocumento.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fatturaDocumento.ts src/lib/fatturaDocumento.test.ts
git commit -m "feat: fatturaDocumento, XML e cortesia da una fattura salvata"
```

---

### Task 3: Righe salvate da proposta e modale

**Files:**
- Modify: `src/lib/sync/applyProposal.ts` (`planFattura`, righe 50-102)
- Modify: `src/components/modals/NuovaFatturaModal.tsx` (righe 200-315)
- Test: `src/lib/sync/applyProposal.test.ts`

**Interfaces:**
- Consumes: `validateFatturaRighe` (Task 1), `clienteXMLData` (Task 2).
- Produces: fatture da proposta con `righe`, `dataCambio` (solo valuta estera), `righeSource: 'app'`.

- [ ] **Step 1: Test (fallisce)**

In `src/lib/sync/applyProposal.test.ts` (fixture `ctx`, `counter` e helper `proposal(kind, payload)` già definiti in cima al file) aggiungi:

```ts
test('planProposal fattura stores righe, righeSource and, for a foreign currency, the exchange date', () => {
  counter = 0;
  const righe = [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }];
  const eur = planProposal(proposal('fattura', { clienteId: 'c1', data: '2026-09-10', righe }), ctx).puts[0].record as Fattura;
  assert.deepEqual(eur.righe, righe);
  assert.equal(eur.righeSource, 'app');
  assert.equal(eur.dataCambio, undefined);
  const gbp = planProposal(proposal('fattura', { clienteId: 'c1', data: '2026-09-10', righe, valuta: 'GBP', tassoCambio: 0.8, dataCambio: '2026-09-09' }), ctx).puts[0].record as Fattura;
  assert.equal(gbp.dataCambio, '2026-09-09');
  assert.deepEqual(gbp.righe, righe);
  const gbpSenzaData = planProposal(proposal('fattura', { clienteId: 'c1', data: '2026-09-10', righe, valuta: 'GBP', tassoCambio: 0.8 }), ctx).puts[0].record as Fattura;
  assert.equal(gbpSenzaData.dataCambio, '2026-09-10');
});
```

Il test esistente `'planProposal fattura assigns the number ... like the modal'` confronta il record: se usa `deepEqual` sull'intero record, aggiungi all'atteso `righe` e `righeSource: 'app'`.

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `npx tsx --test src/lib/sync/applyProposal.test.ts`
Expected: FAIL, `righe` undefined.

- [ ] **Step 3: `planFattura`**

Nell'oggetto `fattura` di `planFattura`, dopo la riga `...(isForeign && p.tassoCambio !== undefined ? { tassoCambio: p.tassoCambio } : {}),` aggiungi:

```ts
    ...(isForeign ? { dataCambio: p.dataCambio ?? p.data } : {}),
    ...righeDaSalvare(p.righe),
```

e sopra `planFattura`:

```ts
/** Le proposte sono già più severe del record; il controllo resta per non salvare mai righe che il file rifiuterebbe. */
function righeDaSalvare(righe: FatturaRigaPayload[]): Pick<Fattura, 'righe' | 'righeSource'> {
  const check = validateFatturaRighe(righe);
  return check.ok ? { righe: check.righe, righeSource: 'app' } : {};
}
```

Importa `validateFatturaRighe` e `type FatturaRigaPayload` da `./validate`.

- [ ] **Step 4: Esegui i test**

Run: `npx tsx --test src/lib/sync/applyProposal.test.ts`
Expected: PASS.

- [ ] **Step 5: `NuovaFatturaModal`**

In `handleGenera` (righe 213-240) sostituisci il blocco "Prepara dati cliente" nel ramo cliente esistente con `clienteData = clienteXMLData(cliente, cliente.nome);` (import da `../../lib/fatturaDocumento`), lasciando invariato il ramo `useCustomCliente`. Nell'oggetto `nuovaFattura` (righe 294-306), dopo `...(isMultiCurrency ? { tassoCambio: tassoCambioNum } : {}),` aggiungi:

```ts
        ...(isMultiCurrency ? { dataCambio: dataCambio || data } : {}),
        ...(() => {
          const check = validateFatturaRighe(righeValide);
          return check.ok ? { righe: check.righe, righeSource: 'app' as const } : {};
        })(),
```

con `import { validateFatturaRighe } from '../../lib/sync/validate';`.

- [ ] **Step 6: Typecheck e test**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sync/applyProposal.ts src/lib/sync/applyProposal.test.ts src/components/modals/NuovaFatturaModal.tsx
git commit -m "fix: le fatture da proposta e dal modale salvano le righe"
```

---

### Task 4: `righeFromXml`, righe rappresentabili da un XML

**Files:**
- Create: `src/lib/xml/righeFromXml.ts`
- Test: `src/lib/xml/righeFromXml.test.ts`
- Modify: `package.json` (devDependency `@xmldom/xmldom`)

**Interfaces:**
- Consumes: `validateFatturaRighe` (Task 1), `generateFatturaXML`.
- Produces:
  ```ts
  export type RigheFromXml =
    | { ok: true; righe: FatturaRiga[]; valuta: string; importoValuta?: number; tassoCambio?: number; dataCambio?: string }
    | { ok: false; motivo: string };
  export function righeFromXml(doc: Document): RigheFromXml;
  ```
  `valuta` è `'EUR'` per le fatture in euro; `importoValuta`, `tassoCambio`, `dataCambio` solo per le estere.

- [ ] **Step 1: Dipendenza per i test**

Run: `npm install --save-dev @xmldom/xmldom`

- [ ] **Step 2: Test (falliscono)**

Crea `src/lib/xml/righeFromXml.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

import { generateFatturaXML, type FatturaXMLData } from './generator';
import { righeFromXml } from './righeFromXml';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const base: FatturaXMLData = {
  emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
  partitaIva: '01234567890', cliente: { denominazione: 'Acme', nazione: 'IT' }, numero: '07', data: '2026-03-10',
  righe: [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }, { descrizione: 'Nota', quantita: 1, prezzoUnitario: 0 }],
};

test('an EUR invoice generated by the app round-trips', () => {
  assert.deepEqual(righeFromXml(parse(generateFatturaXML(base))), { ok: true, righe: base.righe, valuta: 'EUR' });
});

test('a foreign-currency invoice round-trips in the original currency and regenerates the same EUR amounts', () => {
  const data: FatturaXMLData = { ...base, righe: [{ descrizione: 'Workshop', quantita: 3, prezzoUnitario: 333.33 }, { descrizione: 'Viaggio', quantita: 1, prezzoUnitario: 120 }], valuta: 'GBP', tassoCambio: 0.8412, dataCambio: '2026-03-09' };
  const xml1 = generateFatturaXML(data);
  const out = righeFromXml(parse(xml1));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.valuta, 'GBP');
  assert.equal(out.tassoCambio, 0.8412);
  assert.equal(out.dataCambio, '2026-03-09');
  assert.equal(out.importoValuta, 1119.99);
  assert.deepEqual(out.righe.map((r) => [r.descrizione, r.quantita, Math.round(r.prezzoUnitario * 100) / 100]), [['Workshop', 3, 333.33], ['Viaggio', 1, 120]]);
  const xml2 = generateFatturaXML({ ...data, righe: out.righe, tassoCambio: out.tassoCambio, dataCambio: out.dataCambio });
  const amounts = (x: string) => [...x.matchAll(/<(PrezzoTotale|ImponibileImporto|ImportoTotaleDocumento)>([^<]+)</g)].map((m) => m[2]);
  assert.deepEqual(amounts(xml2), amounts(xml1));
});

const replace = (xml: string, from: RegExp, to: string) => { const out = xml.replace(from, to); assert.notEqual(out, xml, `pattern ${from} not found`); return out; };

test('non-representable invoices are rejected with a reason', () => {
  const xml = generateFatturaXML({ ...base, righe: [{ descrizione: 'Sviluppo', quantita: 1, prezzoUnitario: 100 }] });
  const cases: Array<[string, string]> = [
    ['iva', replace(xml, /<AliquotaIVA>0\.00<\/AliquotaIVA>/, '<AliquotaIVA>22.00</AliquotaIVA>')],
    ['sconto', replace(xml, /<PrezzoTotale>/, '<ScontoMaggiorazione><Tipo>SC</Tipo><Importo>10</Importo></ScontoMaggiorazione><PrezzoTotale>')],
    ['totale riga', replace(xml, /<PrezzoTotale>100\.00<\/PrezzoTotale>/, '<PrezzoTotale>90.00</PrezzoTotale>')],
    ['riepilogo', replace(xml, /<ImponibileImporto>100\.00</, '<ImponibileImporto>120.00<')],
    ['totale documento', replace(xml, /<ImportoTotaleDocumento>100\.00</, '<ImportoTotaleDocumento>102.00<')],
    ['negativa', replace(replace(replace(replace(xml, /<PrezzoUnitario>100\.00</, '<PrezzoUnitario>-100.00<'), /<PrezzoTotale>100\.00</, '<PrezzoTotale>-100.00<'), /<ImponibileImporto>100\.00</, '<ImponibileImporto>-100.00<'), /<ImportoTotaleDocumento>100\.00</, '<ImportoTotaleDocumento>-100.00<')],
  ];
  for (const [label, x] of cases) {
    const out = righeFromXml(parse(x));
    assert.equal(out.ok, false, label);
  }
});

test('mixed or partial VALUTA data is not representable', () => {
  const data: FatturaXMLData = { ...base, righe: [{ descrizione: 'A', quantita: 1, prezzoUnitario: 100 }, { descrizione: 'B', quantita: 1, prezzoUnitario: 50 }], valuta: 'GBP', tassoCambio: 0.84, dataCambio: '2026-03-09' };
  const xml = generateFatturaXML(data);
  const senzaSeconda = xml.replace(/(<\/NumeroLinea>[\s\S]*?<NumeroLinea>2<\/NumeroLinea>[\s\S]*?)<AltriDatiGestionali>[\s\S]*?<\/AltriDatiGestionali>/, '$1');
  assert.notEqual(senzaSeconda, xml);
  assert.equal(righeFromXml(parse(senzaSeconda)).ok, false);
});
```

Nota: nel caso `iva` la regex senza flag `g` sostituisce la prima occorrenza, cioè quella della riga (`DettaglioLinee` precede `DatiRiepilogo`).

- [ ] **Step 3: Esegui e verifica il fallimento**

Run: `npx tsx --test src/lib/xml/righeFromXml.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 4: Implementazione**

Crea `src/lib/xml/righeFromXml.ts`:

```ts
/**
 * Righe di una fattura da un XML FatturaPA, solo quando il modello `righe`
 * lo rappresenta senza perdite: forfettario (IVA 0), senza sconti, totali
 * coerenti. Altrimenti `{ ok: false, motivo }` e la fattura si importa senza
 * righe. Usa solo getElementsByTagName: gira nel browser e, nei test, con
 * @xmldom/xmldom.
 */
import type { FatturaRiga } from '../../types';
import { validateFatturaRighe } from '../sync/validate';

export type RigheFromXml =
  | { ok: true; righe: FatturaRiga[]; valuta: string; importoValuta?: number; tassoCambio?: number; dataCambio?: string }
  | { ok: false; motivo: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const children = (el: Element | Document, tag: string): Element[] => Array.from(el.getElementsByTagName(tag));
const text = (el: Element | Document, tag: string): string | null => children(el, tag)[0]?.textContent?.trim() ?? null;
const num = (el: Element | Document, tag: string): number | null => {
  const t = text(el, tag);
  if (t === null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fail = (motivo: string): RigheFromXml => ({ ok: false, motivo });

export function righeFromXml(doc: Document): RigheFromXml {
  const linee = children(doc, 'DettaglioLinee');
  if (linee.length === 0) return fail('nessuna riga di dettaglio');

  const valutaPerRiga: Array<{ codice: string; importo: number; data: string | null } | null> = [];
  let sommaTotali = 0;
  const righeEUR: FatturaRiga[] = [];
  for (const [i, linea] of linee.entries()) {
    const n = i + 1;
    if (children(linea, 'ScontoMaggiorazione').length > 0) return fail(`riga ${n}: sconto o maggiorazione`);
    const aliquota = num(linea, 'AliquotaIVA');
    if (aliquota === null || aliquota !== 0) return fail(`riga ${n}: IVA diversa da zero`);
    const quantita = num(linea, 'Quantita') ?? 1;
    const prezzo = num(linea, 'PrezzoUnitario');
    const totale = num(linea, 'PrezzoTotale');
    if (prezzo === null || totale === null) return fail(`riga ${n}: prezzi mancanti`);
    if (quantita <= 0) return fail(`riga ${n}: quantità non positiva`);
    if (Math.abs(totale - quantita * prezzo) > 0.01 + quantita * 0.005) return fail(`riga ${n}: totale diverso da quantità per prezzo`);
    sommaTotali += totale;
    righeEUR.push({ descrizione: text(linea, 'Descrizione') ?? '', quantita, prezzoUnitario: prezzo });

    const valuta = children(linea, 'AltriDatiGestionali').find((d) => text(d, 'TipoDato') === 'VALUTA');
    if (!valuta) { valutaPerRiga.push(null); continue; }
    const codice = /^([A-Z]{3})/.exec(text(valuta, 'RiferimentoTesto') ?? '')?.[1];
    const importo = num(valuta, 'RiferimentoNumero');
    if (!codice || importo === null) return fail(`riga ${n}: dati valuta incompleti`);
    valutaPerRiga.push({ codice, importo, data: text(valuta, 'RiferimentoData') });
  }

  const imponibile = num(doc, 'ImponibileImporto');
  if (imponibile === null || Math.abs(imponibile - sommaTotali) > 0.01 + linee.length * 0.005) return fail('somma delle righe diversa dall\'imponibile');
  const totaleDocumento = num(doc, 'ImportoTotaleDocumento');
  if (totaleDocumento !== null && Math.abs(totaleDocumento - imponibile) > 0.01) return fail('totale documento diverso dall\'imponibile');

  const conValuta = valutaPerRiga.filter((v) => v !== null);
  if (conValuta.length === 0) {
    const check = validateFatturaRighe(righeEUR);
    return check.ok ? { ok: true, righe: check.righe, valuta: 'EUR' } : fail(check.reason);
  }
  if (conValuta.length !== linee.length) return fail('valuta indicata solo su alcune righe');
  const codice = conValuta[0]!.codice;
  if (conValuta.some((v) => v!.codice !== codice)) return fail('righe in valute diverse');

  const righe = righeEUR.map((r, i) => ({ ...r, prezzoUnitario: valutaPerRiga[i]!.importo / r.quantita }));
  const check = validateFatturaRighe(righe);
  if (!check.ok) return fail(check.reason);
  const importoValuta = round2(conValuta.reduce((sum, v) => sum + v!.importo, 0));
  const causale = children(doc, 'Causale').map((c) => c.textContent ?? '').join(' ');
  const tassoCausale = new RegExp(`1 EUR = ([0-9.]+) ${codice}`).exec(causale)?.[1];
  const tassoCambio = tassoCausale ? Number(tassoCausale) : Math.round((importoValuta / imponibile) * 1e6) / 1e6;
  const dataCambio = conValuta[0]!.data ?? undefined;
  return { ok: true, righe: check.righe, valuta: codice, importoValuta, tassoCambio, ...(dataCambio ? { dataCambio } : {}) };
}
```

- [ ] **Step 5: Esegui i test**

Run: `npx tsx --test src/lib/xml/righeFromXml.test.ts && npm run lint`
Expected: PASS. Se il round-trip fallisce di un centesimo su `PrezzoTotale`, il problema è `prezzoUnitario` ricavato: non arrotondarlo (è `RiferimentoNumero / quantita`, il generatore rifà `quantita * prezzo` e ottiene esattamente l'originale).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/xml/righeFromXml.ts src/lib/xml/righeFromXml.test.ts
git commit -m "feat: righe rappresentabili da un XML FatturaPA"
```

---

### Task 5: Import con righe, chiavi ricalcolate e arricchimento

**Files:**
- Modify: `src/lib/utils/batchImport.ts`
- Modify: `src/types/index.ts` (`ImportSummary`, righe 111-117)
- Modify: `src/components/ForfettarioApp.tsx` (`handleFatturaUpload` righe 305-357, `handleBatchUpload` 359-404, `handleZipUpload` 406-448)
- Modify: `src/components/modals/ImportSummaryModal.tsx`
- Test: `src/lib/utils/batchImport.test.ts` (nuovo)

**Interfaces:**
- Consumes: `righeFromXml` (Task 4), `computeDuplicateKey`.
- Produces:
  - `ImportSummary` con in più `enriched: number` e `righeNonImportate: Array<{ filename: string; motivo: string }>`.
  - `getDuplicateKey(f)` ricalcola sempre, ignora `f.duplicateKey`.
  - `processBatchXmlFiles(xmlFiles, existingFatture, existingClienti, parseFatturaXML, dbManager?, parseDocument?)` restituisce in più `enrichedFatture: Fattura[]` (record completi da salvare con `updateFattura`). `parseDocument: (xml: string) => Document` di default `(xml) => new DOMParser().parseFromString(xml, 'text/xml')`.
  - `valute?: ValutaConfig[]` come settimo parametro opzionale, per `valutaSimbolo`.

- [ ] **Step 1: Test (falliscono)**

Crea `src/lib/utils/batchImport.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

import type { Fattura } from '../../types';
import { generateFatturaXML, type FatturaXMLData } from '../xml/generator';
import { getDuplicateKey, processBatchXmlFiles } from './batchImport';

const parseDocument = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
// Parser minimo al posto di parseFatturaXML (che usa querySelector del browser)
const parseFatturaXML = (xml: string) => {
  const doc = parseDocument(xml);
  const t = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent ?? '';
  return { importo: Number(t('ImportoTotaleDocumento')), data: t('Data'), dataIncasso: t('Data'), numero: t('Numero'), clienteNome: t('Denominazione'), clientePiva: t('IdCodice') };
};
const base: FatturaXMLData = {
  emittente: { codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
  partitaIva: '01234567890', cliente: { denominazione: 'Acme', partitaIva: '09876543210', nazione: 'IT' }, numero: '07', data: '2026-03-10',
  righe: [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }],
};
const run = (xml: string, existing: Fattura[] = []) =>
  processBatchXmlFiles([{ name: 'a.xml', content: xml }], existing, [{ id: 'c1', userId: 'u1', nome: 'Acme', piva: '09876543210' }], parseFatturaXML, null, parseDocument, [{ codice: 'EUR', simbolo: '€' }, { codice: 'GBP', simbolo: '£' }]);
const saved = (over: Partial<Fattura>): Fattura => ({ id: 'f1', userId: 'u1', numero: '07', data: '2026-03-10', clienteId: 'c1', clienteNome: 'Acme', importo: 1000, ...over });

test('getDuplicateKey recomputes regardless of the stored format', () => {
  const k = getDuplicateKey(saved({}));
  assert.equal(getDuplicateKey(saved({ duplicateKey: '07-2026-03-10-1000' })), k);
  assert.equal(getDuplicateKey(saved({ duplicateKey: '07|2026-03-10|1000.00' })), k);
});

test('a new invoice is imported with its righe', async () => {
  const { newFatture, summary } = await run(generateFatturaXML(base));
  assert.equal(summary.imported, 1);
  assert.deepEqual(newFatture[0].righe, base.righe);
  assert.equal(newFatture[0].righeSource, 'xml');
});

test('a duplicate without righe is enriched, whatever its stored key format', async () => {
  for (const duplicateKey of ['07-2026-03-10-1000', '07|2026-03-10|1000.00', undefined]) {
    const { newFatture, enrichedFatture, summary } = await run(generateFatturaXML(base), [saved({ duplicateKey })]);
    assert.equal(newFatture.length, 0);
    assert.equal(summary.enriched, 1);
    assert.equal(summary.duplicates, 0);
    assert.deepEqual(enrichedFatture[0].righe, base.righe);
    assert.equal(enrichedFatture[0].id, 'f1');
  }
});

test('a duplicate that already has righe is left alone', async () => {
  const { enrichedFatture, summary } = await run(generateFatturaXML(base), [saved({ righe: [{ descrizione: 'Mia', quantita: 1, prezzoUnitario: 1000 }] })]);
  assert.equal(enrichedFatture.length, 0);
  assert.equal(summary.duplicates, 1);
});

test('a non-representable invoice is imported without righe and reported', async () => {
  const xml = generateFatturaXML({ ...base, righe: [{ descrizione: 'X', quantita: 1, prezzoUnitario: 100 }] }).replace(/<ImportoTotaleDocumento>100\.00</, '<ImportoTotaleDocumento>102.00<');
  const { newFatture, summary } = await run(xml);
  assert.equal(newFatture[0].righe, undefined);
  assert.equal(summary.righeNonImportate.length, 1);
  assert.match(summary.righeNonImportate[0].motivo, /totale documento/);
});

test('a foreign invoice saves currency metadata; enrichment checks currency and rate', async () => {
  const gbp: FatturaXMLData = { ...base, righe: [{ descrizione: 'W', quantita: 1, prezzoUnitario: 1000 }], valuta: 'GBP', tassoCambio: 0.84, dataCambio: '2026-03-09' };
  const xml = generateFatturaXML(gbp);
  const { newFatture } = await run(xml);
  assert.equal(newFatture[0].valuta, 'GBP');
  assert.equal(newFatture[0].valutaSimbolo, '£');
  assert.equal(newFatture[0].importoValuta, 1000);
  assert.equal(newFatture[0].tassoCambio, 0.84);
  assert.equal(newFatture[0].dataCambio, '2026-03-09');
  assert.deepEqual(newFatture[0].righe, gbp.righe);

  const esistente = saved({ importo: 1190.48, valuta: 'GBP', tassoCambio: 0.84 });
  assert.equal((await run(xml, [esistente])).summary.enriched, 1);
  const cambioDiverso = await run(xml, [saved({ importo: 1190.48, valuta: 'GBP', tassoCambio: 0.9 })]);
  assert.equal(cambioDiverso.summary.enriched, 0);
  assert.equal(cambioDiverso.summary.righeNonImportate.length, 1);
  const valutaDiversa = await run(xml, [saved({ importo: 1190.48 })]);
  assert.equal(valutaDiversa.summary.enriched, 0);
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `npx tsx --test src/lib/utils/batchImport.test.ts`
Expected: FAIL (niente `enrichedFatture`, `getDuplicateKey` usa la chiave salvata).

- [ ] **Step 3: `ImportSummary`**

```ts
export interface ImportSummary {
  total: number;
  imported: number;
  duplicates: number;
  enriched: number;
  failed: number;
  failedFiles: Array<{ filename: string; error: string }>;
  righeNonImportate: Array<{ filename: string; motivo: string }>;
}
```

- [ ] **Step 4: `batchImport.ts`**

`getDuplicateKey` diventa:

```ts
// Chiave ricalcolata: le chiavi salvate hanno avuto formati diversi (| e -, importo in valuta), non si confrontano
export const getDuplicateKey = (fattura: Fattura): string => computeDuplicateKey(fattura.numero, fattura.data, fattura.importo);
```

Firma di `processBatchXmlFiles`:

```ts
export const processBatchXmlFiles = async (
  xmlFiles: Array<{ name: string; content: string }>,
  existingFatture: Fattura[],
  existingClienti: Cliente[],
  parseFatturaXML: (xmlContent: string) => any,
  dbManager?: IndexedDBManager | null,
  parseDocument: (xml: string) => Document = (xml) => new DOMParser().parseFromString(xml, 'text/xml'),
  valute: ValutaConfig[] = [{ codice: 'EUR', simbolo: '€' }],
): Promise<{ summary: ImportSummary; newFatture: NewFattura[]; newClienti: NewCliente[]; enrichedFatture: Fattura[] }> => {
```

Inizializza `summary` con `enriched: 0, righeNonImportate: []` e `const enrichedFatture: Fattura[] = [];`. Sostituisci `const existingDuplicateKeys = new Set(existingFatture.map(f => getDuplicateKey(f)));` con:

```ts
  const existingByKey = new Map<string, Fattura>();
  for (const f of existingFatture) {
    try { existingByKey.set(getDuplicateKey(f), f); } catch { /* data non valida: non confrontabile */ }
  }
  const batchKeys = new Set<string>();
```

Dopo il calcolo di `duplicateKey`, al posto del controllo duplicati:

```ts
      const righe = righeFromXml(parseDocument(content));
      const esistente = existingByKey.get(duplicateKey);
      if (esistente || batchKeys.has(duplicateKey)) {
        const arricchita = esistente && !esistente.righe?.length ? enrich(esistente, righe) : null;
        if (arricchita && 'fattura' in arricchita) {
          enrichedFatture.push(arricchita.fattura);
          existingByKey.set(duplicateKey, arricchita.fattura);
          summary.enriched++;
        } else {
          if (arricchita && 'motivo' in arricchita) summary.righeNonImportate.push({ filename: name, motivo: arricchita.motivo });
          summary.duplicates++;
        }
        continue;
      }
      batchKeys.add(duplicateKey);
```

Nel `nuovaFattura`, dopo `duplicateKey`:

```ts
        ...(righe.ok ? righeFields(righe, valute) : {}),
```

e, se `!righe.ok`, `summary.righeNonImportate.push({ filename: name, motivo: righe.motivo });` prima di `newFatture.push`. Helper nel modulo:

```ts
function righeFields(r: Extract<RigheFromXml, { ok: true }>, valute: ValutaConfig[]): Partial<Fattura> {
  const base: Partial<Fattura> = { righe: r.righe, righeSource: 'xml' };
  if (r.valuta === 'EUR') return base;
  const simbolo = valute.find((v) => v.codice === r.valuta)?.simbolo ?? r.valuta;
  return { ...base, valuta: r.valuta, valutaSimbolo: simbolo, importoValuta: r.importoValuta, tassoCambio: r.tassoCambio, ...(r.dataCambio ? { dataCambio: r.dataCambio } : {}) };
}

/** Arricchisce una fattura senza righe solo se valuta e cambio coincidono: mai una doppia conversione. */
function enrich(f: Fattura, r: RigheFromXml): { fattura: Fattura } | { motivo: string } {
  if (!r.ok) return { motivo: r.motivo };
  const valutaSalvata = f.valuta || 'EUR';
  if (valutaSalvata !== r.valuta) return { motivo: `valuta dell'XML (${r.valuta}) diversa da quella salvata (${valutaSalvata})` };
  if (r.valuta === 'EUR') return { fattura: { ...f, righe: r.righe, righeSource: 'xml' } };
  if (f.tassoCambio !== undefined && r.tassoCambio !== undefined && Math.abs(f.tassoCambio - r.tassoCambio) / f.tassoCambio > 0.001) {
    return { motivo: `cambio dell'XML (${r.tassoCambio}) diverso da quello salvato (${f.tassoCambio})` };
  }
  return {
    fattura: {
      ...f,
      righe: r.righe,
      righeSource: 'xml',
      ...(r.dataCambio ? { dataCambio: r.dataCambio } : {}),
      ...(f.importoValuta === undefined && r.importoValuta !== undefined ? { importoValuta: r.importoValuta } : {}),
      ...(f.tassoCambio === undefined && r.tassoCambio !== undefined ? { tassoCambio: r.tassoCambio } : {}),
    },
  };
}
```

Import: `import { righeFromXml, type RigheFromXml } from '../xml/righeFromXml';` e `ValutaConfig` da `'../../types'`. `return { summary, newFatture, newClienti, enrichedFatture };`. Se `dbManager` è passato, il ramo esistente che salva le nuove fatture deve salvare anche `enrichedFatture` con lo stesso metodo di update del db (cerca nel file come salva oggi e usa `put` sullo store `fatture`).

- [ ] **Step 5: Esegui i test**

Run: `npx tsx --test src/lib/utils/batchImport.test.ts`
Expected: PASS.

- [ ] **Step 6: App: tutti gli import passano da `processBatchXmlFiles`**

In `ForfettarioApp.tsx`:

1. Estrai un helper interno che salva il risultato e aggiorna la config:
   ```ts
   const saveImport = async (result: Awaited<ReturnType<typeof processBatchXmlFiles>>, firstXml: string | undefined) => {
     for (const cliente of result.newClienti) await addCliente(cliente);
     for (const fattura of result.newFatture) await addFattura(fattura);
     for (const fattura of result.enrichedFatture) await updateFattura(fattura);
     if (firstXml) {
       const extractedData = extractEmittenteFromXml(firstXml);
       const configUpdates = extractedData ? autoPopulateConfig(extractedData, config) : null;
       if (configUpdates) setConfig({ ...config, ...configUpdates });
       return Boolean(configUpdates);
     }
     return false;
   };
   ```
   (`updateFattura` va aggiunto alla destrutturazione di `useApp()`.)
2. `handleBatchUpload` e `handleZipUpload`: chiamano `processBatchXmlFiles(xmlFiles, fatture, clienti, parseFatturaXML, null, undefined, config.valute)` e poi `await saveImport(result, xmlFiles[0]?.content)` al posto dei loop attuali.
3. `handleFatturaUpload`: passa dallo stesso percorso con un solo file e sceglie il toast dal riepilogo:
   ```ts
   const handleFatturaUpload = async (file: File) => {
     const text = await file.text();
     const result = await processBatchXmlFiles([{ name: file.name, content: text }], fatture, clienti, parseFatturaXML, null, undefined, config.valute);
     const { summary } = result;
     if (summary.failed > 0) { showToast(summary.failedFiles[0]?.error || 'Errore parsing XML', 'error'); return; }
     const configAggiornata = await saveImport(result, text);
     setShowModal(null);
     const avvisoRighe = summary.righeNonImportate[0] ? ` Righe non importate: ${summary.righeNonImportate[0].motivo}.` : '';
     if (summary.enriched > 0) showToast('Fattura già presente: righe aggiunte.');
     else if (summary.duplicates > 0) showToast(`Fattura già presente.${avvisoRighe}`);
     else showToast(`${configAggiornata ? 'Fattura caricata! Impostazioni aggiornate automaticamente.' : 'Fattura caricata!'}${avvisoRighe}`);
   };
   ```

- [ ] **Step 7: `ImportSummaryModal`**

Accanto ai contatori esistenti (importate, duplicate, fallite) aggiungi, con lo stesso markup degli altri: "Righe aggiunte a fatture già presenti: {summary.enriched}" (solo se > 0) e, se `summary.righeNonImportate.length > 0`, un elenco "Importate senza righe" con `filename: motivo`, sullo stile di `failedFiles`. Testo di aiuto sotto l'elenco: "Queste fatture hanno IVA, sconti o totali che il dettaglio righe di Pivella non rappresenta: XML e cortesia useranno una riga unica."

- [ ] **Step 8: Typecheck e test**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/types/index.ts src/lib/utils/batchImport.ts src/lib/utils/batchImport.test.ts src/components/ForfettarioApp.tsx src/components/modals/ImportSummaryModal.tsx
git commit -m "feat: l'import XML salva le righe e arricchisce le fatture già presenti"
```

---

### Task 6: XML scaricato alla conferma di una proposta

**Files:**
- Create: `src/lib/fatturaDownload.ts`
- Modify: `src/hooks/useFolderSync.ts` (`decideProposal`, righe 53 e 269-300)
- Modify: `src/context/AppContext.tsx` (tipo `confirmProposal` riga 103, righe 278-279)
- Modify: `src/components/shared/ProposteInbox.tsx` (`decide`, righe 90-107)

**Interfaces:**
- Consumes: `buildFatturaXMLData`, `DatiEmittenteMancantiError` (Task 2); `ProposalPlan` da `applyProposal.ts`.
- Produces:
  - `useFolderSync().decideProposal(...)` e `useApp().confirmProposal(...)` restituiscono `{ proposal: Proposal; plan: ProposalPlan | null }` (prima: `Proposal`). `rejectProposal` idem.
  - `downloadFatturaXML(f: Fattura, c: Cliente | undefined, config: Config): { fallback: boolean }` in `src/lib/fatturaDownload.ts` (lancia `DatiEmittenteMancantiError`).

- [ ] **Step 1: `fatturaDownload.ts`**

```ts
/** Download nel browser dei documenti di una fattura salvata. */
import type { Cliente, Config, Fattura } from '../types';
import { buildFatturaXMLData, righeOrFallback } from './fatturaDocumento';
import { downloadXML, generateFatturaXML, generateFileName } from './xml/generator';

export function downloadFatturaXML(f: Fattura, c: Cliente | undefined, config: Config): { fallback: boolean } {
  const xml = generateFatturaXML(buildFatturaXMLData(f, c, config));
  const progressivo = Math.random().toString(36).substring(2, 7).toUpperCase();
  downloadXML(xml, generateFileName(config.partitaIva!, progressivo));
  return { fallback: righeOrFallback(f).fallback };
}
```

- [ ] **Step 2: `decideProposal` restituisce anche il piano**

In `useFolderSync.ts` cambia il tipo a riga 53 in `decideProposal: (proposalId: string, decision: Decision) => Promise<{ proposal: Proposal; plan: ProposalPlan | null }>;` (import `type ProposalPlan` da `'../lib/sync/applyProposal'`), e `return outcome.proposal;` in `return { proposal: outcome.proposal, plan: outcome.plan };`. In `AppContext.tsx` aggiorna i tipi di `confirmProposal` e `rejectProposal` allo stesso ritorno. Cerca altri chiamanti con `grep -rn "confirmProposal\|rejectProposal\|decideProposal(" src` e adattali.

- [ ] **Step 3: Download nell'inbox**

In `ProposteInbox.tsx` prendi anche `config` da `useApp()` e sostituisci il ramo `if (apply)` di `decide`:

```ts
      const { proposal: done, plan } = apply ? await confirmProposal(proposal.id) : await rejectProposal(proposal.id);
      if (!apply) {
        showToast('Proposta rifiutata');
      } else if (done.kind === 'fattura' && plan) {
        // I record del piano: il cliente nuovo non è ancora nello stato React
        const fattura = plan.puts.find((p) => p.store === 'fatture')?.record as Fattura | undefined;
        const nuovoCliente = plan.puts.find((p) => p.store === 'clienti')?.record as Cliente | undefined;
        const cliente = nuovoCliente ?? clienti.find((c) => c.id === fattura?.clienteId);
        try {
          if (!fattura) throw new Error('fattura non trovata nel piano');
          downloadFatturaXML(fattura, cliente, config);
          showToast(`Fattura n. ${fattura.numero} creata, XML scaricato`);
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          showToast(`Fattura n. ${fattura?.numero ?? '?'} creata, ma l'XML non è stato generato: ${why}. Puoi scaricarlo dalla lista fatture.`, 'error');
        }
      } else {
        const numero = done.result?.numero ? ` Numero ${done.result.numero}.` : '';
        showToast(`Proposta confermata.${numero}`);
      }
```

Import: `Cliente`, `Fattura` da `'../../types'`, `downloadFatturaXML` da `'../../lib/fatturaDownload'`.

- [ ] **Step 4: Typecheck e test**

Run: `npm run lint && npm test`
Expected: PASS (i test di `proposalFlow` usano la funzione pura, non l'hook).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fatturaDownload.ts src/hooks/useFolderSync.ts src/context/AppContext.tsx src/components/shared/ProposteInbox.tsx
git commit -m "fix: la conferma di una proposta di fattura scarica l'XML"
```

---

### Task 7: Lista fatture, pagina Cortesia da fattura salvata, rimozione del modale morto

**Files:**
- Modify: `src/components/pages/Fatture.tsx` (riga 13 `useApp`, riga 209 intestazione, riga 258 azioni)
- Modify: `src/components/pages/FatturaCortesia.tsx`
- Modify: `src/components/ForfettarioApp.tsx` (rimuovi lazy import righe 117-121 e blocco righe 849-854)
- Delete: `src/components/modals/CourtesyInvoiceModal.tsx`
- Modify: `src/components/pages/Guida.tsx` (voce "Fattura di Cortesia", righe 51-52)

**Interfaces:**
- Consumes: `downloadFatturaXML` (Task 6), `buildCourtesyInvoice`, `buildPdfOptions`, `righeOrFallback` (Task 2).
- Produces: `requestCortesiaFor(fatturaId: string): void` e `takeCortesiaRequest(): string | null` esportate da `FatturaCortesia.tsx` (stesso idioma di `goToProposte` in `ProposteInbox.tsx`: variabile di modulo letta al montaggio).

- [ ] **Step 1: Azioni nella lista**

In `Fatture.tsx` prendi `config` e `showToast` da `useApp()` e la prop di navigazione: la pagina oggi riceve `setShowModal` e `setEditingFattura`; aggiungi `onOpenCortesia: (fatturaId: string) => void` a `FattureProps`, passata da `ForfettarioApp.tsx` come `(id) => { requestCortesiaFor(id); setCurrentPage('fattura-cortesia'); }`. Nella cella delle azioni (riga 258) metti, prima del pulsante elimina:

```tsx
<td style={{ whiteSpace: 'nowrap' }}>
  <button className="btn btn-secondary btn-sm" onClick={() => scaricaXML(f)} aria-label={`Scarica XML della fattura ${f.numero ?? ''}`} title="Scarica XML"><FileText size={16} aria-hidden="true" /></button>
  <button className="btn btn-secondary btn-sm" onClick={() => onOpenCortesia(f.id)} aria-label={`Fattura di cortesia per la fattura ${f.numero ?? ''}`} title="Fattura di cortesia" style={{ marginLeft: 6 }}><FilePlus size={16} aria-hidden="true" /></button>
  <button className="btn btn-danger" onClick={() => removeFattura(f.id)} aria-label="Elimina fattura" style={{ marginLeft: 6 }}><Trash2 size={16} aria-hidden="true" /></button>
</td>
```

con

```ts
  const scaricaXML = (f: Fattura) => {
    try {
      const { fallback } = downloadFatturaXML(f, clienti.find((c) => c.id === f.clienteId), config);
      showToast(fallback ? 'XML scaricato con una riga unica: questa fattura non ha le righe salvate. Controlla che corrisponda a quello inviato allo SDI.' : 'XML scaricato');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Errore generazione XML', 'error');
    }
  };
```

- [ ] **Step 2: Pagina Cortesia**

In `FatturaCortesia.tsx`, sopra il componente:

```ts
let cortesiaRequest: string | null = null;
/** Chiede alla pagina di aprirsi con questa fattura salvata (stesso idioma di goToProposte). */
export function requestCortesiaFor(fatturaId: string): void { cortesiaRequest = fatturaId; }
export function takeCortesiaRequest(): string | null { const id = cortesiaRequest; cortesiaRequest = null; return id; }
```

Nel componente prendi `fatture` e `clienti` da `useApp()` e aggiungi:

```ts
  const [fatturaSalvataId, setFatturaSalvataId] = useState<string>('');
  const [fallbackAvviso, setFallbackAvviso] = useState(false);
  const fattureOrdinate = useMemo(() => [...fatture].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)), [fatture]);

  const caricaFatturaSalvata = (id: string) => {
    setFatturaSalvataId(id);
    const f = fatture.find((x) => x.id === id);
    if (!f) { setParsedInvoice(null); return; }
    setSelectedFile(null);
    setParsedInvoice(buildCourtesyInvoice(f, clienti.find((c) => c.id === f.clienteId), config));
    setFallbackAvviso(righeOrFallback(f).fallback);
  };

  useEffect(() => {
    const id = takeCortesiaRequest();
    if (id) caricaFatturaSalvata(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

`processFile` (caricamento XML) deve azzerare `setFatturaSalvataId('')` e `setFallbackAvviso(false)`. Sopra la drop zone dell'XML aggiungi una card "Da fattura salvata":

```tsx
<div className="input-group">
  <label className="input-label" htmlFor="cortesia-fattura-salvata">Da fattura salvata</label>
  <select id="cortesia-fattura-salvata" className="input-field" value={fatturaSalvataId} onChange={(e) => caricaFatturaSalvata(e.target.value)}>
    <option value="">Scegli una fattura...</option>
    {fattureOrdinate.map((f) => (
      <option key={f.id} value={f.id}>{`${f.numero ?? '-'} del ${new Date(f.data).toLocaleDateString('it-IT')}, ${f.clienteNome}, ${(f.importoValuta ?? f.importo).toFixed(2)} ${f.valuta ?? 'EUR'}`}</option>
    ))}
  </select>
  {fallbackAvviso && (
    <p role="status" style={{ marginTop: 6, color: 'var(--accent-yellow)' }}>
      <AlertTriangle size={14} aria-hidden="true" /> Righe non salvate: ho usato una riga unica, modificala o reimporta l'XML originale.
    </p>
  )}
</div>
<p style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '8px 0' }}>oppure</p>
```

La condizione che mostra dettagli e generazione (riga 473, `selectedFile && parsedInvoice`) diventa `parsedInvoice && (selectedFile || fatturaSalvataId)`. In `handleGenerate` sostituisci la costruzione di `options` con `const options: PDFOptions = { ...buildPdfOptions(config, { locale }), colors: { primary: primaryColor, text: textColor }, footer: showFooter, footerText: footerText || undefined, footerLink: footerLink || undefined, logoSrc: logoBase64 };` (le impostazioni non ancora salvate nella pagina vincono). Il messaggio `showToast('Seleziona prima un file XML', 'error')` diventa `'Scegli una fattura salvata o carica un XML'`. Il sottotitolo della pagina (`Genera PDF da fattura elettronica XML`) diventa `Genera il PDF da una fattura salvata o da un XML`.

- [ ] **Step 3: Rimuovi il modale morto**

Run: `grep -rn "CourtesyInvoiceModal\|courtesy-invoice\"" src` e rimuovi da `ForfettarioApp.tsx` il lazy import e il blocco `showModal === "courtesy-invoice"`; se `"courtesy-invoice"` compare in un tipo unione di modali, toglilo. Poi `git rm src/components/modals/CourtesyInvoiceModal.tsx`.

- [ ] **Step 4: Guida**

In `Guida.tsx` il testo della voce "Fattura di Cortesia" diventa: `"Genera un PDF \"di cortesia\" da mandare al cliente: la fattura elettronica vera passa dallo SDI, ma un PDF leggibile da allegare alla mail fa sempre comodo. Scegli una fattura salvata (o carica il suo XML), la lingua, e il PDF è pronto."`

- [ ] **Step 5: Typecheck, test, build**

Run: `npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Verifica manuale**

Run: `npm run dev`, poi nel browser: lista fatture, "Scarica XML" su una fattura con righe (una creata dal modale dopo il Task 3) e su una vecchia (toast con avviso); "Fattura di cortesia" apre la pagina con la fattura scelta, "Genera PDF" scarica il PDF con righe, bollo e IBAN. Usa la skill `run` se serve.

- [ ] **Step 7: Commit**

```bash
git add -A src/components
git commit -m "feat: XML e cortesia dalla lista fatture, cortesia da fattura salvata"
```

---

### Task 8: Renderer PDF anche in Node

**Files:**
- Modify: `src/lib/pdf/renderer.tsx` (righe 15-19)
- Create: `mcp/src/pdf.ts`
- Test: `mcp/src/pdf.test.ts`

**Interfaces:**
- Consumes: `buildCourtesyInvoice`, `buildPdfOptions` (Task 2).
- Produces: `registerPdfFont(src: string): void` esportata da `renderer.tsx`; `renderCourtesyPdf(invoice: Invoice, options: PDFOptions): Promise<Buffer>` e `resolveFontPath(): string` in `mcp/src/pdf.ts`.

- [ ] **Step 1: Test (fallisce)**

Crea `mcp/src/pdf.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { DEFAULT_CONFIG } from '../../src/lib/constants/fiscali';
import { buildCourtesyInvoice, buildPdfOptions } from '../../src/lib/fatturaDocumento';
import type { Config } from '../../src/types';
import { renderCourtesyPdf, resolveFontPath } from './pdf';

test('resolveFontPath finds the bundled or repo font', () => {
  assert.ok(existsSync(resolveFontPath()));
});

test('renderCourtesyPdf produces a PDF in Node', async () => {
  const config: Config = { ...DEFAULT_CONFIG, id: 'c', userId: 'u1', partitaIva: '01234567890', emittente: { codiceFiscale: 'X', nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via', numeroCivico: '1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' } };
  const invoice = buildCourtesyInvoice({ id: 'f', userId: 'u1', numero: '01', data: '2026-03-10', clienteId: 'c1', clienteNome: 'Acme', importo: 100, righe: [{ descrizione: 'A', quantita: 1, prezzoUnitario: 100 }] }, undefined, config);
  const pdf = await renderCourtesyPdf(invoice, buildPdfOptions(config));
  assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF');
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `npx tsx --test mcp/src/pdf.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Font configurabile**

In `renderer.tsx` sostituisci la registrazione a livello di modulo con:

```tsx
/** Font del PDF: nel browser dall'URL pubblico, in Node (server MCP) da un percorso su disco. */
export function registerPdfFont(src: string): void {
  Font.register({ family: 'Roboto-Mono', src });
}

if (typeof window !== 'undefined') registerPdfFont('/fonts/RobotoMono-Regular.ttf');
```

- [ ] **Step 4: `mcp/src/pdf.ts`**

```ts
/** Fattura di cortesia in PDF dal server MCP: stesso renderer dell'app, font da disco. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';

import GeneratePDF, { registerPdfFont } from '../../src/lib/pdf/renderer';
import type { Invoice, PDFOptions } from '../../src/lib/pdf/types';

const FONT = 'RobotoMono-Regular.ttf';

/** Nel pacchetto: dist/fonts accanto a cli.js. In sviluppo (tsx): public/fonts del repo. */
export function resolveFontPath(): string {
  const candidates = [
    fileURLToPath(new URL(`./fonts/${FONT}`, import.meta.url)),
    fileURLToPath(new URL(`../../public/fonts/${FONT}`, import.meta.url)),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Font ${FONT} non trovato (cercato in ${candidates.join(', ')})`);
  return found;
}

let fontRegistered = false;

export async function renderCourtesyPdf(invoice: Invoice, options: PDFOptions): Promise<Buffer> {
  if (!fontRegistered) {
    registerPdfFont(resolveFontPath());
    fontRegistered = true;
  }
  return renderToBuffer(GeneratePDF(invoice, options));
}
```

Se `GeneratePDF` restituisce un elemento `<Document>` (come nell'uso in `FatturaCortesia.tsx`: `pdf(GeneratePDF(parsedInvoice, options))`), il tipo è compatibile con `renderToBuffer`; in caso di errore di tipo, fai il cast `as Parameters<typeof renderToBuffer>[0]`.

- [ ] **Step 5: Esegui i test**

Run: `npx tsx --test mcp/src/pdf.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf/renderer.tsx mcp/src/pdf.ts mcp/src/pdf.test.ts
git commit -m "feat(mcp): renderer della fattura di cortesia anche in Node"
```

---

### Task 9: Scrittura sicura dei documenti MCP

**Files:**
- Create: `mcp/src/documents.ts`
- Test: `mcp/src/documents.test.ts`

**Interfaces:**
- Produces:
  - `safeFileComponent(value: string): string` (lancia se il risultato è vuoto)
  - `writeExclusive(dir: string, baseName: string, ext: string, data: Uint8Array | string): Promise<string>` restituisce il percorso assoluto scritto
  - `documentsDir(syncDir: string, anno: number): string` = `join(syncDir, 'documenti', String(anno))`

- [ ] **Step 1: Test (falliscono)**

Crea `mcp/src/documents.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { documentsDir, safeFileComponent, writeExclusive } from './documents';

test('safeFileComponent strips path characters and rejects empty results', () => {
  assert.equal(safeFileComponent('12/2026'), '12-2026');
  assert.equal(safeFileComponent('../x'), 'x');
  assert.equal(safeFileComponent('a  b..c'), 'a-b-c');
  assert.throws(() => safeFileComponent('../'));
  assert.throws(() => safeFileComponent(''));
});

test('writeExclusive never overwrites and adds a numeric suffix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  const a = await writeExclusive(dir, 'fattura-cortesia-01-2026', 'pdf', 'uno');
  const b = await writeExclusive(dir, 'fattura-cortesia-01-2026', 'pdf', 'due');
  assert.equal(a, join(dir, 'fattura-cortesia-01-2026.pdf'));
  assert.equal(b, join(dir, 'fattura-cortesia-01-2026-2.pdf'));
  assert.equal(await readFile(a, 'utf8'), 'uno');
});

test('concurrent writes produce distinct files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  const paths = await Promise.all(Array.from({ length: 5 }, (_, i) => writeExclusive(dir, 'x', 'xml', String(i))));
  assert.equal(new Set(paths).size, 5);
  assert.equal((await readdir(dir)).length, 5);
});

test('writeExclusive creates missing folders and refuses names that escape them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  const dir = documentsDir(root, 2026);
  assert.equal(dir, join(root, 'documenti', '2026'));
  const p = await writeExclusive(dir, 'ok', 'xml', 'x');
  assert.ok(p.startsWith(dir + sep));
  await assert.rejects(writeExclusive(dir, `..${sep}fuori`, 'xml', 'x'));
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `npx tsx --test mcp/src/documents.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementazione**

Crea `mcp/src/documents.ts`:

```ts
/**
 * File scritti dai tool genera_*: nomi ripuliti, sempre dentro la cartella
 * scelta, creazione esclusiva. Non tocca mai il file di sync.
 */
import { mkdir, open } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const MAX_TENTATIVI = 100;

export function safeFileComponent(value: string): string {
  const out = value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!out) throw new Error(`Nome di file non valido: ${JSON.stringify(value)}`);
  return out;
}

export function documentsDir(syncDir: string, anno: number): string {
  return join(syncDir, 'documenti', String(anno));
}

export async function writeExclusive(dir: string, baseName: string, ext: string, data: Uint8Array | string): Promise<string> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  for (let n = 1; n <= MAX_TENTATIVI; n++) {
    const name = `${baseName}${n === 1 ? '' : `-${n}`}.${ext}`;
    const target = resolve(root, name);
    if (!target.startsWith(root + sep) || name.includes('/') || name.includes('\\')) throw new Error(`Il file ${name} uscirebbe dalla cartella ${root}`);
    try {
      const handle = await open(target, 'wx');
      try { await handle.writeFile(data); } finally { await handle.close(); }
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error(`Troppi file con il nome ${baseName}.${ext} in ${root}`);
}
```

- [ ] **Step 4: Esegui i test**

Run: `npx tsx --test mcp/src/documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/documents.ts mcp/src/documents.test.ts
git commit -m "feat(mcp): scrittura esclusiva e sanitizzata dei documenti"
```

---

### Task 10: Tool MCP `genera_fattura_xml`, `genera_fattura_cortesia` e aggiornamenti

**Files:**
- Create: `mcp/src/tools/generaFatturaXml.ts`, `mcp/src/tools/generaFatturaCortesia.ts`
- Modify: `mcp/src/tools/shared.ts` (`ToolContext`, `decorateFattura`, `toToolError`)
- Modify: `mcp/src/tools/index.ts`, `mcp/src/tools/getFattura.ts`, `mcp/src/tools/listFatture.ts` (solo descrizioni), `mcp/src/tools/proposeFattura.ts` (descrizione)
- Modify: `mcp/src/server.ts` (riga 49), `mcp/src/cli.ts` (righe 105-117)
- Test: `mcp/src/tools/tools.test.ts`

**Interfaces:**
- Consumes: `buildFatturaXMLData`, `buildCourtesyInvoice`, `buildPdfOptions`, `righeOrFallback`, `DatiEmittenteMancantiError` (Task 2); `renderCourtesyPdf` (Task 8); `writeExclusive`, `safeFileComponent`, `documentsDir` (Task 9).
- Produces: `ToolContext.syncDir?: string`; tool `genera_fattura_xml` e `genera_fattura_cortesia` con output `{ percorso: string; fallbackRighe: boolean; avvisi: string[] }`; `FatturaOut` con `haRighe: boolean`.

- [ ] **Step 1: Test (falliscono)**

In `mcp/src/tools/tools.test.ts`:

1. Aggiorna il test del registro: nome `'the registry exposes the nineteen tools of the contract'` e aggiungi `'genera_fattura_xml', 'genera_fattura_cortesia'` in fondo all'array atteso.
2. In `seed()`, dai a `f1` delle righe: `righe: [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }]`.
3. In `setup()`, crea una cartella temporanea e passala nel contesto: `const syncDir = await mkdtemp(join(tmpdir(), 'pivella-mcp-'));` e `ctx: ToolContext = { ..., syncDir }`; restituisci anche `syncDir`. Import: `mkdtemp`, `readFile`, `readdir` da `node:fs/promises`, `tmpdir` da `node:os`, `join` da `node:path`.
4. Aggiungi:

```ts
test('get_fattura and list_fatture expose righe and haRighe', async () => {
  const { ctx } = await setup();
  const one = await ok(ctx, 'get_fattura', { userId: 'u1', fatturaId: 'f1' });
  assert.deepEqual((one.fattura as { righe: unknown }).righe, [{ descrizione: 'Sviluppo', quantita: 2, prezzoUnitario: 500 }]);
  assert.equal((one.fattura as { haRighe: boolean }).haRighe, true);
  const list = await ok(ctx, 'list_fatture', { userId: 'u1', anno: 2026 });
  assert.equal((list.fatture as Array<{ id: string; haRighe: boolean }>).find((f) => f.id === 'f2')!.haRighe, false);
});

test('genera_fattura_xml writes the XML into documenti/<anno> without touching the sync file', async () => {
  const { ctx, fs, syncDir } = await setup();
  const before = fs.files.get(SYNC_FILENAME);
  const out = await ok(ctx, 'genera_fattura_xml', { userId: 'u1', fatturaId: 'f1' });
  const percorso = out.percorso as string;
  assert.ok(percorso.startsWith(join(syncDir, 'documenti', '2026')));
  assert.match(percorso, /IT01234567890_[A-Z0-9]{5}\.xml$/);
  const xml = await readFile(percorso, 'utf8');
  assert.match(xml, /<Descrizione>Sviluppo<\/Descrizione>/);
  assert.equal(out.fallbackRighe, false);
  assert.equal(fs.files.get(SYNC_FILENAME), before);
});

test('genera_fattura_xml on an invoice without righe uses the fallback and says so', async () => {
  const { ctx } = await setup();
  const out = await ok(ctx, 'genera_fattura_xml', { userId: 'u1', fatturaId: 'f2' });
  assert.equal(out.fallbackRighe, true);
  assert.ok((out.avvisi as string[]).some((a) => /riga unica/.test(a)));
});

test('genera_fattura_cortesia writes a PDF, never overwriting, into the chosen folder', async () => {
  const { ctx, syncDir } = await setup();
  const cartella = join(syncDir, 'altrove');
  const a = await ok(ctx, 'genera_fattura_cortesia', { userId: 'u1', fatturaId: 'f1', cartella, lingua: 'en' });
  const b = await ok(ctx, 'genera_fattura_cortesia', { userId: 'u1', fatturaId: 'f1', cartella });
  assert.equal(a.percorso, join(cartella, 'fattura-cortesia-01-2026.pdf'));
  assert.equal(b.percorso, join(cartella, 'fattura-cortesia-01-2026-2.pdf'));
  assert.equal((await readFile(a.percorso as string)).subarray(0, 4).toString('latin1'), '%PDF');
  assert.equal((await readdir(cartella)).length, 2);
});

test('genera tools fail without writing when the emittente is incomplete or the invoice is missing', async () => {
  const { ctx, syncDir, fs } = await setup();
  const snap = parsedFile(fs);
  snap.config[0] = { ...snap.config[0], partitaIva: '' };
  await fs.write(SYNC_FILENAME, text(JSON.stringify(snap)));
  const err = await fails(ctx, 'genera_fattura_xml', { userId: 'u1', fatturaId: 'f1' });
  assert.equal(err.code, 'VALIDATION');
  assert.ok((err.details?.campi as string[]).includes('partitaIva'));
  const missing = await fails(ctx, 'genera_fattura_cortesia', { userId: 'u1', fatturaId: 'nope' });
  assert.equal(missing.code, 'NOT_FOUND');
  await assert.rejects(readdir(join(syncDir, 'documenti')));
});

test('genera tools need a sync folder', async () => {
  const { ctx } = await setup();
  const err = await fails({ ...ctx, syncDir: undefined }, 'genera_fattura_xml', { userId: 'u1', fatturaId: 'f1' });
  assert.equal(err.code, 'VALIDATION');
});
```

Nota su `f1`: numero `'01'`, data `2026-01-10`, quindi il PDF si chiama `fattura-cortesia-01-2026.pdf`.

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `npx tsx --test mcp/src/tools/tools.test.ts`
Expected: FAIL (tool non registrati, `haRighe` assente).

- [ ] **Step 3: `shared.ts`**

In `ToolContext` aggiungi:

```ts
  /** Cartella di sync: base della cartella documenti dei tool genera_*. Assente nei contesti senza disco. */
  syncDir?: string;
```

`FatturaOut` e `decorateFattura`:

```ts
export type FatturaOut = Fattura & { clienteNome: string; incassata: boolean; dataIncassoEffettiva: string | null; haRighe: boolean };

export function decorateFattura(f: Fattura, resolve: (id: string) => string): FatturaOut {
  const incassata = isIncassata(f);
  return { ...f, clienteNome: resolve(f.clienteId), incassata, dataIncassoEffettiva: incassata ? f.dataIncasso || f.data : null, haRighe: Boolean(f.righe?.length) };
}
```

In `toToolError`, prima del ramo `INTERNAL`:

```ts
  if (err instanceof DatiEmittenteMancantiError) return { code: 'VALIDATION', message: err.message, details: { campi: err.campi } };
```

con `import { DatiEmittenteMancantiError } from '../../../src/lib/fatturaDocumento';`. Aggiungi anche un helper condiviso dai due tool:

```ts
export interface DocumentoFattura { fattura: Fattura; cliente: Cliente | undefined; config: Config; dir: string; avvisi: string[]; fallbackRighe: boolean }

/** Fattura, cliente, config e cartella di destinazione per i tool genera_*. */
export async function documentoFattura(ctx: ToolContext, userId: string, fatturaId: string, cartella?: string): Promise<DocumentoFattura> {
  const snap = await snapshotOf(ctx, userId);
  const fattura = snap.fatture.find((f) => f.id === fatturaId);
  if (!fattura) throw new DataSourceError('NOT_FOUND', `Fattura ${fatturaId} inesistente per il profilo ${userId}`, { fatturaId });
  if (!snap.config) throw new DatiEmittenteMancantiError(emittenteMancante(null));
  const mancanti = emittenteMancante(snap.config);
  if (mancanti.length > 0) throw new DatiEmittenteMancantiError(mancanti);
  if (!cartella && !ctx.syncDir) throw validationError('cartella', 'indica una cartella: il server non conosce la cartella di sync');
  const cliente = snap.clienti.find((c) => c.id === fattura.clienteId);
  const avvisi: string[] = [];
  const { fallback } = righeOrFallback(fattura);
  if (fallback) avvisi.push('La fattura non ha le righe salvate: ho usato una riga unica con il totale. Controlla che corrisponda all\'XML inviato allo SDI.');
  if (!cliente) avvisi.push(`Cliente ${fattura.clienteId} non trovato: uso solo il nome salvato nella fattura.`);
  else if (!cliente.indirizzo || !cliente.cap || !cliente.comune) avvisi.push(`Indirizzo del cliente ${cliente.nome} incompleto: l'XML potrebbe essere scartato dallo SDI.`);
  return { fattura, cliente, config: snap.config, dir: cartella ?? documentsDir(ctx.syncDir!, anno(fattura.data)), avvisi, fallbackRighe: fallback };
}
```

Import aggiuntivi in `shared.ts`: `type Config` da `src/types`, `emittenteMancante`, `righeOrFallback` da `fatturaDocumento`, `documentsDir` da `'../documents'`.

- [ ] **Step 4: I due tool**

`mcp/src/tools/generaFatturaXml.ts`:

```ts
import { z } from 'zod';

import { buildFatturaXMLData } from '../../../src/lib/fatturaDocumento';
import { generateFatturaXML } from '../../../src/lib/xml/generator';
import { safeFileComponent, writeExclusive } from '../documents';
import { defineTool, documentoFattura, userIdSchema } from './shared';

export const generaFatturaXml = defineTool({
  name: 'genera_fattura_xml',
  title: 'Genera XML FatturaPA',
  description: 'Scrive su disco l\'XML FatturaPA di una fattura già salvata (per una proposta: dopo la conferma nell\'app, usa il recordId di get_proposal). Default: cartella documenti/<anno> accanto al file di sync; non sovrascrive mai, aggiunge -2, -3. Restituisce il percorso. Non modifica i dati di Pivella.',
  input: {
    userId: userIdSchema,
    fatturaId: z.string().min(1),
    cartella: z.string().min(1).optional().describe('Cartella di destinazione assoluta; default documenti/<anno> nella cartella di sync'),
  },
  readOnly: false,
  async handler(ctx, { userId, fatturaId, cartella }) {
    const doc = await documentoFattura(ctx, userId, fatturaId, cartella);
    const xml = generateFatturaXML(buildFatturaXMLData(doc.fattura, doc.cliente, doc.config));
    const progressivo = Math.random().toString(36).substring(2, 7).toUpperCase();
    const percorso = await writeExclusive(doc.dir, `IT${safeFileComponent(doc.config.partitaIva!)}_${safeFileComponent(progressivo)}`, 'xml', xml);
    const structured = { percorso, fallbackRighe: doc.fallbackRighe, avvisi: doc.avvisi };
    return { structured, text: [`XML della fattura ${doc.fattura.numero ?? fatturaId} scritto in ${percorso}`, ...doc.avvisi].join('. ') };
  },
});
```

`mcp/src/tools/generaFatturaCortesia.ts`:

```ts
import { z } from 'zod';

import { buildCourtesyInvoice, buildPdfOptions } from '../../../src/lib/fatturaDocumento';
import { safeFileComponent, writeExclusive } from '../documents';
import { renderCourtesyPdf } from '../pdf';
import { anno, defineTool, documentoFattura, userIdSchema } from './shared';

export const generaFatturaCortesia = defineTool({
  name: 'genera_fattura_cortesia',
  title: 'Genera fattura di cortesia',
  description: 'Scrive su disco il PDF di cortesia di una fattura già salvata, con logo, colori e lingua delle impostazioni di Pivella. Default: cartella documenti/<anno> accanto al file di sync; non sovrascrive mai, aggiunge -2, -3. Restituisce il percorso, da allegare a una mail. Non modifica i dati di Pivella.',
  input: {
    userId: userIdSchema,
    fatturaId: z.string().min(1),
    cartella: z.string().min(1).optional().describe('Cartella di destinazione assoluta; default documenti/<anno> nella cartella di sync'),
    lingua: z.enum(['it', 'en', 'de']).optional().describe('Lingua del PDF; default quella delle impostazioni'),
  },
  readOnly: false,
  async handler(ctx, { userId, fatturaId, cartella, lingua }) {
    const doc = await documentoFattura(ctx, userId, fatturaId, cartella);
    const pdf = await renderCourtesyPdf(buildCourtesyInvoice(doc.fattura, doc.cliente, doc.config), buildPdfOptions(doc.config, { locale: lingua }));
    const nome = `fattura-cortesia-${safeFileComponent(doc.fattura.numero || doc.fattura.id)}-${anno(doc.fattura.data)}`;
    const percorso = await writeExclusive(doc.dir, nome, 'pdf', pdf);
    const structured = { percorso, fallbackRighe: doc.fallbackRighe, avvisi: doc.avvisi };
    return { structured, text: [`Fattura di cortesia ${doc.fattura.numero ?? fatturaId} scritta in ${percorso}`, ...doc.avvisi].join('. ') };
  },
});
```

Le lingue sono quelle di `src/lib/pdf/translations.ts` (`it`, `en`, `de`).

- [ ] **Step 5: Registro, descrizioni, contesto**

- `index.ts`: importa i due tool, aggiungili in fondo a `TOOLS`, commento `/** Registro dei 19 tool ... */`.
- `getFattura.ts`: nella descrizione aggiungi `Include righe (se salvate) e haRighe.`
- `listFatture.ts`: nella descrizione aggiungi `Ogni fattura ha haRighe: false per le fatture salvate senza dettaglio, per le quali XML e cortesia usano una riga unica.`
- `proposeFattura.ts`: in coda alla descrizione aggiungi `Dopo la conferma nell'app, get_proposal restituisce result.recordId: passalo a genera_fattura_xml e genera_fattura_cortesia per i documenti.`
- `server.ts` riga 49: aggiungi `syncDir: options.syncDir` al `ToolContext`, e `syncDir?: string` alle opzioni di creazione del server (stesso oggetto che contiene `now`).
- `cli.ts`: passa `syncDir: dir` dove crea il server (riga 114-117).

- [ ] **Step 6: Esegui i test**

Run: `npx tsx --test mcp/src/tools/tools.test.ts && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/src
git commit -m "feat(mcp): genera_fattura_xml e genera_fattura_cortesia"
```

---

### Task 11: Pacchetto MCP, versioni, documentazione

**Files:**
- Modify: `package.json` (`version`, script `mcp:build`)
- Modify: `mcp/package.json` (`version`, `dependencies`)
- Modify: `README.md`, `mcp/README.md`
- Modify: il file che mostra la versione dell'app, se diverso da `package.json` (`grep -rn "6\.1\.0" src index.html public`)

- [ ] **Step 1: Versioni**

`package.json`: `"version": "7.0.0"`. `mcp/package.json`: `"version": "1.0.0"`. Aggiorna ogni altra occorrenza di `6.1.0` trovata dal grep (es. costante di versione dell'app); per la versione MCP, `grep -rn "0\.2\.0" mcp/src` e aggiorna se c'è una costante.

- [ ] **Step 2: Dipendenze e build del pacchetto MCP**

In `mcp/package.json` aggiungi a `dependencies` le versioni presenti nel `package.json` radice: `"@react-pdf/renderer": "^4.3.2"`, `"react": "^18.2.0"`. Lo script `mcp:build` diventa:

```json
"mcp:build": "esbuild mcp/src/bin.ts --bundle --platform=node --target=node20 --format=esm --packages=external --jsx=automatic --outfile=mcp/dist/cli.js && mkdir -p mcp/dist/fonts && cp public/fonts/RobotoMono-Regular.ttf mcp/dist/fonts/"
```

(`--jsx=automatic` allinea esbuild a `"jsx": "react-jsx"` di `tsconfig.json`, necessario per `renderer.tsx`.)

- [ ] **Step 3: Verifica del pacchetto**

Run:
```bash
npm run mcp:build && cd mcp && npm pack --dry-run && cd ..
```
Expected: build senza errori; il pacchetto elenca `dist/cli.js`, `dist/fonts/RobotoMono-Regular.ttf`, `README.md`.

Poi uno smoke test su una cartella di sync temporanea: `node mcp/dist/cli.js check --dir "$(mktemp -d)"` deve rispondere senza crash (messaggio "nessun file di sync").

- [ ] **Step 4: README**

In `mcp/README.md` (inglese) e nella sezione MCP di `README.md` (italiano):
- elenco dei tool: aggiungi `genera_fattura_xml` e `genera_fattura_cortesia` con una riga ciascuno (scrivono in `documenti/<anno>` nella cartella di sync o nella cartella indicata, mai sovrascrivendo, non modificano i dati);
- avviso di compatibilità: "pivella-mcp 1.0 richiede Pivella 7.0 e viceversa: il file di sync passa alla versione 3. Aggiorna entrambi." (in inglese nel README MCP).
- conta dei tool: da 17 a 19 dove compare.

- [ ] **Step 5: Verifica completa**

Run: `npm test && npm run lint && npm run build && npm run mcp:build`
Expected: tutto PASS.

- [ ] **Step 6: Commit e push**

```bash
git add package.json package-lock.json mcp/package.json README.md mcp/README.md
git commit -m "chore: Pivella 7.0.0 e pivella-mcp 1.0.0"
git push origin main
```

- [ ] **Step 7: Pubblicazione npm (solo con conferma dell'utente)**

Chiedi conferma prima. Il deploy dell'app (Netlify su push a `main`) e la pubblicazione di `pivella-mcp` 1.0.0 vanno fatti insieme, perché un MCP 0.2 si ferma sui file v3. Comando, da far lanciare all'utente se serve l'OTP:

```bash
cd mcp && npm publish
```

Poi verifica: `npm view pivella-mcp version` restituisce `1.0.0`, e `curl -sL https://pivella.it` carica un bundle con `7.0.0`.
