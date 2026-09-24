# Righe in fattura, XML alla conferma, cortesia da fatture salvate e da MCP

Data: 24/9/2026. Versioni di arrivo: app 7.0.0, `pivella-mcp` 1.0.0, schema di sync v3.

## Obiettivo

1. **Bug:** confermare una proposta `fattura` dell'MCP crea il record ma non genera l'XML. Causa: `planFattura` (`src/lib/sync/applyProposal.ts`) salva solo i totali, scarta le righe e nessuno chiama `generateFatturaXML`.
2. Le fatture salvate conservano le righe: XML e fattura di cortesia si generano da una fattura salvata, senza dover ricaricare l'XML.
3. L'MCP genera su disco XML e PDF di cortesia di una fattura confermata.
4. Bump major.

## Decisioni prese

- Le righe stanno in un campo opzionale di `Fattura`, non in uno store separato né come XML serializzato.
- L'MCP scrive i file su disco e restituisce il percorso (opzione A).
- L'MCP genera sia l'XML sia il PDF di cortesia.
- Alla conferma di una proposta l'app scarica subito l'XML, come il modale Nuova fattura.
- Fatture senza righe: fallback a riga unica modificabile; reimportare l'XML originale arricchisce la fattura esistente con le righe.

## 1. Modello dati e sync

`Fattura` (`src/types/index.ts`) riceve campi opzionali:

- `righe?: FatturaRiga[]` con `{ descrizione: string; quantita: number; prezzoUnitario: number }`, importi nella valuta originale. Stessa forma di `NuovaFatturaRiga` e del payload `FatturaRigaPayload`; `FatturaRiga` diventa il tipo unico e gli altri due ne sono alias.
- `dataCambio?: string` (YYYY-MM-DD), serve a rigenerare l'XML di una fattura in valuta estera.
- `righeSource?: 'app' | 'xml'`, diagnostica: righe scritte dall'app (modale o proposta) o lette da un XML importato.

Schema di sync: `SYNC_SCHEMA_VERSION` passa da 2 a 3.

- La v3 legge i file v2 senza trasformazioni (fatture senza righe) e scrive sempre v3.
- Versioni diverse da 2 e 3 restano rifiutate con l'errore `SOURCE_UNAVAILABLE` esistente.
- Un client v2 (app 6.x, MCP 0.x) che trova un file v3 si ferma con "versione non supportata" invece di riscrivere fatture perdendo le righe. È il motivo tecnico del bump major.

Validazione: un validatore condiviso `validateFatturaRighe` (in `validate.ts`) definisce le righe ammesse in un record: array non vuoto, `descrizione` non vuota, `quantita` numero finito > 0, `prezzoUnitario` numero finito >= 0, totale (somma di quantità × prezzo) > 0. Le proposte restano più severe (`prezzoUnitario` > 0, come oggi `validateRighe`). `validateStore('fatture')` usa lo stesso validatore quando `righe` è presente e controlla `dataCambio` come data; una fattura con righe malformate rende il file non valido come oggi per gli altri campi. Per questo **ogni punto di scrittura passa le righe dal validatore prima di salvarle**: se non passano, la fattura si salva senza righe (fallback), mai con righe invalide. Nessun flusso dell'app può produrre uno snapshot che l'app stessa rifiuta.

Chi scrive le righe:

- `NuovaFatturaModal` quando aggiunge la fattura (`righeSource: 'app'`, più `dataCambio` per valuta estera).
- `planFattura` alla conferma di una proposta (`righeSource: 'app'`, `dataCambio` dal payload).
- Import XML singolo, batch e zip (`righeSource: 'xml'`), secondo le regole della sezione "Import XML": solo righe rappresentabili, sia per le fatture nuove sia per arricchire un duplicato senza righe; un duplicato che ha già righe non viene toccato.

Riconoscimento dei duplicati: oggi la `duplicateKey` salvata ha due formati (`numero|data|importo` da `batchImport`, `numero-data-importo` da modale, import singolo e proposte, questi ultimi a volte con l'importo in valuta). L'import (dedup e arricchimento) smette di fidarsi della chiave salvata e confronta una chiave **ricalcolata** su entrambi i lati con `computeDuplicateKey(numero, data, importo)`, dove `importo` è sempre in EUR in tutti i percorsi di scrittura. `getDuplicateKey` diventa questo ricalcolo; il campo `duplicateKey` resta scritto per compatibilità ma non viene più letto per il confronto.

## 2. App

### Modulo condiviso `src/lib/fatturaDocumento.ts`

Puro, senza DOM, usato da app e MCP:

- `righeOrFallback(fattura): { righe: FatturaRiga[]; fallback: boolean }`: righe salvate, oppure una riga unica "Prestazione professionale" con quantità 1 e prezzo pari a `importoValuta ?? importo`.
- `clienteXMLData(cliente)`: mappa `Cliente` sul blocco cliente di `FatturaXMLData` (stessa mappatura oggi in `NuovaFatturaModal`).
- `buildFatturaXMLData(fattura, cliente, config): FatturaXMLData`: emittente, partita IVA, cliente, numero, data, righe, IBAN, beneficiario, valuta, cambio e data cambio. Lancia un errore con l'elenco dei campi mancanti se l'emittente non è configurato.
- `buildCourtesyInvoice(fattura, cliente, config): Invoice`: l'`Invoice` del renderer PDF, con emittente dalla configurazione, cliente dall'anagrafica, righe (IVA 0, regime forfettario), bollo 2 € sopra 77,47 € in EUR, IBAN.
- `buildPdfOptions(config, overrides?): PDFOptions`: colori, footer, lingua, logo e mappa valute dalla configurazione `courtesyInvoice`; oggi la stessa logica sta dentro `FatturaCortesia.tsx`.

`NuovaFatturaModal` usa `clienteXMLData` e `buildFatturaXMLData` dove possibile, così modale e conferma producono lo stesso XML.

### Conferma di una proposta

Dopo aver scritto i record, per una proposta `fattura` l'app genera l'XML con `buildFatturaXMLData` e lo scarica con `downloadXML`/`generateFileName`. Toast: "Fattura n. X creata, XML scaricato". Se la generazione fallisce (es. emittente incompleto) la fattura resta creata e il toast lo segnala; l'XML resta scaricabile dalla lista.

### Lista fatture (`Fatture.tsx`)

Due azioni per riga:

- **Scarica XML**: sempre disponibile. Se la fattura non ha righe usa il fallback e avvisa che l'XML dovrebbe corrispondere a quello inviato allo SDI.
- **Fattura di cortesia**: apre la pagina Cortesia con la fattura precaricata.

### Pagina Fattura di Cortesia

Oltre al caricamento XML, un selettore "Da fattura salvata" (ricerca per numero o cliente, anno corrente in cima). La scelta riempie lo stesso `Invoice` che oggi produce il parser XML: modifica delle righe, anteprima e generazione restano invariate. Fatture senza righe: avviso "Righe non salvate: ho usato una riga unica, modificala o reimporta l'XML originale".

### Import XML

Il modello `righe` rappresenta solo le fatture forfettarie semplici che l'app stessa genera: righe senza IVA, senza sconti, con totale uguale a quantità × prezzo. L'import estrae le righe con una funzione pura `righeFromXml(xml)` che restituisce `{ righe, valuta, importoValuta, tassoCambio, dataCambio }` oppure `{ nonRappresentabile: motivo }`.

Una fattura XML è rappresentabile se, per ogni `DettaglioLinee`: `AliquotaIVA` = 0, nessun `ScontoMaggiorazione`, `Quantita` (default 1) > 0, `PrezzoTotale` = `Quantita` × `PrezzoUnitario` entro 0,01; la somma dei `PrezzoTotale` coincide con `ImponibileImporto` di `DatiRiepilogo` entro 0,01; e, se presente, `ImportoTotaleDocumento` coincide con la stessa somma entro 0,01. Quest'ultimo controllo serve perché l'import salva `ImportoTotaleDocumento` come `importo` (`xmlParsing.ts`) mentre `generateFatturaXML` scrive un totale documento uguale alla somma delle righe: un XML con imponibile 100 e totale 102 (per esempio bollo addebitato al cliente) non è rappresentabile e si importa senza righe. Inoltre le righe estratte devono passare `validateFatturaRighe`. Se una condizione fallisce, la fattura si importa come oggi, senza righe, e il riepilogo dell'import la elenca tra le "righe non importate" con il motivo.

Valuta estera: se le righe hanno `AltriDatiGestionali` con `TipoDato` `VALUTA` (formato scritto da `generateFatturaXML`), tutte le righe devono averlo con lo stesso codice, altrimenti la fattura non è rappresentabile. In quel caso:

- `valuta` è il codice ISO in testa a `RiferimentoTesto`, `prezzoUnitario` = `RiferimentoNumero` / `Quantita` (importi nella valuta originale, mai i prezzi EUR del documento), `dataCambio` = `RiferimentoData`;
- `importoValuta` = somma dei `RiferimentoNumero`; `tassoCambio` = quello scritto nella `Causale` ("1 EUR = X VAL") se presente, altrimenti `importoValuta / ImponibileImporto` arrotondato a 6 decimali;
- per una fattura nuova l'import salva anche `valuta`, `valutaSimbolo` (dalle valute configurate, altrimenti il codice), `importoValuta`, `tassoCambio`, `dataCambio`; `importo` resta il totale EUR del documento.

Arricchimento di un duplicato senza righe: avviene solo se la valuta dedotta dall'XML coincide con quella della fattura salvata (assente vale EUR). Per le valute estere si scrivono `righe`, `dataCambio` e, se mancano, `importoValuta` e `tassoCambio`; se la fattura salvata ha già un `tassoCambio` diverso da quello dedotto oltre lo 0,1%, l'arricchimento viene saltato e segnalato. Così la rigenerazione non converte mai due volte.

Il riepilogo dell'import conta a parte le fatture arricchite e quelle con righe non importate.

### Pulizia

`src/components/modals/CourtesyInvoiceModal.tsx` non è raggiungibile (nessuno imposta `showModal` a `"courtesy-invoice"`): viene rimosso insieme al suo ramo in `ForfettarioApp.tsx`.

## 3. MCP (`pivella-mcp` 1.0.0)

Due tool nuovi. Scrivono file su disco, mai il file di sync: sui dati resta valido che l'MCP scrive solo proposte.

- `genera_fattura_xml({ userId, fatturaId, cartella? })`
- `genera_fattura_cortesia({ userId, fatturaId, cartella?, lingua? })`, `lingua` (`it`/`en`) sostituisce quella della configurazione.

Funzionamento:

- Leggono fattura, cliente e configurazione dallo snapshot e usano `fatturaDocumento.ts` e `generateFatturaXML`, lo stesso codice dell'app.
- Il PDF usa `src/lib/pdf/renderer.tsx`. La registrazione del font diventa configurabile: nel browser `/fonts/RobotoMono-Regular.ttf`, in Node il percorso del TTF incluso nel pacchetto. `@react-pdf/renderer` e `react` diventano dipendenze di `pivella-mcp`; la build copia il font in `mcp/dist/fonts/`.
- Il logo base64 della configurazione vale anche in Node.

Destinazione:

- `cartella` se indicata, altrimenti `<cartella del file di sync>/documenti/<anno della fattura>/`; le cartelle mancanti vengono create.
- Nomi: XML `IT<piva>_<progressivo>.xml` (stessa `generateFileName` dell'app), PDF `fattura-cortesia-<numero>-<anno>.pdf`.
- Sanitizzazione: ogni componente del nome derivato dai dati (partita IVA, numero, anno) passa da `safeFileComponent`, che sostituisce ogni carattere fuori da `[A-Za-z0-9_-]` con `-`, comprime i `-` ripetuti e rifiuta un risultato vuoto. Il nome finale non contiene separatori di percorso; il percorso risolto (`path.resolve`) deve restare dentro la cartella di destinazione risolta, altrimenti errore senza scrivere.
- Mai sovrascrivere, anche con chiamate concorrenti: il file si crea in modo esclusivo (`fs.open(path, 'wx')`); su `EEXIST` si riprova con `-2`, `-3`, ... prima dell'estensione, fino a 100 tentativi, poi errore.

Risposta: percorso assoluto del file, `fallbackRighe: boolean`, avvisi su dati del cliente mancanti. Emittente incompleto o fattura inesistente: nessun file scritto, errore strutturato con i campi mancanti.

Tool esistenti:

- `get_fattura` e `list_fatture` restituiscono `righe` quando presenti e il flag `haRighe`.
- La descrizione di `propose_fattura` spiega il flusso: proposta, conferma nell'app, poi `genera_fattura_xml`/`genera_fattura_cortesia` con il `recordId` della proposta applicata (da `get_proposal`).
- Il datasource legge file v2 e v3 e scrive le proposte in v3.

README (italiano e `mcp/README.md` inglese) e changelog: app e MCP vanno aggiornati insieme.

## 4. Versioni e test

Versioni: app 7.0.0 (`package.json`), `pivella-mcp` 1.0.0, schema di sync 3.

Test (`tsx --test`, TDD):

- schema: file v2 letto dalla v3, v4 rifiutato, righe malformate rifiutate;
- `planFattura`: salva `righe`, `dataCambio`, `righeSource`;
- `fatturaDocumento`: fallback, bollo, valuta estera, XML generato da una fattura salvata uguale a quello del modale per gli stessi dati (a parte il progressivo invio casuale);
- validazione: righe a prezzo zero ammesse nel record ma non nelle proposte; righe negative e totale zero rifiutati; nessun percorso di scrittura (modale, proposta, import) salva righe che `validateStore` rifiuterebbe;
- import: righe estratte; XML non rappresentabili (IVA, sconto, `PrezzoTotale` incoerente, somma diversa dal riepilogo, `ImportoTotaleDocumento` 102 con imponibile 100, righe negative) importati senza righe e segnalati; dedup e arricchimento che riconoscono fatture salvate con chiavi `numero|data|importo` e `numero-data-importo` (anche con importo in valuta);
- valuta estera, andata e ritorno: fattura GBP salvata → `generateFatturaXML` → `righeFromXml` → stesse righe in GBP, stesso `tassoCambio` e `dataCambio` → XML rigenerato con gli stessi importi EUR; arricchimento saltato per valuta o cambio incoerenti;
- tool MCP su cartella temporanea: file scritto, suffisso anti-sovrascrittura, due scritture concorrenti che producono due file distinti, numero `12/2026` e `../x` sanitizzati dentro la cartella, errore con emittente incompleto, PDF che inizia con `%PDF`, `get_fattura` con `righe`.

Verifica manuale: conferma di una proposta nell'app con download dell'XML; cortesia da fattura salvata con e senza righe.
