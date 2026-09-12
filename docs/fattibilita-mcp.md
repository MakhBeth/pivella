# Fattibilità: esporre i dati di Pivella a una AI tramite MCP

Data: 2026-09-12
Stato: indagine, nessun codice di produzione

Legenda usata in tutto il documento:

- **[V]** verificato leggendo il codice del repo (con riferimento al file).
- **[I]** ipotesi, conoscenza generale di piattaforma o comportamento non verificato in questo repo.

> **Aggiornamento 2026-09-12, sesta iterazione, specifica chiusa.** Decisione finale di Davide: nessun legame tra calendario e fatture, mai. Le giornate si leggono per cliente e periodo, gli importi si leggono solo dalle fatture, i due dati non si combinano in un unico numero. Il tool "giornate non fatturate" è eliminato, nessun `fatturaId`, nessun flag. La sezione 13.7 registra la verifica e la decisione. Chiuse anche: numero fattura come oggi, cartelle cloud non supportate, `move()` con feature detection, npm rimandato.
>
> **Aggiornamento 2026-09-12, quarta iterazione. Decisione: MCP locale, merge come da sezione 12, backup obbligatorio prima di ogni scrittura sul file.** La **sezione 13** è la specifica congelata: contratto dei tool, formato v2 e merge, politica di backup, interfaccia DataSource. Le sezioni precedenti restano come storia e fonte dei fatti verificati.
>
> **Aggiornamento 2026-09-12, terza iterazione.** Si valuta di tornare al MCP locale. Il piano concreto (client, formato file, tool, conferme, file da toccare, effort, cosa si perde, via di mezzo) è nella **sezione 12**.
>
> **Aggiornamento 2026-09-12, seconda iterazione.** Il vincolo è cambiato: si vuole un **web MCP**, cioè un server remoto raggiungibile via HTTP (Streamable HTTP o SSE) che claude.ai o ChatGPT possano aggiungere con un URL. La soluzione locale descritta nelle sezioni 0-10 resta come analisi di base e come fonte dei fatti verificati, ma **non è più la raccomandazione**. L'analisi con il vincolo fisso e la raccomandazione finale sono nella sezione 11.

## 0. Risposta breve (prima iterazione, vincolo locale)

Sì, è fattibile, ma non nella forma "MCP raggiungibile da web che legge il browser". Un server MCP non può raggiungere IndexedDB di un browser: serve sempre un ponte, e il ponte più economico esiste già nel codice. La sync su cartella scrive l'intero database in un file JSON sul disco dell'utente e lo rilegge a ogni focus della finestra **[V]**. Un MCP locale che legge e scrive quel file copre lettura e scrittura senza toccare la promessa "All data stays local", a patto di cambiare il formato del file e la logica di merge, che oggi è un rimpiazzo totale.

Raccomandazione: MCP locale (stdio) sul file di sync, con le scritture messe in una "inbox" di proposte che l'utente conferma dentro l'app. L'esposizione via web (claude.ai, Streamable HTTP pubblico) resta possibile come tunnel gestito dall'utente, ma un relay ospitato da Pivella richiede di riscrivere la promessa di prodotto e di introdurre account. Dettagli in §7.

## 1. Cosa fa oggi l'app (verificato)

### 1.1 Dove stanno i dati

- Database IndexedDB `ForfettarioDB`, versione 3, sei store con `keyPath: 'id'`: `config`, `clienti`, `fatture`, `workLogs`, `scadenze`, `users` **[V]** `src/lib/constants/fiscali.ts`, `src/lib/db/IndexedDBManager.ts`.
- Nessun indice secondario: il filtro per utente è fatto in JavaScript con `getAllForUser`, che carica tutto lo store e filtra su `userId` **[V]** `IndexedDBManager.ts`.
- In localStorage: `pivella_current_user_id` (con fallback legacy `forfettino_current_user_id`), tema e preferenze **[V]** `src/hooks/useUsers.ts`. Conferma il dato osservato dal vivo.
- Unica chiamata di rete dell'app: il fetch dei cambi BCE **[V]** `src/lib/utils/ecbRates.ts`. Nessun backend: Netlify serve solo file statici con redirect SPA **[V]** `netlify.toml`.

### 1.2 La sync su cartella esistente

- Usa la File System Access API, quindi solo Chromium **[V]** `src/lib/utils/fileSystemSync.ts` (`isFileSystemAccessSupported`, messaggi per Safari, Firefox, iOS).
- L'handle della cartella scelta è salvato nel db IndexedDB `PivellaSync`, store `handles`, chiave `syncDirectoryHandle`; `ForfettinoSync` è il nome pre-rename, letto come fallback e migrato **[V]**. Sono questi i due db visti dal vivo. Contengono solo l'handle, non dati.
- Il file scritto è `pivella-sync.json` nella cartella scelta (fallback in lettura `forfettino-sync.json`) **[V]**.
- Contenuto del file: il risultato di `dbManager.exportAll()`, cioè **tutti gli store di tutti gli utenti**, serializzato con `JSON.stringify(data, null, 2)` **[V]** `useFolderSync.ts` riga 183, `IndexedDBManager.exportAll`. Nessun campo di versione, nessun timestamp, nessun id di dispositivo.
- Quando scrive: a ogni cambiamento di stato React (users, config, clienti, fatture, workLogs, scadenze), con debounce di 500 ms **[V]** `AppContext.tsx` righe 275-287, `useFolderSync.ts` riga 168.
- Quando legge: all'avvio (dopo che db e utenti sono pronti) e a ogni evento `focus` della finestra **[V]** `useFolderSync.ts` righe 86-165.
- Come applica la lettura: `handleDataLoaded` chiama `dbManager.importAll(data)`, che per ogni store fa `clear()` e poi `put()` di ogni record. È un **rimpiazzo totale**, non un merge **[V]** `AppContext.tsx` riga 224, `IndexedDBManager.importAll`.
- Permesso: `verifyPermission` chiede `readwrite`; se la scrittura fallisce con `NotAllowedError` l'handle viene scartato **[V]**.

Conseguenza rilevante per l'MCP: **un processo esterno che modifica `pivella-sync.json` viene già letto dall'app al prossimo focus, senza alcuna modifica al codice**. Ma il modello "ultimo che scrive vince, file intero" rende le scritture concorrenti pericolose (vedi §5).

### 1.3 Backup manuale

- Esporta: `exportForUser(currentUserId)` scaricato come JSON `forfettario-backup-<nome>-<data>.json` **[V]** `AppContext.tsx` righe 290-306.
- Importa: cancella tutti i dati dell'utente corrente e inserisce quelli del file, riassegnando `userId` e scartando lo store `users` **[V]** `AppContext.tsx` `importData`.

### 1.4 Come nascono fatture e giornate

- Fattura da modale "Nuova fattura": il numero suggerito è `max(numero) + 1` calcolato in memoria sulle fatture dell'utente **[V]** `NuovaFatturaModal.tsx` righe 65-90. L'XML FatturaPA viene generato nel browser da `src/lib/xml/generator.ts` e scaricato; poi, se la checkbox è attiva, il record viene salvato con `id: Date.now().toString()`, `duplicateKey` = `numero-data-importo`, `dataIncasso` uguale alla data emissione **[V]** righe 268-313. L'eventuale cliente nuovo viene creato prima, anch'esso con `id: Date.now()`.
- Giornata di lavoro: `WorkLog` con `id: Date.now().toString()`, `clienteId`, `data`, `tipo` (`ore` o `giornata`), `quantita`, `note` **[V]** `types/index.ts`, `Calendario.tsx` righe 288-322. Esistono due clienti speciali non in anagrafica: `__vacation__` e `__misc__` **[V]**.
- Le scadenze fiscali non vengono rigenerate alla creazione di una fattura: `generatePaymentSchedule` e `bulkSaveScadenze` sono chiamati solo dalla pagina Scadenze su azione dell'utente **[V]** `Scadenze.tsx` righe 115, 269, 292. Una proposta di fattura confermata non deve quindi toccare lo store `scadenze`.
- Gli id `Date.now()` sono generati lato client senza controllo di collisione **[V]**. Un writer esterno deve usare uno spazio di id diverso (per esempio prefisso `mcp_` + uuid) per non collidere.

### 1.5 Utenti

- `users` è una lista di profili: `id` = `'user_' + Date.now()`, `nome`, `createdAt`, `color` **[V]**. Nessuna password, nessun token, nessuna sessione. Lo switch utente è un cambio di chiave in localStorage **[V]** `useUsers.ts`.
- Il file di sync contiene i dati di tutti i profili, senza indicare quale sia "corrente": quell'informazione è solo nel localStorage del browser **[V]**.

### 1.6 La promessa di prodotto

Dichiarata in tre punti **[V]**:

- Footer: `🔒 All data stays local` (`Footer.tsx` riga 15, `ForfettarioApp.tsx` riga 632).
- Guida: "Niente registrazioni, niente cloud: i dati restano sul tuo computer" (`Guida.tsx` riga 112) e "i dati stanno solo sul tuo computer, quindi esporta il backup" (riga 70).
- Meta description e Open Graph in `index.html`: "I dati restano sul tuo computer".

## 2. Il problema di fondo: un MCP non può leggere il browser

Un server MCP è un processo (locale via stdio, o remoto via Streamable HTTP) che espone tool a un client AI **[I]**. IndexedDB è isolato per origine e per profilo browser: nessun processo esterno, nemmeno sullo stesso computer, può aprirlo se non passando dal browser stesso **[I]**. Le vie possibili sono quindi solo queste:

1. Il browser esporta i dati in un posto raggiungibile (file su disco, server remoto).
2. Qualcosa gira dentro il browser e fa da ponte (una tab dell'app, una estensione).
3. Il browser legge input da un posto raggiungibile (file su disco, server remoto).

Il punto 1 e il punto 3 esistono già insieme nella sync su cartella **[V]**. Questo è il motivo per cui la soluzione file-based è la più economica.

Nota sul termine "raggiungibile da web": se il client AI è Claude Desktop o Claude Code sul computer dell'utente, un MCP locale basta e non serve nulla di raggiungibile da Internet **[I]**. Se il client è claude.ai nel browser, serve un URL pubblico (connettore remoto), e quindi o un tunnel dal computer dell'utente o un servizio ospitato **[I]**.

## 3. Architetture a confronto

### A. MCP locale sul file di sync (File System Access API già presente)

Come funziona: un piccolo server MCP stdio (Node/TypeScript, così può riusare i tipi di `src/types` e in prospettiva `src/lib/xml/generator.ts`) legge `pivella-sync.json` dalla cartella che l'utente ha già scelto in Impostazioni. Per le letture basta questo. Per le scritture, il server modifica il file e l'app lo rilegge al focus.

- Modifiche all'app: **necessarie ma contenute** (§5): versione dello schema e timestamp nel file, merge per record invece di rimpiazzo, spazio id separato, opzionale inbox di proposte.
- Copertura: Chromium desktop, come la sync attuale **[V]**. Safari, Firefox, iOS restano fuori, ma lo sono già per la sync.
- Promessa: rispettata. I dati non lasciano il computer se non verso il provider AI scelto dall'utente, che è l'atto esplicito richiesto.
- Auth: nessuna nuova superficie. Chi può leggere il file è chi ha accesso al disco.
- Limiti: la tab deve andare a fuoco per vedere le modifiche (o l'app deve osservare il file, §5.4). Race condition tra scrittura del server e scrittura debounced dell'app, da gestire con merge e timestamp.

### B. Tab dell'app come ponte verso un relay remoto

Come funziona: l'app apre un WebSocket/SSE verso un servizio Pivella; il server MCP remoto riceve la chiamata dall'AI, la inoltra alla tab, la tab legge IndexedDB e risponde **[I]**.

- Modifiche all'app: alte (client di rete, riconnessione, autenticazione del dispositivo, UI di pairing).
- Infrastruttura: un backend sempre acceso, con costi, uptime, logging. Oggi non esiste nulla del genere **[V]**.
- Promessa: **violata** nella lettera, anche se il relay non persiste nulla: i dati transitano su un server Pivella. Serve riscrivere footer, guida e meta come opt-in esplicito.
- Auth: serve una vera identità (pairing code, token per dispositivo, OAuth per il connettore remoto). Introduce di fatto le "registrazioni" che la guida esclude.
- Funziona solo con la tab aperta. Funziona su tutti i browser.

### C. Estensione browser come ponte

Come funziona: una estensione con content script sull'origine `pivella.it` legge IndexedDB della pagina e comunica con un MCP locale via Native Messaging **[I]** (i content script condividono lo storage dell'origine della pagina; da verificare per IndexedDB in Chrome e Firefox, non l'ho testato).

- Modifiche all'app: quasi nulle.
- Costo: alto. Pubblicazione sugli store, review, manifest V3, un secondo codebase da mantenere, installazione di un host nativo. Chromium e Firefox, non Safari iOS.
- Promessa: rispettata (tutto locale).
- Vantaggio rispetto ad A: accesso diretto a IndexedDB, senza file intermedio e senza dipendere dal focus. Svantaggio: complessità sproporzionata rispetto al risultato, dato che il file di sync esiste già.

### D. Backend di sync opzionale cifrato end-to-end

Come funziona: l'app carica uno snapshot cifrato su un server; un MCP remoto lo scarica e lo decifra con una chiave fornita dall'utente **[I]**.

- Osservazione chiave: **per far leggere i dati all'AI il plaintext deve esistere da qualche parte fuori dal browser**. Se l'MCP remoto decifra, il server MCP vede tutto. La cifratura E2E protegge dallo storage, non dal componente che serve i tool. Quindi D non è più "locale" di B, solo più costoso.
- Promessa: violata come in B. Auth come in B, più gestione delle chiavi.
- Vale la pena solo se in futuro si vuole comunque una sync multi-dispositivo cloud. Non è giustificata dal solo caso MCP.

### E. Export e import di file, manuale

Come funziona: l'utente esporta il backup, l'MCP legge il JSON; per scrivere, l'MCP produce un file che l'utente importa.

- Modifiche all'app: zero per la lettura. Per la scrittura no: l'import attuale **cancella tutti i dati dell'utente** e li sostituisce **[V]** `AppContext.tsx` `importData`. Servirebbe un "import merge" o un "import proposte", che è la stessa inbox di A.
- Lettura sempre stantia; UX faticosa; funziona su tutti i browser.
- Utile come fallback per Safari e Firefox, non come soluzione principale.

### Tabella riassuntiva

| | A. MCP locale su file | B. Tab + relay | C. Estensione | D. Backend E2E | E. Export/import |
|---|---|---|---|---|---|
| Modifiche app | medie | alte | minime | alte | basse (lettura) / medie (scrittura) |
| Infrastruttura Pivella | nessuna | backend | store + host nativo | backend | nessuna |
| Promessa "dati locali" | rispettata | violata | rispettata | violata | rispettata |
| Nuova auth | no | sì | no | sì | no |
| Browser | Chromium desktop | tutti | Chromium, Firefox | tutti | tutti |
| Raggiungibile da claude.ai web | solo con tunnel utente | sì | solo con tunnel | sì | no |
| Freschezza lettura | file, al più 500 ms **[V]** | live | live | ultimo upload | manuale |
| Scritture sicure | con merge (§5) | sì | sì | con merge | no (import distruttivo) |

## 4. Letture: quali tool esporre (vale per tutte le architetture)

Derivati dai tipi in `src/types/index.ts` **[V]**:

- `list_users` → id, nome. Obbligatorio come primo passo, vedi §6.
- `get_config(userId)` → coefficiente, aliquota, ATECO, gestione previdenziale, dati emittente. Attenzione a `courtesyInvoice.logoBase64`: può pesare molto, va omesso di default.
- `list_clienti(userId)`, `list_fatture(userId, anno?, incassate?)`, `list_work_logs(userId, da, a)`, `list_scadenze(userId, anno?)`.
- `get_riepilogo(userId, anno)`: fatturato, incassato, stima imposte. Le funzioni di calcolo sono in `src/lib/utils/forfettario.ts`, `calculations.ts` e `paymentScheduler.ts` **[V]**; importano solo tipi, costanti e `dateHelpers`, nessuna API del browser **[V]**, quindi sono riusabili da Node così come sono. In `src/lib/xml/generator.ts` solo `downloadXML` usa il DOM; `generateFatturaXML` è pura **[V]**.

Tutti i tool di lettura sono sicuri per definizione: non toccano lo stato.

## 5. Scritture: creare fatture e registrare giornate

### 5.1 Perché l'app deve essere l'esecutore finale

Tre motivi verificati nel codice:

1. La numerazione della fattura è calcolata dal client in memoria **[V]**. Due writer (app e MCP) possono produrre lo stesso numero.
2. L'XML FatturaPA e il download sono generati nel browser **[V]**. Un MCP che "crea una fattura" senza XML crea solo un record contabile; per produrre il file dovrebbe replicare `generateFatturaXML` fuori dal browser.
3. La sync legge il file con un rimpiazzo totale **[V]**. Qualsiasi merge intelligente deve stare nell'app, che è l'unico posto dove i due stati (IndexedDB e file) sono visibili insieme.

### 5.2 Pattern raccomandato: inbox di proposte con conferma nell'app

Il server MCP non scrive mai direttamente negli store. Scrive proposte in una sezione separata del file (o in un file a parte, per esempio `pivella-inbox.json`):

```json
{
  "schemaVersion": 2,
  "proposals": [
    {
      "id": "prop_9f1c...",
      "createdAt": "2026-09-12T10:15:00Z",
      "source": "mcp",
      "userId": "user_1712...",
      "type": "workLog",
      "payload": { "clienteId": "1710...", "data": "2026-09-11", "tipo": "giornata", "quantita": 1, "note": "" },
      "status": "pending"
    }
  ]
}
```

L'app, al focus o via osservazione del file, mostra un badge "N proposte da confermare"; l'utente vede il riepilogo e conferma o rifiuta. Alla conferma l'app esegue il percorso normale (`addWorkLog`, `addFattura` con numerazione e XML), poi marca la proposta come `applied` con l'id del record creato, così l'MCP può leggere l'esito.

Vantaggi: la conferma esplicita avviene dove ci sono le regole di validazione; nessuna race sulla numerazione; il comportamento è identico per un MCP locale, remoto o per un file importato a mano. Svantaggio: la scrittura non è immediata, serve un passaggio nell'app.

### 5.3 Conferma sul lato client AI

In alternativa o in aggiunta, la conferma può stare nel client AI:

- Claude Desktop e Claude Code chiedono il permesso prima di eseguire tool non in allowlist **[I]**; è una protezione del client, non del server, e l'utente può disabilitarla.
- Il protocollo MCP prevede la *elicitation*: il server può chiedere al client di far confermare qualcosa all'utente prima di proseguire **[I]**, ma non tutti i client la supportano.
- Pattern a due passi lato server: `prepare_fattura(...)` ritorna una anteprima e un token con scadenza breve; `commit_fattura(token)` scrive. Costringe il modello a mostrare l'anteprima, ma un modello può chiamare i due tool in sequenza senza fermarsi.

Nessuna di queste tre garantisce da sola che un umano abbia guardato. Per fatture, che hanno rilevanza fiscale, la conferma nell'app (§5.2) è quella da considerare vincolante; le altre sono strati aggiuntivi.

### 5.4 Cambi necessari al formato e alla sync (anche solo per la lettura sicura)

1. **Versione e timestamp nel file**: `schemaVersion`, `updatedAt` a livello file, `updatedAt` per record. Oggi non c'è nulla **[V]**.
2. **Merge per record al posto di `clear + put`** in `importAll` quando la sorgente è la sync: last-writer-wins su `updatedAt`, tombstone per le cancellazioni (oggi una cancellazione si propaga solo perché il file intero viene riscritto **[V]**).
3. **Scrittura atomica**: il server MCP scrive su file temporaneo e rinomina; l'app oggi usa `createWritable` che è già atomico al `close()` **[I]**.
4. **Osservazione del file**: oggi l'app rilegge solo su `focus` **[V]**. `FileSystemObserver` è disponibile in Chromium recenti ma non è ancora standard **[I]**; in alternativa un polling leggero del `lastModified` dell'handle ogni pochi secondi.
5. **Spazio id separato** per record creati fuori dall'app, per non collidere con `Date.now()` **[V]**.
6. **Il file contiene tutti i profili** **[V]**: il server MCP deve filtrare per `userId` e non esporre mai l'intero file come tool result.

Questi cambi sono migliorie alla sync anche senza MCP: oggi due tab o due macchine sulla stessa cartella condivisa (per esempio Dropbox) possono perdersi aggiornamenti a vicenda **[V]** per costruzione del rimpiazzo totale.

## 6. Autenticazione e multiutente

Verificato: non esiste autenticazione. Gli utenti sono profili senza credenziali, e "utente corrente" è uno stato del singolo browser **[V]**.

Implicazioni per architettura:

- **A, C, E (locale)**: l'identità è quella del sistema operativo. Il server MCP non può sapere quale profilo è "corrente" perché quell'informazione è in localStorage **[V]**. Il tool deve ricevere `userId` esplicito, e `list_users` deve essere il primo passo. Un default ragionevole: se c'è un solo profilo, usarlo. Opzionale: far scrivere all'app nel file di sync un campo `lastActiveUserId` per dispositivo, come suggerimento non vincolante.
- **B, D (remoto)**: serve una identità vera. Il connettore remoto di claude.ai richiede OAuth 2.1 sul server MCP **[I]**. Quindi: registrazione o pairing, token per dispositivo, revoca. È esattamente ciò che "niente registrazioni" esclude oggi **[V]** `Guida.tsx`. Non è un dettaglio tecnico, è una decisione di prodotto.
- Il file di sync contiene tutti i profili: in un contesto di famiglia o studio condiviso, chi ha accesso alla cartella vede tutti. Vale già oggi **[V]**, l'MCP lo rende solo più evidente. Se serve separazione, il file dovrebbe diventare uno per profilo (`pivella-sync-<userId>.json`), modifica compatibile con il merge di §5.4.

## 7. Impatto sulla promessa "All data stays local"

La promessa oggi significa tre cose distinte **[V]** (footer, guida, meta): niente account, niente cloud, dati sul computer dell'utente.

- Qualunque integrazione AI, anche la più locale, **manda i dati al provider del modello** durante la conversazione. Questo va detto nella UI di configurazione: "quando usi l'assistente, le informazioni che gli chiedi vengono inviate a <provider>". Non è in contraddizione con "i dati restano sul tuo computer" se è l'utente ad avviare esplicitamente la lettura, ma va scritto.
- **A, C, E** mantengono la promessa alla lettera: Pivella non aggiunge nessun server, nessun account.
- **B, D** la rompono: serve un backend Pivella e una forma di identità. Se si va in quella direzione, il footer, la guida e la meta description vanno riscritti come "di default i dati restano sul tuo computer; la sincronizzazione cloud e l'assistente remoto sono opzionali". È una scelta di posizionamento, non solo di testo.
- Tunnel gestito dall'utente (per esempio esporre l'MCP locale in Streamable HTTP dentro una rete privata come Tailscale, o via un tunnel tipo Cloudflare) **[I]**: mantiene la promessa perché l'infrastruttura è dell'utente, ma è per utenti tecnici e non va promesso come funzione dell'app.

## 8. Rischi

| Rischio | Dove | Mitigazione |
|---|---|---|
| Lost update: l'app riscrive il file 500 ms dopo un cambio e cancella la scrittura dell'MCP | A, E **[V]** | Merge per record con `updatedAt`, non rimpiazzo |
| Collisione di `numero` fattura | tutte le scritture **[V]** | Numerazione solo nell'app (inbox) |
| Collisione di `id` con `Date.now()` | tutte le scritture **[V]** | Prefisso e uuid per record esterni |
| Il file espone tutti i profili | A, E **[V]** | Filtro per `userId` nel server; opzionale file per profilo |
| Payload enormi (logo base64 in config) | letture **[V]** | Omettere i campi binari di default |
| Modello che esegue scritture senza fermarsi | 5.3 **[I]** | Conferma nell'app come unico punto vincolante |
| Prompt injection via dati: note di un work log o nome di un cliente contengono istruzioni | tutte **[I]** | Trattare i contenuti come dati nel tool result; nessuna scrittura senza conferma umana |
| Dipendenza da Chromium della sync | A **[V]** | Già vero oggi; E come fallback |
| Eviction di IndexedDB con disco pieno | esistente, vedi incidente del 31/8 | Il file di sync diventa anche backup: un motivo in più per A |
| Backend da mantenere, costi, GDPR | B, D **[I]** | Non intraprendere senza decisione di prodotto |

## 9. Raccomandazione finale (prima iterazione, superata dalla sezione 11)

**Scegliere A: MCP locale sul file di sync, con inbox di proposte confermate nell'app.**

Motivi, in ordine di peso:

1. È l'unica opzione che aggiunge la capacità richiesta (lettura e azioni) senza toccare la promessa di prodotto né introdurre account o server. Le altre due opzioni "locali" (C, E) costano di più o coprono meno.
2. Il 70% del ponte esiste già e funziona **[V]**: cartella scelta, handle persistito, scrittura a ogni cambio, rilettura al focus. Il lavoro è rendere robusto quel meccanismo (schema versionato, merge per record, osservazione del file), e questo lavoro ripaga anche senza MCP perché la sync attuale è fragile in presenza di più writer.
3. La conferma nell'app è la sola che regge per dati fiscali: numerazione, XML e validazione restano in un unico posto.
4. Non chiude la porta al web: un utente tecnico può esporre lo stesso server via tunnel, e se un domani si decidesse un backend opzionale (D), il formato versionato con merge sarebbe lo stesso.

Cosa **non** fare adesso: un relay o backend ospitato da Pivella (B, D). Non perché tecnicamente difficile, ma perché cambia il prodotto e va deciso come tale, con la riscrittura della promessa.

### Passi suggeriti se si procede (ordine)

1. Formato file v2: `schemaVersion`, `updatedAt` per file e per record, sezione `proposals`. Retrocompatibile in lettura con il file v1.
2. `importAll` in modalità merge quando la sorgente è la sync; tombstone per le cancellazioni; test con due tab sulla stessa cartella.
3. Osservazione del file oltre al focus (polling di `lastModified` come minimo).
4. UI "proposte da confermare" in Impostazioni o Dashboard, con applicazione tramite i percorsi esistenti (`addWorkLog`, flusso Nuova fattura).
5. Server MCP stdio in un package separato del monorepo, tool di sola lettura prima, poi `propose_work_log` e `propose_fattura`.
6. Testo in UI e guida: cosa viene inviato al provider AI e quando.

## 10. Cose che non ho verificato e andrebbero controllate prima di implementare

- Il comportamento reale di `FileSystemObserver` nelle versioni correnti di Chrome ed Edge **[I]**.
- Se i content script di una estensione vedono davvero IndexedDB dell'origine della pagina in Chrome e Firefox (rilevante solo per C) **[I]**.
- Quali client MCP supportano la elicitation oggi (rilevante per §5.3) **[I]**.


---

# 11. Web MCP: analisi con vincolo di server remoto

Vincolo fisso: un server MCP pubblico, HTTPS, trasporto Streamable HTTP (o SSE legacy), aggiungibile da claude.ai e ChatGPT con un URL. Niente processo locale da installare.

Cosa cambia rispetto alla prima iterazione: il server non può contare né sul disco dell'utente né sul browser aperto. Deve avere una **propria copia dei dati** o un **canale verso qualcosa che ce l'ha**. Tutto il resto (auth, scritture, promessa, costi) discende da questa scelta.

Requisiti dei client, per capire cosa deve offrire il server **[I]**:

- claude.ai "connettori personalizzati": URL Streamable HTTP o SSE; autenticazione OAuth 2.1 con discovery del Protected Resource Metadata (RFC 9728) e Dynamic Client Registration (RFC 7591), PKCE obbligatorio; in alternativa nessuna auth. Non ho verificato se accetti un bearer statico dalla UI.
- ChatGPT: i connettori MCP per ricerca richiedono i tool `search` e `fetch`; i tool generici passano dalla "developer mode" o dalle Apps; OAuth o nessuna auth.
- In entrambi i casi "nessuna auth" non è un'opzione per dati fiscali: chiunque conosca l'URL leggerebbe tutto.

## 11.1 Dove vivono i dati

Oggi vivono solo in IndexedDB del browser e, se attiva, in `pivella-sync.json` sul disco **[V]**. Tre modi reali per farli arrivare a un server remoto.

### S1. Sync opzionale verso il server Pivella

L'app, quando l'utente attiva la funzione, invia al server la stessa struttura che oggi scrive nel file (`exportForUser`, un profilo alla volta) a ogni cambiamento con debounce, e riceve dal server le modifiche fatte dall'AI. Il server conserva una copia per account.

- Disponibilità: il server risponde sempre, anche ad app chiusa.
- Freschezza: al più il debounce (500 ms oggi **[V]**), quando l'app è aperta e online.
- Chi vede i dati in chiaro: server Pivella, hosting, provider AI.
- Scritture: il server è una copia canonica, può committare da solo dopo conferma; l'app riceve e fa merge.
- Browser: tutti, non dipende dalla File System Access API.
- Costo app: client di sync bidirezionale, merge per record, gestione conflitti, UI di attivazione e revoca.

### S2. Browser come origine, esposto via tunnel

Due varianti, molto diverse.

**S2a, relay ospitato da Pivella.** La tab dell'app apre un WebSocket verso un relay; il server MCP inoltra ogni chiamata alla tab, che legge IndexedDB e risponde **[I]**.

- Disponibilità: **solo con la tab aperta e online**. Ad app chiusa il server risponde "non disponibile". Questo da solo fallisce il punto 3 (scritture ad app chiusa).
- Chi vede i dati: i dati transitano sul relay Pivella. Si può cifrare end-to-end tra tab e client AI? No: il client AI è claude.ai, non controlliamo il suo lato, quindi il relay vede il chiaro.
- Scritture: la tab scrive in IndexedDB con le regole dell'app, quindi numerazione e XML restano nel browser. Buono, ma solo a tab aperta.
- Infra: relay sempre acceso, connessioni persistenti, riconnessione, pairing dispositivo.

**S2b, tunnel gestito dall'utente.** L'utente installa qualcosa sul proprio computer (un bridge locale o un tunnel tipo Cloudflare/Tailscale Funnel) che espone l'MCP locale della sezione 3.A con un URL pubblico **[I]**.

- Rispetta la promessa, ma **viola il vincolo** "aggiungibile con un URL senza installare nulla": richiede un processo locale, una macchina accesa e competenze. Lo cito per completezza, non è una soluzione di prodotto.

### S3. Cartella di sync su storage raggiungibile dal server

L'app continua a scrivere `pivella-sync.json` con la sync esistente **[V]**, ma la cartella è dentro Dropbox, Google Drive o OneDrive. L'utente autorizza il server Pivella (OAuth verso il provider di storage) a leggere e scrivere quel file **[I]**. Variante: l'app scrive direttamente via API cloud senza File System Access, funzionerebbe su tutti i browser.

- Disponibilità: il server legge il file quando vuole, anche ad app chiusa.
- Freschezza: dipende dal client desktop di Dropbox/Drive che carica il file; secondi o minuti, non controllabile.
- Chi vede i dati: provider di storage (già li vede oggi se la cartella è lì), server Pivella quando legge, provider AI.
- Scritture: il server modifica il file; l'app lo rilegge al focus con rimpiazzo totale **[V]**, quindi servono comunque il formato v2 e il merge della sezione 5.4. Con due writer asincroni su un file intero, i conflitti sono più probabili che in S1.
- Il file contiene **tutti i profili** **[V]**: il server ne vede tutti anche se l'account ne ha collegato uno.
- Costo: tre integrazioni OAuth diverse (Dropbox, Google, Microsoft), quota API, revoche, e non elimina il server: serve comunque per OAuth MCP, coda proposte, cache.

### Confronto

| | S1 sync al server | S2a relay + tab | S2b tunnel utente | S3 storage cloud |
|---|---|---|---|---|
| Rispetta il vincolo "solo URL" | sì | sì | **no** | sì |
| Funziona ad app chiusa | sì | **no** | dipende dal pc | sì (lettura), scritture differite |
| Freschezza | sub-secondo con app aperta | live | live | minuti |
| Chi vede il chiaro oltre al provider AI | Pivella + hosting | Pivella (transito) | nessuno | storage cloud + Pivella |
| Scritture con regole dell'app | da portare sul server | nel browser | nel browser | da portare sul server |
| Browser | tutti | tutti | Chromium | Chromium (o tutti con API cloud) |
| Infra Pivella | server + db | relay | nessuna | server + 3 integrazioni |
| Promessa attuale | violata | violata | rispettata | violata |

Con il vincolo fisso, S2b è fuori, S2a fallisce le scritture ad app chiusa, S3 aggiunge complessità senza togliere il server. **Resta S1.**

## 11.2 Autenticazione e multiutente

Stato verificato: nessuna autenticazione, profili senza credenziali, utente corrente in localStorage **[V]**. Un server remoto ha bisogno di due legami: **chi è il chiamante** (il client AI per conto di una persona) e **a quali dati ha diritto**.

### Opzioni per l'identità

| | OAuth 2.1 completo | Token/API key statico | Chiave o pairing code |
|---|---|---|---|
| Come lo aggiunge l'utente in claude.ai/ChatGPT | URL, poi login nel browser al primo uso **[I]** | URL più header, non offerto da tutte le UI **[I]** | come token, dopo scambio |
| Serve un account Pivella | sì | sì (per emettere la chiave) | sì |
| Revoca | per client, dalla UI | rigenerare la chiave | idem |
| Scope read/write separati | sì, nativi | possibile con chiavi diverse | possibile |
| Cosa serve lato server | Authorization Server (o IdP gestito), PRM, DCR, PKCE | endpoint di verifica | idem |
| Rischio | complessità | chiave copiata nella chat o nei log del client | idem |

Conclusione: per i client web indicati, **OAuth 2.1 è di fatto obbligatorio** **[I]**: è ciò che claude.ai e ChatGPT sanno fare "solo con un URL". Un token statico resta utile per Claude Code o per l'API, non per la UI.

### Come nasce l'account

Oggi "niente registrazioni" **[V]**. Con un server, un account serve, ma può essere minimo:

- Email con magic link o passkey, nessuna password. L'account è un id opaco più un metodo di login.
- Creato **solo** quando l'utente attiva l'assistente in Impostazioni. Chi non lo attiva non ha account, e l'app resta identica a oggi.
- Il browser viene collegato all'account con la stessa sessione (cookie) usata per la sync S1.

Implementazione: un IdP gestito (Auth0, Clerk, Supabase Auth, Keycloak self-hosted) fa da Authorization Server per l'MCP e da login per l'app; il server MCP valida i JWT e verifica `aud` e `scope` **[I]**. Scrivere un Authorization Server a mano non è consigliato.

### Legame utente, profili, dati

- Tenant = account. Ogni record sul server porta `accountId` oltre a `userId` (il profilo). I profili esistenti diventano sotto-profili dell'account.
- Ogni query del server filtra per `accountId` preso dal token, mai da un parametro. Oggi il filtro per `userId` è fatto in JavaScript dopo un `getAll` **[V]**: sul server serve invece un vincolo a livello di database (colonna `account_id` in ogni tabella più row level security, se Postgres).
- I tool prendono `userId` (profilo) come parametro, validato contro l'elenco profili dell'account; `list_users` resta il primo passo, come nella sezione 6.
- Scope: `pivella:read`, `pivella:propose` (crea proposte), mai uno scope che committi senza conferma.
- Revoca in Impostazioni: lista client autorizzati, data ultimo accesso, pulsante "revoca", pulsante "cancella tutti i dati dal server" che chiude anche l'account.

## 11.3 Scritture con conferma esplicita, client remoto, app anche chiusa

Il modello dei tool MCP non ha una primitiva di conferma affidabile: la elicitation esiste ma non è garantita dai client web **[I]**, e il permesso "esegui questo tool?" del client è disattivabile. La conferma deve stare **fuori dal giro AI**, in un canale che Pivella controlla.

### Flusso proposto

1. Il tool `propose_fattura` o `propose_work_log` crea una **proposta** sul server con stato `pending`, con `accountId`, `userId`, payload validato e una scadenza (per esempio 7 giorni). Ritorna al modello un id e un riepilogo leggibile, mai un esito "creato".
2. Il server notifica l'utente con un canale scelto in Impostazioni: email o Telegram, con un link firmato a **una pagina di conferma ospitata da Pivella** che mostra l'anteprima e i pulsanti conferma/rifiuta. La pagina richiede la sessione dell'account (non basta il link).
3. Alla conferma il server **committa** nella copia canonica S1: assegna il numero fattura, genera l'XML, salva il record con `updatedAt`. Alla prossima apertura l'app scarica i cambiamenti e li fonde in IndexedDB; l'XML resta scaricabile dalla pagina Fatture.
4. Il modello può chiedere `get_proposal(id)` per sapere l'esito.

Se l'app è aperta, la stessa proposta appare anche lì con un badge, e la conferma dentro l'app è equivalente. Se è chiusa, il canale email/Telegram copre il caso.

### Cosa va spostato sul server (verificato che sia possibile)

- Numerazione: oggi `max(numero) + 1` in memoria nel modale **[V]**. Sul server diventa una transazione sull'account, che risolve anche la race tra app e AI. L'app deve chiedere il prossimo numero al server quando è online, o accettare un possibile conflitto da risolvere al merge (rinumerazione con avviso).
- XML FatturaPA: `generateFatturaXML` è pura, solo `downloadXML` usa il DOM **[V]** `src/lib/xml/generator.ts`, quindi è portabile in Node senza modifiche.
- Validazioni del modale (emittente configurato, cliente, righe con prezzo, cambio per valuta estera) **[V]** `NuovaFatturaModal.tsx` righe 182-245: vanno duplicate o estratte in un modulo condiviso.
- Le scadenze non vanno toccate: si generano solo dalla pagina Scadenze **[V]**.

### Regole dure

- Nessun tool con effetti collaterali senza proposta e conferma. Nemmeno `mark_incassata`: una proposta anche per quello.
- Le proposte scadono e non si accumulano oltre un limite per account.
- Il contenuto dei dati (note, nomi cliente) è testo non fidato: il server non lo interpreta e il tool result lo marca come dato. Un prompt injection può al massimo far creare una proposta che l'utente vedrà e rifiuterà.
- Merge nell'app: prerequisito identico alla sezione 5.4, formato con `schemaVersion` e `updatedAt` per record, tombstone. Senza questo, la copia locale e quella server si sovrascrivono a vicenda.

## 11.4 La promessa "All data stays local"

Verdetto: **un web MCP è incompatibile con la promessa così com'è scritta**. Tutte le opzioni compatibili col vincolo (S1, S2a, S3) mettono i dati, anche solo in transito, su un server che non è il computer dell'utente, e S1 e S3 ne tengono una copia. In più serve un account, e la guida oggi dice "niente registrazioni" **[V]**.

Non è una questione tecnica aggirabile con la cifratura: per servire i tool il server deve leggere il chiaro. La cifratura at rest riduce il rischio di esfiltrazione dallo storage, non cambia chi può leggere.

### Modello opt-in proposto

- Default invariato: nessun account, nessuna rete, i dati stanno nel browser e, se attivata, nella cartella locale. Il footer resta vero per chi non attiva nulla.
- Attivazione esplicita in Impostazioni, sezione "Assistente AI (beta)", con un testo che dice cosa succede prima del pulsante: quali dati vengono copiati sul server, dove sta il server, chi li vede, come si revoca, come si cancellano.
- Scelta del profilo da collegare: uno alla volta, non tutti.
- Revoca e cancellazione totale dal server con un pulsante, con conferma del server via email.
- Indicatore visibile nell'header quando la sync è attiva, così l'utente sa in ogni momento in che modalità è.

### Riscrittura onesta dei testi (proposte, senza em-dash)

Footer, oggi `🔒 All data stays local` **[V]** `Footer.tsx`:

> 🔒 I dati restano sul tuo computer. Il cloud solo se lo attivi tu.

Guida, oggi "Niente registrazioni, niente cloud: i dati restano sul tuo computer" **[V]** `Guida.tsx` riga 112:

> Niente registrazioni obbligatorie e niente cloud: i dati restano sul tuo computer. Se vuoi usare l'assistente AI, puoi attivare una copia dei dati sui nostri server e spegnerla quando vuoi.

Guida, riga 70, resta valida ("esporta il backup ogni tanto").

Meta description e Open Graph, oggi "I dati restano sul tuo computer" **[V]** `index.html`:

> I dati restano sul tuo computer, con sincronizzazione cloud opzionale.

Sezione Impostazioni, testo di attivazione:

> Attivando l'assistente AI, i dati del profilo selezionato (clienti, fatture, giornate, scadenze, configurazione) vengono copiati sui server di Pivella in Europa e resi leggibili all'assistente che colleghi. Le fatture e le giornate proposte dall'assistente vengono create solo dopo la tua conferma. Puoi scollegare l'assistente o cancellare tutti i dati dal server in qualsiasi momento da questa pagina.

Serve inoltre una privacy policy vera (oggi non ce n'è bisogno perché non c'è trattamento lato server): titolare, finalità, sub-responsabili (hosting, IdP, provider email), conservazione, diritti.

## 11.5 Costi, hosting e superficie di rischio

### Componenti

| Componente | Scelta minima | Note |
|---|---|---|
| Server MCP | Node/TypeScript, SDK MCP ufficiale, Streamable HTTP | Riusa `src/types`, `generator.ts`, calcoli **[V]** |
| Authorization Server | IdP gestito con supporto DCR, o Keycloak | Non scriverlo a mano |
| Database | Postgres con row level security per account | Cifratura at rest del provider |
| Coda proposte e notifiche | tabella nel db + provider email/Telegram bot | |
| Pagina di conferma | route del server, sessione account | |
| Sync client nell'app | fetch con retry, merge per record | Cambiamento più grande lato app |
| Osservabilità | log senza PII, metriche, alert | |
| Backup | giornalieri, cifrati, EU, con test di ripristino | |

### Ordine di grandezza dei costi **[I]**

- Hosting: un piccolo servizio gestito (Fly, Railway, Hetzner) 5-20 euro al mese; Postgres gestito 0-25; IdP free tier fino a qualche migliaio di utenti; email transazionale free tier; dominio. Totale prevedibile sotto i 50 euro al mese per i primi utenti, molto meno di quanto costa il tempo.
- Tempo: il grosso non è il server MCP (piccolo) ma sync bidirezionale con merge, OAuth, pagina di conferma, revoche, privacy policy, monitoraggio. Settimane, non giorni, per una versione seria.
- Costo ricorrente non monetario: reperibilità. Un servizio con dati fiscali giù per un giorno è un problema, il sito statico oggi no.

### Superficie di rischio (dati fiscali: P.IVA, codice fiscale, IBAN, fatturato, clienti con P.IVA **[V]** `types/index.ts`)

| Rischio | Perché è concreto qui | Mitigazione |
|---|---|---|
| Isolamento tenant | Oggi il filtro utente è in JS dopo `getAll` **[V]**; un errore analogo sul server espone dati di altri | `account_id` da token, RLS, test negativi automatici |
| Furto token OAuth | Il token dà accesso a tutto il profilo | Token brevi, refresh rotanti, scope read separato, revoca visibile, `aud` verificato |
| Prompt injection via dati | Nomi cliente e note sono testo libero | Nessuna scrittura senza conferma umana fuori dal giro AI |
| Logo base64 in `config` **[V]** | Pesante, e inutile all'AI | Non sincronizzarlo, o escluderlo dai tool |
| Log e backup con PII | Facile lasciare payload nei log | Log strutturati senza payload, retention corta, backup cifrati |
| Conflitti di merge | Due copie, una offline | `updatedAt` per record, tombstone, UI dei conflitti almeno per fatture |
| Numerazione doppia | Race app/AI **[V]** logica in memoria | Numerazione lato server, avviso al merge |
| GDPR | Pivella diventa titolare del trattamento | Privacy policy, DPA con hosting e IdP, dati in EU, procedura breach 72h, cancellazione effettiva |
| Provider AI | Vede i dati chiesti in chat, sempre | Dichiararlo nel testo di attivazione; è la ragione stessa della funzione |
| Dipendenza da un servizio | Se il server sparisce, l'assistente sparisce | I dati locali restano sempre completi; il server è una copia |

## 11.6 Raccomandazione finale sul web MCP

**Se il vincolo del server remoto resta fisso, la strada percorribile è S1: sync opzionale verso un server Pivella, account con OAuth 2.1 tramite IdP gestito, scritture solo come proposte confermate su un canale controllato da Pivella (pagina di conferma via email o Telegram, o app), e riscrittura della promessa in forma opt-in.** S2a non regge le scritture ad app chiusa, S3 aggiunge integrazioni senza togliere il server, S2b viola il vincolo.

Va detto con chiarezza cosa comporta: Pivella passa da sito statico senza trattamento dati a **servizio con account, database, obblighi GDPR e reperibilità**. È una decisione di prodotto prima che tecnica. Se la risposta a "vogliamo diventare un servizio con account" è no, allora la risposta onesta al web MCP è che **non si può fare** rispettando il vincolo "solo URL": l'unica alternativa senza server Pivella è il tunnel gestito dall'utente, che non è un prodotto.

Se la risposta è sì, ordine di lavoro suggerito:

1. Formato dati v2 con `schemaVersion`, `updatedAt` per record, tombstone, e merge nell'app. Serve a S1 e ripara la fragilità della sync su file già oggi **[V]**.
2. Account minimo (magic link o passkey) tramite IdP gestito, attivabile solo da Impostazioni; privacy policy; hosting EU.
3. Sync S1 di un singolo profilo, sola lettura lato server, con indicatore in UI e cancellazione totale.
4. Server MCP Streamable HTTP con OAuth 2.1, PRM e DCR, solo tool di lettura; test con claude.ai e ChatGPT.
5. Proposte con conferma fuori dal giro AI; numerazione e XML sul server, riusando `generateFatturaXML` **[V]**.
6. Riscrittura dei testi (11.4), poi beta chiusa.

Rimane valido tutto ciò che nelle sezioni 1-6 è marcato **[V]**: sono i fatti su cui questa analisi poggia. Le voci **[I]** più pesanti da verificare prima di iniziare: i requisiti esatti di auth di claude.ai e ChatGPT per i connettori personalizzati, e la disponibilità del supporto DCR nell'IdP scelto.


---

# 12. Piano concreto per il MCP locale

Riferimenti: i fatti verificati sono nelle sezioni 1 e 5.4; l'architettura è la "A" della sezione 3. Qui solo il piano.

## 12.1 Quali client lo possono usare davvero

Un MCP locale è un processo avviato dal client via stdio sulla stessa macchina dove sta la cartella di sync **[I]**.

| Client | Funziona | Come |
|---|---|---|
| Claude Desktop (macOS, Windows) | sì | voce in `claude_desktop_config.json` con `command` e `args` **[I]** |
| Claude Code | sì | `claude mcp add` o `.mcp.json` nel progetto **[I]** |
| Cursor, VS Code Copilot, Windsurf, Zed | sì | config JSON analoga **[I]** |
| Codex CLI, Gemini CLI | sì | supportano MCP stdio **[I]** |
| ChatGPT desktop | incerto | il supporto MCP in "developer mode" è arrivato prima per i server remoti; da verificare per stdio **[I]** |
| Agenti self-hosted (per esempio OpenClaw, che da quanto emerge dai messaggi gira sulla macchina di Davide e inoltra da Telegram) | sì | l'agente locale carica il server come qualsiasi client **[I]**, ed è già un ponte dal telefono |

Cosa **non** si può fare:

- **claude.ai nel browser**: accetta solo connettori remoti con URL **[I]**. Nessun modo di caricare uno stdio.
- **App Claude su iPhone e Android**: nessun supporto a server locali **[I]**.
- **ChatGPT web e mobile**: come sopra.
- Qualsiasi macchina diversa da quella con la cartella. Se la cartella è in Dropbox o iCloud, il server può girare su un'altra macchina che la vede, ma si aggiunge un terzo writer asincrono con tutti i problemi di conflitto **[I]**.
- Se il computer è spento, non esiste nulla.

Verdetto senza giri: **il limite è fatale se l'uso atteso è "apro Claude sul telefono e segno la giornata"**. È **accettabile** se l'uso reale è al computer, dove peraltro sta già l'app (la sync è solo Chromium desktop **[V]**), oppure passa da un agente locale sempre acceso come OpenClaw, che dal telefono via Telegram arriva alla macchina. Per un freelance che lavora al Mac tutto il giorno il caso d'uso principale (chiedere riepiloghi, far preparare fatture, segnare giornate a fine giornata) è coperto. Il caso "in treno dal telefono" no, e non lo sarà mai con questa architettura.

## 12.2 Piano di implementazione sul file di sync

### Formato v2 del file

Oggi il file è `Record<StoreName, any[]>` senza metadati **[V]**. Il v2 aggiunge una busta, resta leggibile dall'app v1 in modo degradato (le chiavi degli store sono le stesse):

```json
{
  "schemaVersion": 2,
  "updatedAt": "2026-09-12T14:03:22.114Z",
  "writer": { "id": "app-8f2c", "kind": "app" },
  "users": [], "config": [], "clienti": [], "fatture": [], "workLogs": [], "scadenze": [],
  "tombstones": [ { "store": "workLogs", "id": "1757...", "deletedAt": "2026-09-12T13:50:00Z" } ],
  "proposals": []
}
```

Regole:

- Ogni record di ogni store ha `updatedAt` (ISO). Campo opzionale nei tipi TypeScript per non rompere i dati esistenti; un record senza `updatedAt` vale come epoca zero e perde sempre contro uno che ce l'ha.
- Le cancellazioni producono un tombstone; i tombstone più vecchi di 90 giorni vengono potati alla scrittura.
- Un file senza `schemaVersion` è v1: l'app lo legge una volta con il rimpiazzo attuale **[V]** `importAll`, poi riscrive in v2.

### Merge al posto del rimpiazzo

Funzione pura `mergeSnapshots(local, remote)` in un modulo nuovo, senza dipendenze dal DOM, testata con `node:test` (il runner `tsx --test` esiste già **[V]** `package.json`, esempio in `forfettario.test.ts`):

- Per store, per id: assente in locale → inserisci; `remote.updatedAt > local.updatedAt` → sostituisci; altrimenti tieni il locale.
- Tombstone con `deletedAt > updatedAt` del record → cancella. Un record ricreato dopo il tombstone vince perché più recente.
- Output: nuovo snapshot più la lista delle differenze applicate, così l'app aggiorna lo stato React senza ricaricare tutto.

Ciclo di scrittura dell'app: **leggi, fai merge, scrivi** invece di scrivere e basta. Prima di scrivere confronta `lastModified` del file con quello dell'ultima lettura; se è cambiato, rileggi e fondi. Il server MCP fa lo stesso ciclo e in più tiene un lock advisory `pivella-sync.lock` con pid e timestamp, ignorato se più vecchio di 10 secondi **[I]**. Il debounce di 500 ms resta.

### Spazio id separato

Record creati dal server MCP: `mcp_` più UUID. L'app resta a `Date.now()` **[V]** per non toccare tutti i punti di creazione (almeno sei in `ForfettarioApp.tsx` e `Calendario.tsx` **[V]**). Migrare l'app a `crypto.randomUUID()` è una miglioria separata.

### Osservazione del file oltre al focus

- Polling di `getFile().lastModified` sull'handle ogni 3 secondi mentre `document.visibilityState === 'visible'`, fermo in background **[I]** costo trascurabile.
- `FileSystemObserver` dove disponibile, con fallback al polling **[I]** disponibilità non verificata.
- Il focus resta come oggi.

### Persistenza del permesso

Oggi `verifyPermission` chiama `requestPermission` all'avvio **[V]**; senza gesto utente Chrome può rifiutare **[I]**. Va gestito il caso "permesso da rinnovare" con un banner e un pulsante, altrimenti l'utente non capisce perché le proposte non arrivano.

## 12.3 Tool MCP da esporre

Tutti prendono `userId` esplicito, tranne `list_users`. Nessuno restituisce mai `logoBase64` **[V]** campo pesante in `config`.

**Lettura**

| Tool | Scopo |
|---|---|
| `list_users` | Profili nel file. Primo passo obbligatorio. |
| `get_config` | Dati fiscali del profilo: ATECO, coefficiente, aliquota, gestione previdenziale, emittente, IBAN, valute. |
| `list_clienti` | Anagrafica con tariffa e unità di fatturazione. |
| `list_fatture` | Filtri `anno`, `incassata`, `clienteId`. |
| `get_fattura` | Una fattura per id. |
| `list_work_logs` | Intervallo `da`/`a`, filtro cliente. Include i clienti speciali `__vacation__` e `__misc__` **[V]** con etichetta leggibile. |
| `list_scadenze` | Per anno di versamento, con stato pagato. |
| `get_riepilogo_anno` | Fatturato, incassato, stima imposte e contributi, distanza dalla soglia. Riusa `forfettario.ts` e `calculations.ts` **[V]** puri. |
| `get_giornate_per_cliente` | Totale giornate e ore per cliente in un periodo. Solo quantità, nessun importo: gli importi vengono dalle fatture (13.7). |
| `list_proposals` | Proposte con stato `pending`, `applied`, `rejected`, `expired`. |
| `get_proposal` | Esito di una proposta. |

**Proposte di scrittura** (creano una voce in `proposals`, mai un record)

| Tool | Scopo |
|---|---|
| `propose_work_log` | Cliente, data, tipo, quantità, note. |
| `propose_fattura` | Cliente (esistente o nuovo), data, righe, valuta. Il numero **non** è un parametro: lo assegna l'app alla conferma. |
| `propose_cliente` | Nuovo cliente con dati per FatturaPA. |
| `propose_incasso` | Segna una fattura incassata con data. |
| `propose_scadenza_pagata` | Segna una scadenza pagata con data. |
| `withdraw_proposal` | Ritira una proposta ancora `pending`. |

Ogni tool di proposta valida il payload con le stesse regole del modale (cliente esistente, righe con prezzo, cambio per valuta estera **[V]** `NuovaFatturaModal.tsx` righe 182-245) e risponde con "in attesa di conferma nell'app", mai con "creato".

## 12.4 Conferma delle scritture nel caso locale

- Le proposte vivono nel file. L'app le legge con lo stesso ciclo di merge (avvio, focus, polling).
- Nell'header un badge "N proposte"; un modale nuovo elenca le proposte con anteprima; per ognuna conferma o rifiuta. Alla conferma l'app esegue i percorsi esistenti: `addWorkLog`, `addCliente`, `addFattura` con numero calcolato come oggi, `updateFattura` per l'incasso, `updateScadenza` per il pagamento. Per le fatture l'app genera anche l'XML con `generateFatturaXML` e lo scarica **[V]**, come dal modale.
- La proposta passa a `applied` con `resultId`, oppure a `rejected` con motivo. Il server MCP lo legge da `get_proposal`.
- Scadenza: 14 giorni, poi `expired`.

**L'app deve essere aperta perché una proposta diventi un record.** Non serve che sia aperta quando la proposta viene creata: resta nel file e viene mostrata alla prossima apertura. Se l'utente vuole che la registrazione di una giornata sia immediata, l'unica scorciatoia onesta è un'impostazione futura "applica automaticamente le proposte di giornate" (mai le fatture), che sposterebbe la conferma sul dialogo di permesso del client AI, che è disattivabile **[I]**. Sconsigliata nella prima versione.

## 12.5 Cosa cambia nel repo ed effort

| Area | File | Cosa | Giorni |
|---|---|---|---|
| Modulo condiviso | nuovo `src/lib/sync/schema.ts`, `merge.ts`, `merge.test.ts`, `proposals.ts`, `validate.ts` | formato v2, merge puro, tipi proposta, validazioni estratte dal modale | 3 |
| Tipi | `src/types/index.ts` | `updatedAt?` su ogni entità, tipi `Tombstone`, `Proposal` | 0,5 |
| DB | `src/lib/db/IndexedDBManager.ts`, `src/lib/constants/fiscali.ts` | `DB_VERSION` 3→4 con store `tombstones` e `meta`; `mergeAll` accanto a `importAll`; `updatedAt` impostato in `put`, tombstone in `delete` | 1,5 |
| Sync file | `src/lib/utils/fileSystemSync.ts`, `src/hooks/useFolderSync.ts` | lettura v1/v2, `lastModified`, polling e observer, ciclo leggi-fondi-scrivi, banner permesso | 2 |
| Stato app | `src/context/AppContext.tsx` | `handleDataLoaded` passa a merge e aggiorna lo stato per differenze; esposizione delle proposte | 1,5 |
| UI proposte | nuovo `src/components/modals/ProposalsModal.tsx`, ritocchi a `Header.tsx`, `ForfettarioApp.tsx`, `Impostazioni.tsx` | badge, modale, applicazione tramite hook esistenti, XML per fatture | 2,5 |
| Server MCP | nuovo `mcp/` con `package.json`, `tsconfig.json`, `src/server.ts`, `src/tools/*.ts`, `src/fileSource.ts` | SDK MCP ufficiale, stdio, lettura e proposte, lock, importa `../src/lib/*` (senza DOM **[V]**, salvo `downloadXML`) | 3 |
| Distribuzione e docs | `README.md`, `docs/`, script npm | `npx pivella-mcp --folder <cartella>`, snippet config per Claude Desktop e Claude Code | 0,5 |
| QA | | due tab, app più server in scrittura concorrente, file v1 legacy, permesso revocato | 1,5 |

**Totale stimato: 14-16 giornate** per una persona, senza contare la pubblicazione su npm e i cicli di feedback. Il grosso è il merge e la UI delle proposte, non il server MCP. Il tsconfig radice include solo `src` **[V]**, quindi `mcp/` ha il suo.

## 12.6 Cosa si perde rispetto al web MCP

- Telefono e claude.ai nel browser: fuori, senza eccezioni, salvo un agente locale come OpenClaw che faccia da ponte.
- Serve un computer acceso con Node installato e una riga di configurazione JSON nel client. Non è "aggiungi un URL": è un'installazione, e l'utente medio di Pivella non è detto che la faccia.
- Chromium desktop soltanto, perché dipende dalla sync su cartella **[V]**. Safari e Firefox restano senza.
- Nessuna notifica: se l'app è chiusa, la proposta aspetta.
- Freschezza a file, non live: al più 3 secondi di polling più il debounce, e solo con la tab visibile.
- Due writer su un file con lock advisory: più robusto di oggi, ma non è un database. Conflitti rari ma possibili, e la UI dei conflitti nella prima versione è "vince il più recente".
- Dipendenza dal permesso File System Access, che Chrome può chiedere di nuovo **[I]**.
- Niente multi-dispositivo, niente condivisione con un commercialista, niente "chiedi al bot" da un client web.

Il guadagno è altrettanto netto: zero server, zero account, zero GDPR lato Pivella, la promessa resta vera così com'è scritta **[V]** footer, guida, meta.

## 12.7 Via di mezzo onesta: locale ora, web dopo

Sì, esiste, a condizione di progettare subito quattro cose. Se si fanno, il passaggio al web MCP della sezione 11 riusa modulo condiviso, contratto dei tool e formato dati; si aggiungono solo trasporto, auth e storage.

1. **Contratto dei tool identico**: stessi nomi, parametri, schemi di risposta, `userId` esplicito, stati delle proposte. Nessun tool deve sapere se i dati vengono da un file o da un database.
2. **Interfaccia `DataSource`** dietro i tool: `FileDataSource` ora (legge il file, scrive proposte), `HttpDataSource` o `PostgresDataSource` dopo. I tool chiamano solo `readSnapshot(userId)`, `listProposals`, `addProposal`. È il punto che, se saltato, costringe a riscrivere i tool.
3. **Formato v2 come wire format futuro**: `schemaVersion`, `updatedAt` per record, tombstone, proposte. È esattamente ciò che un server dovrebbe ingerire e servire; il merge puro serve identico all'app in S1.
4. **Logica condivisa senza DOM** in `src/lib/sync` e `src/lib/xml` (già vero per calcoli e `generateFatturaXML` **[V]**): numerazione, validazione, riepiloghi. Sul server web gireranno tali e quali.

Più due dettagli piccoli ma decisivi: usare l'SDK MCP ufficiale, che espone lo stesso oggetto server su stdio e Streamable HTTP **[I]**, e passare ai tool un `principal` (nel caso locale è implicito e unico) così che aggiungere OAuth non tocchi i tool. Cosa **non** fare adesso: cablare il percorso della cartella nella logica dei tool, mettere la File System Access API nel modulo condiviso, far fidare l'app delle proposte senza rivalidarle all'applicazione.

Cosa **non** si riusa passando al web, e va messo in conto: il ciclo leggi-fondi-scrivi sul file e il lock (specifici del locale), la UI del permesso cartella, e l'assenza di auth. Circa 3 delle 14-16 giornate sono lavoro solo locale; il resto regge in entrambi gli scenari.


---

# 13. Specifica congelata

Vale come contratto per l'implementazione. Dove una scelta è stata fatta è scritta al presente indicativo e non è in discussione; ciò che resta aperto è solo nella sezione 13.6. Marcatori: **[V]** verificato nel codice attuale, **[I]** assunzione su piattaforma o librerie.

Convenzioni comuni a tutto il documento:

- Date di dominio: stringa `YYYY-MM-DD`, come nei tipi attuali **[V]**.
- Timestamp: ISO 8601 UTC con millisecondi, `2026-09-12T14:03:22.114Z`.
- Importi: numero in EUR con al più due decimali; `importoValuta` nella valuta originale quando presente **[V]** `Fattura`.
- Id: stringhe opache. Quelli creati dal server MCP hanno prefisso `mcp_`, le proposte `prop_`, seguiti da UUID v4. L'app continua con `Date.now()` **[V]**.
- `userId` è sempre esplicito nei tool tranne `list_users`. Nessun tool riceve percorsi, cartelle o nomi di file.

## 13.1 Contratto dei tool

### Regole generali

- Ogni tool restituisce un contenuto strutturato JSON (`structuredContent` con `outputSchema` dichiarato **[I]** SDK MCP) più un riassunto testuale di una riga. Il modello ragiona sul JSON, l'utente legge il testo.
- Errori: risposta con `isError: true` e corpo `{ "code": string, "message": string, "details"?: object }`. Nessuna eccezione non catturata esce dal server.
- Codici errore, gli stessi per locale e web:

| Codice | Quando |
|---|---|
| `USER_NOT_FOUND` | `userId` non presente tra i profili visibili al principal |
| `NOT_FOUND` | fattura, scadenza, cliente o proposta inesistente per quel profilo |
| `VALIDATION` | parametri non validi; `details.fields` elenca campo e motivo |
| `PROPOSAL_NOT_PENDING` | ritiro di una proposta già in stato terminale |
| `SOURCE_UNAVAILABLE` | file di sync assente, cartella non leggibile, o server dati irraggiungibile |
| `SOURCE_LOCKED` | lock di scrittura non ottenuto entro il timeout |
| `BACKUP_FAILED` | backup non riuscito: la scrittura non è stata eseguita |
| `PERMISSION_DENIED` | il principal non ha lo scope richiesto (solo web, riservato) |
| `INTERNAL` | tutto il resto, con `details.ref` per i log |

- Liste: parametri opzionali `limit` (default 500, massimo 2000) e `offset` (default 0); risposta con `total` e `hasMore`. Nel locale è ridondante, nel web no, e il contratto non cambia.
- Gli oggetti restituiti sono i tipi di `src/types/index.ts` **[V]** con queste eccezioni fisse: `Config` esce senza `courtesyInvoice.logoBase64` e `logoMimeType`; ogni `Fattura` e `WorkLog` esce con in più `clienteNome` risolto; i clienti speciali `__vacation__` e `__misc__` **[V]** escono con `nome` rispettivamente `Ferie` e `Varie` e `speciale: true`.
- Nessun tool di proposta restituisce mai un record creato. Restituisce la proposta con `status: "pending"` e il campo `messaggio` fisso: `In attesa di conferma nell'app Pivella.`

### Tool di lettura

**1. `list_users`**
Parametri: nessuno.
Ritorna: `{ users: Array<{ id, nome, color?, createdAt }> }`.
Errori: `SOURCE_UNAVAILABLE`.

**2. `get_config`**
Parametri: `userId: string`.
Ritorna: `{ config: Config senza logo, emittenteConfigurato: boolean, valute: ValutaConfig[] }`. `emittenteConfigurato` è vero se `config.emittente.codiceFiscale` e `config.partitaIva` sono valorizzati, che è la stessa condizione del modale **[V]** `NuovaFatturaModal.tsx` riga 184.
Errori: `USER_NOT_FOUND`.

**3. `list_clienti`**
Parametri: `userId`, `includeSpeciali?: boolean` (default false), `limit?`, `offset?`.
Ritorna: `{ clienti: Cliente[], total, hasMore }`.

**4. `list_fatture`**
Parametri: `userId`, `anno?: number`, `incassata?: boolean`, `clienteId?: string`, `da?: date`, `a?: date`, `limit?`, `offset?`.
Ritorna: `{ fatture: Array<Fattura & { clienteNome }>, total, hasMore, totali: { importo: number, incassato: number } }`. I totali sono sull'intero filtro, non sulla pagina. `anno` filtra su `data`; `da`/`a` sono inclusivi.

**5. `get_fattura`**
Parametri: `userId`, `fatturaId`.
Ritorna: `{ fattura: Fattura & { clienteNome } }`.
Errori: `NOT_FOUND`.

**6. `list_work_logs`**
Parametri: `userId`, `da: date`, `a: date`, `clienteId?`, `limit?`, `offset?`.
Ritorna: `{ workLogs: Array<WorkLog & { clienteNome }>, total, hasMore, totaliPerCliente: Array<{ clienteId, clienteNome, giornate: number, ore: number }> }`. `quantita` di tipo `giornata` somma in `giornate`, di tipo `ore` in `ore`; il campo legacy `ore` stringa **[V]** viene convertito a numero quando `quantita` manca.
Errori: `VALIDATION` se `a < da` o intervallo superiore a 400 giorni.

**7. `list_scadenze`**
Parametri: `userId`, `annoVersamento?: number`, `soloNonPagate?: boolean`, `limit?`, `offset?`.
Ritorna: `{ scadenze: Scadenza[], total, hasMore, totali: { daPagare: number, pagato: number } }`.

**8. `get_riepilogo_anno`**
Parametri: `userId`, `anno: number`.
Ritorna:
```
{
  anno, fatturato, incassato, numeroFatture,
  redditoImponibile, impostaSostitutiva, contributiPrevidenziali, totaleStimato,
  aliquotaApplicata, coefficienteRedditivita,
  soglia: { limite, percentuale, rimanente, stato },
  acconti: { irpef, inps },
  nota: string
}
```
Calcolato con `calcolaFiscale` e le funzioni di `forfettario.ts` **[V]** pure; `soglia.stato` viene da `getRegimeThresholdStatus` **[V]**. `nota` è fissa: `Stima indicativa basata sui dati inseriti, non sostituisce il commercialista.`

**9. `get_giornate_per_cliente`**
Parametri: `userId`, `da: date`, `a: date`, `clienteId?`.
Ritorna: `{ perCliente: Array<{ clienteId, clienteNome, giornate: number, ore: number, workLogIds: string[] }>, periodo: { da, a }, totale: { giornate: number, ore: number } }`.
Somma di `quantita` per cliente nel periodo, separata per `tipo` (`giornata` in `giornate`, `ore` in `ore`), con il legacy `ore` stringa normalizzato da `getWorkLogQuantita` **[V]** `calculations.ts`. Include i clienti speciali con `speciale: true`. Nessun importo, nessuna tariffa, nessun riferimento a fatture: il calendario traccia il lavoro, le fatture sono la fonte del fatturato, e questo tool non li mette insieme. Non replica il campo `amount` che la pagina Calendario calcola come tariffa per quantità **[V]** righe 95 e 186: quella è una scelta di UI dell'app, esclusa dal contratto per decisione di Davide (13.7).
Errori: `VALIDATION` se `a < da` o intervallo superiore a 400 giorni.

**10. `list_proposals`**
Parametri: `userId`, `status?: ProposalStatus`, `limit?`, `offset?`.
Ritorna: `{ proposals: Proposal[], total, hasMore }`.

**11. `get_proposal`**
Parametri: `proposalId`.
Ritorna: `{ proposal: Proposal }`.
Errori: `NOT_FOUND`.

### Tool di proposta

Tutti: errori `USER_NOT_FOUND`, `VALIDATION`, `SOURCE_UNAVAILABLE`, `SOURCE_LOCKED`, `BACKUP_FAILED`. Tutti accettano `motivazione?: string` (massimo 500 caratteri) che il modello usa per spiegare all'utente perché propone; finisce in `Proposal.motivazione` e viene mostrata nel modale di conferma. Tutti ritornano `{ proposal: Proposal, messaggio }`.

**12. `propose_work_log`**
Parametri: `userId`, `clienteId` (anche `__vacation__` o `__misc__`), `data: date`, `tipo: "ore" | "giornata"`, `quantita: number > 0`, `note?: string`.
Validazione: cliente esistente per il profilo; `quantita` massimo 24 se `ore`, massimo 1 se `giornata`; `data` non oltre 30 giorni nel futuro.

**13. `propose_fattura`**
Parametri: `userId`, `clienteId?: string` oppure `nuovoCliente?: { denominazione, partitaIva?, nazione?, indirizzo?, numeroCivico?, cap?, comune?, provincia? }` (esattamente uno dei due), `data: date`, `righe: Array<{ descrizione, quantita > 0, prezzoUnitario > 0 }>` (almeno una), `valuta?: string` (default EUR), `tassoCambio?: number`, `dataCambio?: date`, `dataIncasso?: date`.
Validazione: le stesse regole del modale **[V]** righe 182-245: emittente configurato, cliente valido, righe valide, cambio positivo se valuta diversa da EUR e la valuta è tra quelle in `config.valute`. Il **numero non è un parametro**: lo assegna l'app alla conferma con la logica attuale `max + 1` **[V]**. La risposta include `anteprima: { totaleImponibile, totaleEUR, righe }` calcolata dal server per farla vedere all'utente in chat.

**14. `propose_cliente`**
Parametri: `userId`, `nome`, `piva?`, `email?`, `billingUnit?: "ore" | "giornata"`, `rate?: number`, `billingStartDate?: date`, `indirizzo?`, `numeroCivico?`, `cap?`, `comune?`, `provincia?`, `nazione?` (default `IT`).
Validazione: `nome` non vuoto e non già presente (confronto senza maiuscole e spazi) tra i clienti del profilo; se presente, `VALIDATION` con `details.clienteEsistenteId`.

**15. `propose_incasso`**
Parametri: `userId`, `fatturaId`, `dataIncasso: date`.
Validazione: fattura esistente, non già `incassato: true`, `dataIncasso >= data` della fattura.

**16. `propose_scadenza_pagata`**
Parametri: `userId`, `scadenzaId`, `dataPagamento: date`.
Validazione: scadenza esistente, `pagato: false`.

**17. `withdraw_proposal`**
Parametri: `proposalId`.
Ritorna: `{ proposal }` con `status: "withdrawn"`.
Errori: `NOT_FOUND`, `PROPOSAL_NOT_PENDING`.

### Perché regge identico nel web

Nessun parametro dipende dal trasporto; l'identità del chiamante entra come `Principal` (13.4) e non come parametro; gli errori `PERMISSION_DENIED` e la paginazione sono già nel contratto; le proposte hanno lo stesso ciclo di vita in entrambi i casi. L'unica differenza ammessa nel web è che `list_users` mostra solo i profili dell'account.

## 13.2 Formato v2 e regole di merge

### Busta

```json
{
  "schemaVersion": 2,
  "updatedAt": "2026-09-12T14:03:22.114Z",
  "writer": { "id": "app-8f2c1a", "kind": "app", "version": "5.1.5" },
  "restoredAt": null,
  "restoredFrom": null,
  "users": [], "config": [], "clienti": [], "fatture": [], "workLogs": [], "scadenze": [],
  "tombstones": [],
  "proposals": []
}
```

- `schemaVersion` intero, oggi 2. Un lettore rifiuta versioni maggiori della propria con `SOURCE_UNAVAILABLE` e `details.schemaVersion`.
- `updatedAt`: istante della scrittura del file.
- `writer.id`: stringa stabile per installazione. L'app la genera una volta e la tiene nello store `meta` di IndexedDB; il server MCP nel file `~/.pivella-mcp/writer-id`. `kind` è `app`, `mcp` o `restore`.
- `restoredAt`, `restoredFrom`: valorizzati solo da un ripristino (13.3), altrimenti `null`.
- Gli array degli store contengono i tipi attuali **[V]** con due campi in più su ogni record: `updatedAt` (obbligatorio in v2) e `updatedBy` (writer id).
- File v1 (senza `schemaVersion`) **[V]** formato attuale: viene letto una sola volta, ogni record riceve `updatedAt` pari all'istante della lettura e `updatedBy` del lettore, e il file viene riscritto in v2 dopo un backup con kind `v1`.

### Tombstone

```json
{ "store": "workLogs", "id": "1757012345678", "deletedAt": "2026-09-12T13:50:00.000Z", "deletedBy": "app-8f2c1a" }
```

- Ogni `delete` su uno store dell'app produce un tombstone nello store IndexedDB `tombstones` (nuovo, `DB_VERSION` 4, `keyPath` composto `[store, id]`) e quindi nel file.
- La cancellazione di un utente **[V]** `deleteUser` produce un tombstone per ogni record dell'utente più uno per lo `users`.
- Potatura: alla scrittura, i tombstone con `deletedAt` più vecchio di 90 giorni vengono rimossi.

### Proposal

```json
{
  "id": "prop_2b7d...",
  "userId": "user_1712...",
  "kind": "workLog",
  "payload": { },
  "motivazione": "Hai detto di aver lavorato per Acme ieri",
  "status": "pending",
  "createdAt": "…", "updatedAt": "…", "expiresAt": "…",
  "createdBy": { "writerId": "mcp-3c9e", "client": "claude-desktop" },
  "result": null,
  "rejectReason": null
}
```

- `kind`: `workLog`, `fattura`, `cliente`, `incasso`, `scadenzaPagata`. `payload` è esattamente il set di parametri del tool corrispondente, meno `userId` e `motivazione`.
- `status`: `pending`, `applied`, `rejected`, `withdrawn`, `expired`. Transizioni ammesse solo da `pending` a uno degli altri quattro. Gli stati terminali non cambiano più.
- `expiresAt` = `createdAt` + 14 giorni. L'app marca `expired` alla lettura; il server MCP alla lettura per `list_proposals`.
- `result`: `{ recordId: string, numero?: string }` quando `applied`.
- Le proposte `applied`, `rejected`, `withdrawn` ed `expired` vengono rimosse dal file dopo 30 giorni dall'`updatedAt`.
- L'app **rivalida** il payload all'applicazione con le stesse regole del tool: una proposta nel file non è mai fidata.

### Merge: definizione

`merge(A, B)` con A lo snapshot locale (IndexedDB per l'app, oppure il file appena letto per il server MCP) e B l'altro. È commutativa e idempotente per costruzione. Non esiste merge a livello di campo: l'unità è il record intero.

Ordine di confronto tra due versioni dello stesso record: `updatedAt` maggiore vince; a parità di `updatedAt`, vince quella con `updatedBy` minore in ordine lessicografico; a parità anche di quello, la serializzazione JSON canonica (chiavi ordinate) minore. Deterministico su entrambi i lati.

### Merge: casi

| Caso | Esito |
|---|---|
| Record solo in A, nessun tombstone in B | resta |
| Record solo in A, tombstone in B con `deletedAt > updatedAt` | cancellato, tombstone conservato |
| Record solo in A, tombstone in B con `deletedAt <= updatedAt` | resta, il tombstone viene scartato (record ricreato o aggiornato dopo la cancellazione) |
| Stesso id in A e B, contenuto identico | resta |
| Stesso id, `updatedAt` diversi | vince il più recente, intero. La versione perdente è annotata nel log conflitti del lato che la perde (`meta.conflicts`, ultimi 200), con store, id, i due `updatedAt` e i due writer. La UI mostra il conteggio in Impostazioni e un toast "1 modifica sovrascritta dalla sincronizzazione". Il contenuto perdente è comunque nel backup (13.3) |
| Stesso id, stesso `updatedAt`, contenuto diverso | tiebreak deterministico come sopra, annotato nel log conflitti |
| Tombstone in entrambi | resta quello con `deletedAt` maggiore |
| `config` | stessa regola dei record: chiave `config_<userId>` **[V]**, record intero. Un cambio di tema di colore e un cambio di IBAN fatti in parallelo sui due lati si perdono a vicenda; è accettato e coperto dal backup |
| `users` | stessa regola; il profilo cancellato su un lato e modificato sull'altro segue la regola tombstone contro `updatedAt` |
| Record con `userId` senza profilo corrispondente e senza tombstone | resta, contato in `meta.orphans`, non mostrato in UI; nessuna cancellazione automatica |
| Proposal solo su un lato | resta |
| Proposal su entrambi, stesso `status` | vince `updatedAt` maggiore |
| Proposal `pending` su un lato, terminale sull'altro | vince lo stato terminale |
| Proposal con due stati terminali diversi | `applied` vince su tutti (esiste un record); altrimenti `updatedAt` maggiore |
| Busta | `updatedAt` = istante di scrittura; `writer` = chi scrive; `restoredAt` e `restoredFrom` = valore maggiore tra i due lati |

Clock: entrambi i writer usano l'orologio della stessa macchina, quindi lo skew è nullo. **Le cartelle sincronizzate da servizi cloud (Dropbox, iCloud Drive, Google Drive, OneDrive) non sono supportate.** Il lock advisory e il confronto per `updatedAt` presuppongono un solo file system e un solo orologio; la documentazione utente e il testo in Impostazioni lo dicono esplicitamente, e il server MCP rifiuta di avviarsi se il percorso della cartella contiene i segmenti tipici di quei servizi (`Dropbox`, `Mobile Documents`, `Google Drive`, `OneDrive`), con un messaggio chiaro e un flag `--allow-cloud-folder` che disattiva solo il controllo, non il supporto.

### Protocollo di scrittura dell'app

1. Leggi il file e memorizza `lastModified`.
2. `merged = merge(IndexedDB, file)`; applica a IndexedDB solo le differenze; aggiorna lo stato React per differenze.
3. Se `merged` è uguale al contenuto del file (confronto sul JSON canonico senza `updatedAt` e `writer` della busta), fine.
4. Acquisisci il lock (13.3); rileggi `lastModified`; se cambiato, torna al punto 1.
5. Backup (13.3). Se fallisce, rilascia il lock e fermati: IndexedDB è già aggiornato, il file resterà indietro e il tentativo si ripete al prossimo cambiamento o al prossimo giro di polling.
6. Scrivi il file, rilascia il lock, esegui la rotazione dei backup.

Trigger: avvio, focus, polling ogni 3 secondi a tab visibile, e ogni cambiamento di stato con debounce 500 ms **[V]** invariato.

### Protocollo di scrittura del server MCP

Il server non ha uno stato proprio: ogni tool di proposta fa lock, lettura, modifica in memoria, backup, scrittura, rilascio. La modifica è sempre e solo su `proposals`; il server non tocca mai gli store né i tombstone, quindi non può produrre conflitti sui record. Se dopo la lettura il file risulta v1, il server esegue l'upgrade a v2 come farebbe l'app (con backup kind `v1`).

## 13.3 Politica di backup

### Principio

**Nessuna scrittura sul file di sync inizia se il backup dello stato che sta per essere sovrascritto non è stato completato e verificato.** Vale per ogni scrittura, di ogni writer, ogni volta, senza eccezione per le scritture "piccole" come una proposta.

### Chi lo esegue

Entrambi i writer, ciascuno prima della propria scrittura, con lo stesso algoritmo implementato due volte (nell'app con la File System Access API, nel server con `fs` di Node). Non esiste un backup "condiviso": ognuno protegge ciò che sta per sovrascrivere. Scritture in momenti diversi producono backup diversi, ordinati per nome; non serve coordinazione oltre al lock.

### Dove e come si chiamano

- Cartella: `<cartella di sync>/pivella-backups/`, creata al primo uso. Sta dentro la cartella già autorizzata, quindi l'app può scriverci senza nuovi permessi **[V]** `mode: 'readwrite'` sull'handle della cartella.
- Nome: `pivella-sync.<timestamp>.<kind>.json`, con timestamp `YYYY-MM-DDTHH-mm-ss-SSSZ` (i due punti sostituiti da trattini per compatibilità con i file system) e `kind` in `app`, `mcp`, `v1`, `pre-restore`. Esempio: `pivella-sync.2026-09-12T14-03-22-114Z.mcp.json`.
- Contenuto: i byte esatti del file di sync prima della scrittura, nessuna trasformazione.
- Sensibilità: identica al file di sync; sta nella stessa cartella e segue la stessa sorte (cifratura del disco, cloud, eccetera).

### Algoritmo

1. Leggi i byte correnti del file di sync e calcolane SHA-256 (`crypto.subtle` nell'app, `crypto` in Node).
2. Se il file non esiste (prima sincronizzazione), il backup è considerato riuscito senza creare nulla; è l'unico caso.
3. Se esiste un file `pivella-backups/latest.json` con `{ "hash", "file" }`, l'hash coincide con quello corrente, **e il backup citato in `file` esiste davvero nella cartella con quello stesso hash**, allora lo stato è già preservato e il backup è considerato riuscito senza creare un nuovo file. Se una sola di queste condizioni manca (file `latest.json` assente o illeggibile, hash diverso, backup cancellato a mano o corrotto) si crea un backup nuovo. `latest.json` è solo un indice per la dedup e non è mai fidato da solo. Questo evita duplicati quando l'app riscrive dopo un merge senza cambiamenti, senza violare il principio.
4. Altrimenti scrivi i byte in un file temporaneo `pivella-sync.<timestamp>.<kind>.json.part`, chiudi, rileggi il file scritto, confronta lunghezza e SHA-256 con l'originale.
5. Se coincidono, rinomina il `.part` nel nome definitivo. Nel server: `fs.rename`, atomico sullo stesso file system. Nell'app: `FileSystemHandle.move(nuovoNome)`, disponibile in Chromium anche per i file locali (verificato da Davide sulla documentazione di developer.chrome.com), con feature detection su `FileSystemFileHandle.prototype.move`. Se manca, fallback esplicito: scrivi una seconda volta i byte direttamente sul nome definitivo, chiudi, rileggi e verifica lunghezza e hash; solo dopo cancella il `.part`. In entrambi i percorsi aggiorna `latest.json` solo a verifica completata. Lo stesso schema, `.part` più `move()` più fallback, vale per la scrittura del file di sync stesso al punto 6, così che un crash a metà scrittura non lasci mai un `pivella-sync.json` troncato.
6. Solo ora la scrittura del file di sync può partire.

### Se il backup fallisce

- La scrittura **non parte**. Il lock viene rilasciato.
- App: IndexedDB è già aggiornato, quindi l'utente non perde ciò che ha fatto; il file di sync resta indietro. Toast persistente "Sincronizzazione sospesa: impossibile creare il backup" con il motivo (spazio, permesso, cartella mancante) e un pulsante "Riprova". La sync riprova comunque al prossimo trigger. L'indicatore di sync in Impostazioni passa a stato di errore.
- Server MCP: il tool risponde `BACKUP_FAILED` con `details.reason`; nessuna proposta viene creata; il modello lo riferisce all'utente.
- Il file `.part` rimasto viene rimosso al tentativo successivo.

### Rotazione

Eseguita da chi ha appena scritto con successo, dopo la scrittura, mai prima. Un errore in rotazione non è un errore di scrittura.

- Si conservano sempre gli ultimi 30 backup, di qualunque kind.
- Oltre i 30, per i file più vecchi di 24 ore si conserva solo l'ultimo di ogni giorno, per 90 giorni. I giorni già coperti dai 30 più recenti contano come coperti.
- I backup con kind `pre-restore` e `v1` non vengono mai rimossi dalla rotazione automatica.
- Oltre i 90 giorni tutto viene rimosso, tranne i kind protetti.

Stima di spazio **[I]**: un file di sync con qualche migliaio di record pesa da centinaia di KB a pochi MB; 30 più 90 copie stanno in poche centinaia di MB al massimo. Accettato.

### Ripristino

Un ripristino è un **rimpiazzo totale**, non un merge. Copiare a mano un backup sopra `pivella-sync.json` **non è un ripristino**: l'app lo leggerebbe come snapshot remoto e i record locali più recenti vincerebbero. Va documentato all'utente.

Dall'app, in Impostazioni, sezione Backup, voce "Cronologia sincronizzazione":

1. Elenco dei file in `pivella-backups/` con data, kind, dimensione e, dopo lettura, conteggio dei record per store e profili contenuti.
2. Anteprima e conferma con dialogo che riporta i conteggi correnti e quelli del backup.
3. Backup dello stato corrente con kind `pre-restore`; se fallisce, il ripristino non parte.
4. `clear` e `put` di tutti gli store da backup (il percorso `importAll` esistente **[V]**), store `tombstones` svuotato, `proposals` prese dal backup.
5. Scrittura del file di sync con `restoredAt` = adesso e `restoredFrom` = nome del backup, `writer.kind` = `restore`.
6. `meta.lastRestoreAck` = `restoredAt`.

Dal server MCP, per quando l'app non si apre: comando `pivella-mcp restore --backup <nome>` (non un tool: un'azione da terminale, mai invocabile dal modello). Fa i punti 3 e 5. L'app, alla prima lettura di un file con `restoredAt` maggiore di `meta.lastRestoreAck`, esegue i punti 4 e 6 invece del merge.

Il file v1 originale viene conservato per sempre con kind `v1` ed è ripristinabile con lo stesso meccanismo.

### Lock

File `pivella-sync.lock` nella cartella di sync con `{ writerId, kind, acquiredAt }`. Acquisizione: se il file non esiste o `acquiredAt` è più vecchio di 10 secondi, lo si scrive; si attende 50 ms, lo si rilegge, e se contiene il proprio `writerId` il lock è acquisito. Timeout complessivo 3 secondi, poi `SOURCE_LOCKED`. Rilascio: cancellazione del file. Il lock è advisory: nessuno dei due writer può ottenere esclusione atomica con queste API **[I]**, ed è il motivo per cui il backup è obbligatorio a ogni scrittura.

## 13.4 Interfaccia DataSource

Tutti i tool dipendono da una sola interfaccia. I tool non conoscono file, cartelle, handle, HTTP o database. Le firme sono riportate in TypeScript come specifica, non come codice.

```ts
type Principal =
  | { kind: 'local'; writerId: string }
  | { kind: 'account'; accountId: string; scopes: Array<'read' | 'propose'>; writerId: string };

interface UserSnapshot {
  user: User;
  config: Config | null;
  clienti: Cliente[];
  fatture: Fattura[];
  workLogs: WorkLog[];
  scadenze: Scadenza[];
  readAt: string;
}

interface ProposalFilter { userId: string; status?: ProposalStatus; limit?: number; offset?: number }

interface DataSource {
  listUsers(p: Principal): Promise<User[]>;
  getSnapshot(p: Principal, userId: string): Promise<UserSnapshot>;
  listProposals(p: Principal, f: ProposalFilter): Promise<{ items: Proposal[]; total: number }>;
  getProposal(p: Principal, proposalId: string): Promise<Proposal | null>;
  addProposal(p: Principal, input: NewProposal): Promise<Proposal>;
  withdrawProposal(p: Principal, proposalId: string): Promise<Proposal>;
}

class DataSourceError extends Error { code: ErrorCode; details?: object }
```

Regole:

- `getSnapshot` restituisce sempre l'intero profilo. Filtri, totali, riepiloghi e paginazione sono calcolati nei tool con il modulo condiviso `src/lib/sync` e i calcoli esistenti **[V]**. È questa scelta che tiene l'interfaccia a sei metodi e la rende implementabile su file, su HTTP e su Postgres senza cambiare i tool.
- `addProposal` è l'unico metodo che scrive. Riceve un `NewProposal` già validato dal tool; l'implementazione assegna `id`, `createdAt`, `expiresAt`, `createdBy` e persiste. Nel locale include lock, backup e scrittura (13.2, 13.3); nel web è una `INSERT`.
- `Principal` di kind `local` vede tutti i profili del file; di kind `account` solo quelli dell'account. Il controllo sta nell'implementazione, non nei tool.
- Il server MCP locale espone un solo principal `local` con il proprio `writerId`. Nel web il principal viene dal token OAuth. I tool non cambiano.
- Implementazioni previste: `FileDataSource` (ora), `HttpDataSource` e `PostgresDataSource` (dopo). Il modulo condiviso contiene anche `applyProposal` per l'app, che non è parte di `DataSource` perché solo l'app applica.

Struttura dei sorgenti congelata:

```
src/lib/sync/schema.ts        tipi busta, tombstone, proposal, versioni
src/lib/sync/merge.ts         merge puro e log conflitti
src/lib/sync/validate.ts      regole di validazione delle proposte, condivise con i modali
src/lib/sync/proposals.ts     ciclo di vita, scadenze, applyProposal (lato app)
src/lib/sync/backup.ts        algoritmo di backup e rotazione astratto su una piccola interfaccia di file system
src/lib/sync/*.test.ts        node:test
mcp/src/datasource.ts         interfaccia DataSource e DataSourceError
mcp/src/fileDataSource.ts     implementazione su file, lock, backup con fs
mcp/src/tools/*.ts            un file per tool, solo contratto e mapping
mcp/src/server.ts             registrazione tool, trasporto stdio
mcp/src/cli.ts                avvio, restore, diagnostica
```

## 13.5 Cose dichiarate chiuse

- Le proposte stanno nello stesso file di sync, non in un file separato.
- Il numero fattura lo assegna solo l'app.
- Nessun tool applica proposte; nessuna impostazione di applicazione automatica nella prima versione.
- I backup stanno nella cartella di sync, sottocartella `pivella-backups`.
- Il merge è a record intero, mai a campo.
- L'app continua a usare `Date.now()` per i propri id.
- Polling a 3 secondi, proposte valide 14 giorni, tombstone potati a 90 giorni, 30 backup più uno al giorno per 90 giorni.
- Il numero fattura è il progressivo che l'app assegna già oggi, `max + 1` sul valore intero di `numero` **[V]**. Nessun altro formato.
- Cartelle cloud non supportate, con controllo all'avvio del server (13.2).
- Scrittura atomica con `.part` e `move()` con feature detection e fallback verificato (13.3), per backup e per file di sync.
- Il nome del pacchetto npm è rimandato e non blocca nulla: nel frattempo il server si avvia dal repo con `npm run mcp`.

## 13.6 Cosa resta davvero da decidere

1. **Nome del pacchetto npm**: rimandato per decisione di Davide, non bloccante. Nient'altro.

## 13.7 Giornate e fatture: verifica e decisione

### Cosa ho trovato nel codice

Non esiste alcun collegamento tra work log e fatture, in nessuna direzione:

- `WorkLog` ha solo `id`, `userId`, `clienteId`, `data`, `ore` (legacy), `tipo`, `quantita`, `note` **[V]** `types/index.ts`. `Fattura` non ha riferimenti a work log **[V]**.
- I file che usano `workLogs` sono otto **[V]**: `Calendario.tsx`, `AppContext.tsx`, `useUsers.ts`, `useWorkLogs.ts`, `fiscali.ts`, `IndexedDBManager.ts`, `crossDomainMigration.ts`, `types/index.ts`. `Fatture.tsx`, `Dashboard.tsx` e i modali di creazione e upload fattura non li toccano **[V]**.
- Nessuna occorrenza di `fatturaId`, `workLogId`, `billed`, `invoiced` o di un flag "fatturato" **[V]**.
- L'unico calcolo economico sui work log è in Calendario, tariffa per quantità nel mese o nell'anno **[V]** righe 95 e 186. È una funzione di UI dell'app e resta lì; il contratto MCP non la riproduce.

### Decisione (Davide, definitiva)

Il calendario serve a tenere traccia del lavoro. Le fatture sono la fonte di verità del fatturato e possono contenere forfait, sconti e altro. Qualunque deduzione di importi da giornate per tariffa è fragile e non entra nel contratto. Quindi:

- Nessun tool "giornate non fatturate", né oggi né come estensione prevista.
- Nessun campo `fatturaId` sul work log, nessun flag, nessun parametro `workLogIds` in `propose_fattura`.
- Le giornate si leggono con `list_work_logs` e `get_giornate_per_cliente`, solo quantità. Gli importi si leggono con `list_fatture`, `get_fattura` e `get_riepilogo_anno`, solo da fatture. Nessun tool restituisce un numero che combini i due.
- Se un utente chiede all'assistente "preparami la fattura di settembre per Acme", il modello può leggere le giornate e leggere la tariffa del cliente da `list_clienti`, ma la proposta di fattura contiene righe scritte esplicitamente con descrizione, quantità e prezzo, che l'utente vede e conferma. Il server non calcola né suggerisce importi a partire dalle giornate.
