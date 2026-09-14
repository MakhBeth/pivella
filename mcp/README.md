# Server MCP locale di Pivella

Server MCP su stdio che legge e scrive il file di sync `pivella-sync.json` (formato v2). Espone 17 tool: 11 di lettura e 6 di proposta. Contratto in `docs/fattibilita-mcp.md`, sezioni 13.1 e 13.4.

Regole fisse:

- scrive solo dentro `proposals`; gli store e i tombstone non vengono mai toccati;
- ogni scrittura è preceduta da un backup verificato in `pivella-backups/` con kind `mcp`; se il backup fallisce la scrittura non parte;
- nessun tool applica proposte: la conferma avviene solo nell'app;
- il numero fattura non è un parametro, lo assegna l'app alla conferma;
- nessun collegamento tra giornate e fatture: le giornate escono solo come quantità.

## Per chi usa Pivella

Serve solo Node (20 o più recente). Il pacchetto npm si chiama `pivella-mcp` e lo avvia il client MCP, non l'utente: non c'è un servizio da tenere acceso né una porta aperta. L'app Pivella può restare chiusa: le proposte finiscono nel file di sync e compaiono nell'app alla sync successiva.

Claude Code:

```sh
claude mcp add pivella -- npx -y pivella-mcp --dir /percorso/cartella-di-sync
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "pivella": {
      "command": "npx",
      "args": ["-y", "pivella-mcp", "--dir", "/percorso/cartella-di-sync"]
    }
  }
}
```

Diagnostica senza avviare il server:

```sh
npx -y pivella-mcp check --dir /percorso/cartella-di-sync
```

La cartella è quella scelta in Impostazioni per la sync su file e può arrivare anche da `PIVELLA_SYNC_DIR`. Le cartelle cloud (Dropbox, iCloud, Google Drive, OneDrive) vengono rifiutate all'avvio. Il writer id sta in `~/.pivella-mcp/writer-id`. Con più profili nel file, `list_users` li elenca tutti e ogni tool riceve `userId`: il server locale vede tutti i profili, come chi ha accesso al Mac.

## Dal repo, senza pacchetto

```sh
npm run mcp -- check --dir /percorso/cartella-di-sync   # diagnostica
npm run mcp -- --dir /percorso/cartella-di-sync         # server su stdio (tsx sui sorgenti)
npm run mcp:build                                       # bundle in mcp/dist/cli.js
```

Per Claude Code dal repo: `claude mcp add pivella -- npx tsx /percorso/repo/mcp/src/bin.ts --dir /percorso/cartella-di-sync`.

Per provare senza toccare i dati veri: copia la cartella di sync in una cartella usa e getta e passa quella.

## Pubblicazione

`mcp/package.json` è il pacchetto: `bin` punta a `dist/cli.js`, dipendenze `@modelcontextprotocol/sdk` e `zod`, il resto (moduli di `src/lib/sync` compresi) è nel bundle. Dalla radice del repo:

```sh
npm run mcp:build
cd mcp && npm publish
```

## Struttura

```
mcp/src/datasource.ts       interfaccia DataSource, DataSourceError, paginazione
mcp/src/fileDataSource.ts   implementazione su file: lock, backup, scrittura atomica
mcp/src/tools/shared.ts     definizione dei tool, esecuzione, mappatura errori
mcp/src/tools/<tool>.ts     un file per tool
mcp/src/tools/propose.ts    fabbrica dei tool di proposta
mcp/src/server.ts           registrazione dei tool sul Server MCP
mcp/src/cli.ts              avvio, check, writer id, controllo cartelle cloud
mcp/src/bin.ts              entry point del comando pivella-mcp
mcp/package.json            pacchetto npm pivella-mcp
```

I moduli condivisi con l'app stanno in `src/lib/sync`: `validate.ts` (regole delle proposte), `proposals.ts` (ciclo di vita), `schema.ts`, `syncFile.ts`, `backup.ts`, `lock.ts`.

Test: `npm test` (node:test via tsx).
