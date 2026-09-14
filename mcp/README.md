# Pivella MCP server

Let your AI assistant read your Pivella data and propose changes, without your data leaving your computer. The server runs on your machine and talks to the sync folder that Pivella already uses. It can answer questions such as "how much did I invoice this year", "how many days did I work for Acme in September", "which tax deadlines are still unpaid", and it can propose a new invoice, a work day, a client, a cash-in or a paid deadline.

Fixed rules:

- the assistant never writes data directly: it creates proposals, and every proposal becomes data only when you confirm it in the Pivella app (Settings, sync section; the app shows a notice at the top when proposals are waiting);
- the invoice number is never chosen by the assistant: the app assigns it on confirmation;
- every write to the sync file is preceded by a verified backup in `pivella-backups/`; if the backup fails, nothing is written;
- no link between work days and invoices: work days come out as quantities only, amounts come only from invoices.

## Setup

You only need Node (20 or newer). The npm package is `pivella-mcp` and the MCP client starts it, not you: there is no service to keep running and no open port. The Pivella app can stay closed: proposals land in the sync file and show up in the app at the next sync.

Claude Code:

```sh
claude mcp add pivella -- npx -y pivella-mcp --dir /path/to/sync-folder
```

Claude Desktop (`claude_desktop_config.json`):

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

Codex CLI:

```sh
codex mcp add pivella -- npx -y pivella-mcp --dir /path/to/sync-folder
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.pivella]
command = "npx"
args = ["-y", "pivella-mcp", "--dir", "/path/to/sync-folder"]
```

Cursor: the same JSON as Claude Desktop in the project's `.cursor/mcp.json` or in `~/.cursor/mcp.json`. Gemini CLI: the same JSON inside `~/.gemini/settings.json`, key `mcpServers`. Any other MCP client: a stdio server, command `npx`, arguments `-y pivella-mcp --dir /path/to/sync-folder`. No port, no token, no URL.

The folder is the one chosen in Pivella Settings for file sync. It can also come from the `PIVELLA_SYNC_DIR` environment variable; the flag, when present, wins.

Good to know:

- desktop apps such as Claude Desktop do not inherit the terminal `PATH`: if `npx` is not found, use the full path from `which npx`;
- every client starts its own copy of the server; they can run together and alongside the app, because they coordinate through a lock file and each one backs up before writing;
- with more than one profile in the file, the assistant asks which one you are;
- cloud folders (Dropbox, iCloud, Google Drive, OneDrive) are in beta: the server starts and warns; with rare writes it works, but if two devices write close in time the provider can create a conflicted copy that the sync ignores;
- the server keeps its own id in `~/.pivella-mcp/writer-id`.

Changing the folder: register again with the new path and restart the client (in Claude Code, `/mcp` reconnects). For example:

```sh
claude mcp remove pivella -s local
claude mcp add pivella -s local -- npx -y pivella-mcp --dir /new/path
```

In other clients, edit the value after `--dir` in their configuration file. Careful: on the real sync folder the server really writes proposals, with a backup first. To try things out, copy the sync folder somewhere else and pass that copy.

Diagnostics without starting the server:

```sh
npx -y pivella-mcp check --dir /path/to/sync-folder
```

## From the repo, without the package

```sh
npm run mcp -- check --dir /path/to/sync-folder   # diagnostics
npm run mcp -- --dir /path/to/sync-folder         # stdio server (tsx on the sources)
npm run mcp:build                                 # bundle into mcp/dist/cli.js
```

To use the sources instead of the package, in any client, the command is `npx tsx /path/to/repo/mcp/src/bin.ts --dir /path/to/sync-folder`.

## Publishing

`mcp/package.json` is the package: `bin` points to `dist/cli.js`, dependencies are `@modelcontextprotocol/sdk` and `zod`, everything else (the `src/lib/sync` modules included) is in the bundle. From the repo root:

```sh
cd mcp && npm publish
```

`prepublishOnly` runs the bundle on its own. To see what goes into the package without publishing: `npm publish --dry-run`. Bump the version in `mcp/package.json` on every publish.

## Layout

```
mcp/src/datasource.ts       DataSource interface, DataSourceError, pagination
mcp/src/fileDataSource.ts   file implementation: lock, backup, atomic write
mcp/src/tools/shared.ts     tool definition, execution, error mapping
mcp/src/tools/<tool>.ts     one file per tool
mcp/src/tools/propose.ts    factory of the proposal tools
mcp/src/server.ts           tool registration on the MCP Server
mcp/src/cli.ts              startup, check, writer id, cloud folder warning
mcp/src/bin.ts              entry point of the pivella-mcp command
mcp/package.json            the pivella-mcp npm package
```

The modules shared with the app live in `src/lib/sync`: `validate.ts` (proposal rules), `proposals.ts` (lifecycle), `applyProposal.ts` and `proposalFlow.ts` (confirmation in the app), `schema.ts`, `syncFile.ts`, `backup.ts`, `lock.ts`. The full tool contract is in `docs/fattibilita-mcp.md` (Italian).

Tests: `npm test` (node:test via tsx).
