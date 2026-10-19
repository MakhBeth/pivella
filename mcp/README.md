# Pivella MCP server

Talk to your Pivella data from your AI assistant. Ask how much you invoiced, how many days you worked for a client, which tax deadlines are still open. Let the assistant draft an invoice, a work day, a new client, a cash-in. Everything stays on your computer: the server reads the same sync folder Pivella already uses, and nothing is sent anywhere.

Two things to know before you start:

- **The assistant proposes, you confirm.** It never writes data on its own. Every change it suggests waits in Pivella until you approve it: open the app, a notice at the top tells you there are proposals, you confirm or reject each one. The invoice number is assigned by the app when you confirm.
- **Nothing runs in the background.** The server starts when your assistant needs it and stops with it. No service, no open port, no account.

## What you can ask

- "How much did I cash in this year, and how far am I from the 85k threshold?"
- "How many days did I work for Acme in September?"
- "Which invoices are still unpaid?"
- "Are there tax deadlines to pay this month?"
- "Draft an invoice to Acme for 10 days of consulting at 400 euro each."
- "Log a day of work for Acme yesterday."
- "Mark invoice 12 as paid today."

Work days and invoices stay separate on purpose: the assistant can read both, but it never turns days into amounts on its own. When you ask for an invoice, you decide lines, quantities and prices, and you see them before confirming.

It can also generate documents for an invoice already saved: "Generate the FatturaPA XML for invoice 12" or "Send me a courtesy PDF of invoice 12". The two document tools, `genera_fattura_xml` and `genera_fattura_cortesia`, write the file into `documenti/<year>` in the sync folder, or into a folder you name, and never overwrite an existing file. They only write the document: your Pivella data is untouched.

## Banking tools

- `list_bank_formats`: list saved CSV definitions and their field mappings for a profile.
- `list_bank_transactions`: filter imported transactions by account, date range and inflow/outflow, with pagination and EUR totals over the entire filter.
- `preview_bank_import`: validate CSV text against a saved format, inspect rows and duplicates, and calculate totals for new transactions without writing anything.
- `propose_bank_format`: propose a new reusable CSV definition. Confirm it in Pivella, then retrieve its ID with `list_bank_formats`.
- `propose_bank_import`: propose an import using a saved format. Pivella displays the account, document, rows and totals for review; it imports only after confirmation.

Pass `userId` from `list_users`. Import tools accept `formatId`, `account`, `sourceFile` (a display filename) and `csv` (the CSV text, already decoded using the format's encoding). They do not read an arbitrary local path. MCP imports are limited to **1 MB and 1,000 transactions per proposal**; the app's CSV importer accepts larger documents up to 10 MB.

Use the same account name on subsequent imports and map the bank's unique transaction ID when available. Without it, identical transactions in partial statements may be considered duplicates. Duplicates are checked again at confirmation, including transactions imported manually since the proposal was created. A changed or deleted format blocks confirmation until a new proposal is created. Rejecting a proposal leaves the transactions untouched. Banking imports do not mark invoices as paid, and the net flow is not the bank balance.

## Compatibility

pivella-mcp 1.3 supports sync schema version 4, including bank CSV formats and bank transactions. Update the MCP server together with the app version that introduces **Flussi di cassa**. Files using schemas v1, v2 and v3 remain readable; older MCP versions cannot read v4. Existing proposal writes preserve all banking data.

## Install

You need:

1. **Node.js 20 or newer** on your computer. Check with `node -v`; if missing, install it from nodejs.org.
2. **Pivella with file sync enabled.** In Pivella, Settings, choose a sync folder. That folder contains `pivella-sync.json`. Note its full path, for example `/Users/you/Documents/pivella-sync`.

Then add the server to your assistant. The package is `pivella-mcp` on npm; the assistant downloads it the first time. Replace `/path/to/sync-folder` with your folder.

### Claude Desktop

Open the file `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/`, or from Claude Desktop, Settings, Developer, Edit Config) and add:

```json
{
  "mcpServers": {
    "pivella": {
      "command": "npx",
      "args": ["-y", "pivella-mcp", "--dir", "/path/to/sync-folder"]
    }
  }
}
```

Restart Claude Desktop. If it says it cannot find `npx`, replace `"npx"` with the full path you get from `which npx` in a terminal.

### Claude Code

```sh
claude mcp add pivella -- npx -y pivella-mcp --dir /path/to/sync-folder
```

Then, in a session, `/mcp` shows the server as connected.

### Codex CLI

```sh
codex mcp add pivella -- npx -y pivella-mcp --dir /path/to/sync-folder
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.pivella]
command = "npx"
args = ["-y", "pivella-mcp", "--dir", "/path/to/sync-folder"]
```

### Cursor

Create `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for every project) with the same JSON as Claude Desktop.

### LM Studio

LM Studio can use MCP servers with local models. Open the Program tab (the plug icon on the right), choose Install, then Edit mcp.json, and add the same JSON as Claude Desktop:

```json
{
  "mcpServers": {
    "pivella": {
      "command": "npx",
      "args": ["-y", "pivella-mcp", "--dir", "/path/to/sync-folder"]
    }
  }
}
```

Pick a model that supports tool calling (LM Studio marks them), then enable `pivella` in the chat. Small models sometimes skip tools or call them with wrong arguments: if the answers look made up, try a larger model.

### Ollama

Ollama runs the model but does not talk MCP by itself. You need a chat client that connects to Ollama and supports MCP. Two that work with the same configuration format:

- **mcphost** (terminal): install it from github.com/mark3labs/mcphost, save the JSON above as `mcp.json`, then run `mcphost -m ollama:qwen3 --config mcp.json`.
- **Open WebUI**, **5ire**, **oterm** and others: look for "MCP servers" in their settings and enter command `npx` with arguments `-y pivella-mcp --dir /path/to/sync-folder`.

Use a model with tool calling (Qwen 3, Llama 3.1 and newer, Mistral). Check the client's documentation for the exact steps; they change often.

### Any other client

If it supports MCP servers over stdio, the settings are always the same: command `npx`, arguments `-y pivella-mcp --dir /path/to/sync-folder`. No URL, no port, no token. The folder can also come from the environment variable `PIVELLA_SYNC_DIR` instead of `--dir`.

## Try it

Check that the server sees your data, without starting your assistant:

```sh
npx -y pivella-mcp check --dir /path/to/sync-folder
```

It prints your profiles and how many clients, invoices and work days it found. Then ask your assistant "list my Pivella profiles": it should answer with the names you use in the app.

## Confirming proposals

When the assistant proposes something, it says so and nothing has changed yet. Open Pivella: a notice at the top says how many proposals are waiting and takes you to them (Settings, sync section). Each proposal shows what it does and why the assistant suggested it; invoices show every line and the total. Confirm to create the record, Reject to drop it. Proposals expire after 14 days.

Before anything is written to the sync file, a backup of the previous file is saved in `pivella-backups/` inside the sync folder. If the backup cannot be written, nothing is changed.

## Questions

**I have more than one profile in Pivella.** The assistant sees all of them and asks which one you mean. Say your profile name in the request to skip the question.

**Can I use it while Pivella is open?** Yes. The app and the server coordinate through a lock file, and each one backs up before writing. You can also use several assistants at once.

**Does it work if the app is closed?** Yes. Proposals are saved in the sync file and appear in Pivella at the next sync, as soon as you open it.

**My sync folder is in Dropbox, iCloud, Google Drive or OneDrive.** It works, in beta. With few writes it is fine, but if two devices write at the same moment the cloud service can create a "conflicted copy" that Pivella ignores. If you see one, check the backups.

**How do I change the folder?** Edit the path after `--dir` in your client's configuration and restart the client (in Claude Code: `claude mcp remove pivella` and add it again, then `/mcp`).

**Where are my data sent?** Nowhere by the server. Your assistant reads what the tools return, so what you ask about goes to the model you use, local or remote, as any other message would.

**I want to try without touching my real data.** Copy the sync folder somewhere else and point `--dir` to the copy.

## For developers

From the repo, without the package:

```sh
npm run mcp -- check --dir /path/to/sync-folder   # diagnostics
npm run mcp -- --dir /path/to/sync-folder         # stdio server on the sources
npm run mcp:build                                 # bundle into mcp/dist/cli.js
```

To register the sources in a client: command `npx`, arguments `tsx /path/to/repo/mcp/src/bin.ts --dir /path/to/sync-folder`.

Publishing: `mcp/package.json` is the package (`bin` on `dist/cli.js`, dependencies `@modelcontextprotocol/sdk`, `zod`, `@react-pdf/renderer` and `react`, everything else bundled; the bundle also carries `dist/fonts/RobotoMono-Regular.ttf`, the monospace font used by the courtesy PDF). Bump the version, then `cd mcp && npm publish`; `prepublishOnly` builds the bundle. `npm publish --dry-run` shows what goes in.

Layout:

```
mcp/src/datasource.ts       DataSource interface, errors, pagination
mcp/src/fileDataSource.ts   file implementation: lock, backup, atomic write
mcp/src/tools/              one file per tool, shared.ts for definition and error mapping
mcp/src/server.ts           tool registration on the MCP Server
mcp/src/cli.ts, bin.ts      startup, check, writer id, entry point
```

The modules shared with the app live in `src/lib/sync` (`validate.ts`, `proposals.ts`, `applyProposal.ts`, `proposalFlow.ts`). The full tool contract is in `docs/fattibilita-mcp.md` (Italian). Tests: `npm test`.

Gli incassi parziali registrati nell’app sono inclusi nei totali MCP: `list_fatture` distingue importo incassato e residuo, mentre `get_riepilogo_anno` attribuisce ogni quota al proprio anno. `propose_incasso` su una fattura parzialmente incassata propone il saldo del solo residuo.
