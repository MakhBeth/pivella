# Passaggio di consegne: sync v2 e MCP locale

Per un agente che non ha visto il lavoro precedente. Leggi questo file, poi solo le sezioni della specifica indicate sotto. Data: 2026-09-13.

## 1. Stato del branch

Branch `feat/sync-v2-merge-backup`, 9 commit oltre `main`, working tree pulito, **mai pushato**. Ultimo commit `6392ad0 fix(sync): rilievi review Codex`.

| Verifica | Esito |
|---|---|
| `npm test` (node:test via tsx) | 128 verdi, 0 falliti |
| `npm run lint` (`tsc --noEmit`) | pulito |
| `npm run build` | ok |

Fatto e testato, tutto codice puro non ancora collegato all'app in esecuzione:

- `src/lib/sync/schema.ts`: busta v2, tombstone, proposte, upgrade da v1, validazione stretta (store obbligatori, `id` stringa, niente duplicati), `instantOf` / `compareInstants` (confronti temporali sempre per istante), `tombstoneTimestamp` (strettamente maggiore dell'`updatedAt` del record), JSON canonico, `snapshotsEquivalent`.
- `src/lib/sync/merge.ts`: `mergeSnapshots` a record intero, commutativo e idempotente, tombstone con tiebreak, conflitti con `droppedRecord` intero, orfani contati, diff `changes` rispetto al lato A. `pruneSnapshot` separata (tombstone 90 giorni, proposte terminali 30). `pickTombstone` condivisa.
- `src/lib/sync/atomicWrite.ts`: `.part`, rilettura con lunghezza e SHA-256, `move` se c'è, fallback su `NotSupportedError`.
- `src/lib/sync/backup.ts`: `backupBeforeWrite`, `writeSyncFile` (backup, poi scrittura, poi rotazione; se il backup fallisce il file di sync non viene toccato), `latest.json` con `{hash, file}` mai fidato da solo, suffisso `-N` anti-collisione, kind protetti mai dedup, `planRotation` pura.
- `src/lib/sync/fileSystem.ts`, `nodeFileSystem.ts` (symlink e `..` rifiutati), `fsaFileSystem.ts` (File System Access, non testabile in Node, non ancora usato), `testing/memoryFileSystem.ts` (solo test).
- `src/lib/db/syncMetaDb.ts`: database IndexedDB separato `PivellaSyncMeta` v1 con store `tombstones` (chiave `[store, id]`), `meta` (writer id, `lastRestoreAck`, log conflitti limitato a 200 senza payload), `archive` (record locali perdenti per intero, senza limite). Accetta un `IDBFactory` esplicito; i test usano `fake-indexeddb`.
- `src/types/index.ts`: `updatedAt?` e `updatedBy?` opzionali su User, Cliente, Fattura, WorkLog, Config, Scadenza.

## 2. Specifica: cosa leggere davvero

File `docs/fattibilita-mcp.md`. Le sezioni 0-12 sono storia e analisi: non rileggerle. Leggi solo:

- **13.2** Formato v2 e regole di merge (busta, tombstone, proposte, tabella dei casi, protocollo di scrittura dell'app).
- **13.3** Politica di backup (algoritmo, cosa succede se fallisce, rotazione, ripristino, lock).
- **13.8** Database separato `PivellaSyncMeta` e finestra di non atomicità.
- **13.1** e **13.4** solo quando si arriva al server MCP (contratto dei 17 tool, interfaccia `DataSource`).
- **13.5** elenco delle cose chiuse, **13.7** decisione su giornate e fatture.

## 3. Decisioni di Davide, chiuse, da non riaprire

- **MCP locale** via stdio sul file di sync. Non web MCP. Il Mac spento non è un problema.
- **Niente bump di `ForfettarioDB`**: resta a versione 3, `onupgradeneeded` non si tocca. Tutto ciò che serve alla sync sta in `PivellaSyncMeta`. Motivo in 13.8.
- **Backup verificato prima di ogni scrittura** sul file di sync, da qualunque writer. Se fallisce, la scrittura non parte.
- **Nessun collegamento tra giornate (workLogs) e fatture**: niente `fatturaId`, niente flag, niente importi dedotti da giornate per tariffa. Le giornate si leggono per cliente e periodo, gli importi solo dalle fatture.
- Numero fattura: il progressivo che l'app assegna già. Cartelle cloud (Dropbox, iCloud, Drive) non supportate. `move()` con feature detection e fallback. Merge a record intero, mai a campo. Proposte nello stesso file di sync. Nome pacchetto npm rimandato.
- Ogni passo che tocca i dati veri (`ForfettarioDB`, file di sync reale) va **approvato da Davide a parte** prima di iniziare.

## 4. Tre micro decisioni aperte prima del passo 2

1. **Dove timbrare `updatedAt` e `updatedBy`.** Proposta: negli hook (`useFatture`, `useWorkLogs`, `useClienti`, `useScadenze`, `useConfig`, `useUsers`) così lo stato React è coerente, con `IndexedDBManager.put` che timbra comunque se manca, come rete di sicurezza.
2. **Riconciliazione locale all'avvio** (13.8, ultimo paragrafo): cancellare da `ForfettarioDB` ogni record con tombstone più recente. Proposta: sì, subito, dentro `init`.
3. **Granularità di `mergeIntoDb`.** Proposta: una transazione per store, così un crash a metà non lascia uno store mezzo aggiornato.

## 5. Passi da 2 a 6

Ordine obbligato. Stime per una persona.

| Passo | File | Cosa | Stima | Dati veri |
|---|---|---|---|---|
| 2 | `src/lib/db/IndexedDBManager.ts` | apre anche `PivellaSyncMeta` e recupera il writer id; `put` timbra; `delete` scrive **prima** il tombstone con `tombstoneTimestamp` e poi cancella; `mergeIntoDb(result)`: archivia i `droppedRecord` con `appendConflicts`, poi applica `changes` per store; riconciliazione all'avvio; `IDBFactory` iniettabile per i test. `importAll` e `onupgradeneeded` invariati | 2 gg | sì |
| 3 | `src/lib/utils/fileSystemSync.ts` | lettura con `parseSyncFile` (v1 e v2), scrittura con `writeSyncFile` su `fsaFileSystem`, `pruneSnapshot` prima di serializzare, `lastModified` dall'handle, lock advisory `pivella-sync.lock` (13.3), backup kind `v1` al primo file legacy (già garantito da `writeSyncFile`) | 1,5 gg | sì |
| 4 | `src/hooks/useFolderSync.ts` | ciclo leggi, fondi, applica, riscrivi solo se diverso; polling `lastModified` ogni 3 s a tab visibile; stato errore backup con banner e Riprova; gestione permesso da rinnovare | 1,5 gg | sì |
| 5 | `src/context/AppContext.tsx` | `handleDataLoaded` aggiorna lo stato React per differenze del merge invece di sostituirlo | 1 gg | indiretto |
| 6 | `src/components/pages/Impostazioni.tsx` | conteggio conflitti e archivio, stato backup, cronologia con ripristino (`pre-restore`, rimpiazzo totale, `restoredAt`), testo su cartelle cloud non supportate | 1,5 gg | sì |

Totale 7,5 giornate. Dopo: server MCP in `mcp/` con i 17 tool (13.1, 13.4) e UI delle proposte, circa 5,5 giornate, fuori da questo handoff.

Prima release consigliata senza polling (solo avvio e focus, come oggi), per osservare backup e conflitti una settimana.

## 6. Trappole note

- **`IndexedDBManager.doInit` cancella e ricrea il database** su `BlockedError` o `TimeoutError` (3 secondi) in `openDatabase`. È il motivo per cui non si alza la versione. Non aggiungere nulla che possa rallentare o bloccare l'apertura di `ForfettarioDB`; aprire `PivellaSyncMeta` dopo, non dentro quel percorso.
- **Finestra tra tombstone e cancellazione**: due database, due transazioni. Ordine obbligato: tombstone prima, con `deletedAt` strettamente maggiore (`tombstoneTimestamp`), poi `delete`. Così un crash nel mezzo ritarda la cancellazione al merge successivo e non fa mai risorgere il record. La riconciliazione all'avvio chiude anche quell'effetto.
- **Cambio di comportamento in `AppContext`**: oggi `handleDataLoaded` fa `importAll`, cioè `clear` più `put`, e il file vince su tutto. Con il merge un record presente solo in IndexedDB sopravvive e una modifica locale più recente vince sul file. È voluto, ma è visibile: chi usava il file come verità assoluta vedrà record che prima sparivano.
- **Un record locale che perde contro il file non è in nessun backup** (i backup sono del file). L'unica copia è `PivellaSyncMeta.archive`: archiviare **prima** di applicare le differenze, mai dopo.
- **Copiare a mano un backup sopra `pivella-sync.json` non è un ripristino**: il merge farebbe vincere i record locali più recenti. Il ripristino è solo dall'app o dal comando `restore` del server, con `restoredAt` nella busta.
- **Testare senza toccare i dati veri**: `npm run dev` su localhost ha un IndexedDB separato da pivella.it. Usare un backup esportato e una **copia** della cartella di sync.
- Rollback: `ForfettarioDB` non cambia struttura, quindi tornare a una release precedente funziona; il backup `v1` è conservato per sempre.

## 7. Regole di lavoro

- Branch dedicato, mai su `main`, **nessun push** senza ok esplicito.
- Commit piccoli, messaggi in italiano, senza `Co-Authored-By`.
- Test insieme al codice, con `tsx --test`. Per IndexedDB usare `fake-indexeddb` con un `IDBFactory` esplicito, mai `indexedDB` globale nei test.
- **Mai la cartella di sync reale di Davide nei test**: solo `mkdtemp` e fixture. Contiene fatture vere.
- Ogni passo che tocca `ForfettarioDB` o il file di sync reale va approvato da Davide prima di iniziare.
- Se un punto della specifica è sbagliato o ambiguo, fermarsi e chiedere, non improvvisare.

## 8. Review Codex: rilievi e risoluzione

Review in chat (4 scambi, verdetto finale APPROVED), poi una verifica indipendente su F9. Tutti i rilievi accettati; nessuno respinto.

| ID | Rilievo | Risoluzione |
|---|---|---|
| F1 | `latest.json` con `file: "../pivella-sync.json"` faceva saltare il backup | solo nomi di backup validi, senza separatori; symlink rifiutati nell'adapter Node |
| F2 | due backup con stesso istante e kind si sovrascrivevano | suffisso `-N`, mai sostituire un backup esistente |
| F3 | dedup ignorava i kind protetti | `v1` e `pre-restore` creano sempre la propria copia |
| F4 | `latest.json` con `null` o illeggibile bloccava la sync | ogni errore dell'indice è un miss, si crea un backup nuovo |
| F5 | `move` sul prototipo ma non supportato sui file locali | fallback solo su `NotSupportedError`, altri errori propagati |
| F6 | date confrontate come stringhe (`10:00:00Z` > `10:00:00.500Z`) | `compareInstants` ovunque, anche in `addTombstone` |
| F7 | potatura dentro il merge faceva risorgere record alla ri-fusione | `pruneSnapshot` separata; limite residuo documentato in 13.2 |
| F8 | tombstone e `restoredAt` a parità non commutativi | `pickTombstone` e tiebreak su `restoredFrom` |
| F9 | symlink e `..` dopo componente inesistente aggiravano la root Node | `..` rifiutato prima del walk, `lstat` su ogni componente, symlink anche pendenti rifiutati |
| F10 | writer id creato in due transazioni | una sola transazione readwrite |
| F11 | store `null` o assente diventava vuoto | in v2 gli store sono obbligatori, record senza `id` o duplicati rifiutati |
| F12 | il log a 200 troncava i record locali perdenti prima di salvarli | store `archive` senza limite, stessa transazione del log |
| F13 | tombstone nello stesso millisecondo dell'aggiornamento perdeva | `tombstoneTimestamp` strettamente maggiore |
| F14 | asserzioni di ordine backup/scrittura deboli | ordine completo verificato sul log delle operazioni |

**Aperti dopo la verifica finale su F9** (segnalati da Codex, non corretti, decide Davide):

1. `nodeFileSystem.ts:15` e `:38`: la realpath della root è calcolata una volta; se la cartella viene rinominata e sostituita da un symlink dopo l'avvio, la scrittura finisce fuori. Fix proposto: ricalcolare `realpath(root)` a ogni chiamata e rifiutare se diversa da quella iniziale.
2. `nodeFileSystem.ts:30` e `:36`: split solo su `/`; con semantica Windows `missing\..\x` resta un componente unico. Irrilevante su macOS. Fix proposto: rifiutare il backslash nei componenti.
