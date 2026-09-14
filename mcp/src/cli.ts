/**
 * Avvio del server MCP locale da terminale (13.4, `cli.ts`). L'entry point
 * eseguibile è `bin.ts`, pubblicato come comando `pivella-mcp`.
 *
 *   npx -y pivella-mcp --dir <cartella di sync>        avvia il server su stdio
 *   npx -y pivella-mcp check --dir <cartella di sync>  diagnostica, senza server
 *
 * Dal repo: `npm run mcp -- ...`. La cartella può arrivare anche da
 * `PIVELLA_SYNC_DIR`. Stdout è riservato al protocollo: ogni messaggio umano
 * va su stderr.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { BACKUP_DIR } from '../../src/lib/sync/backup';
import { nodeFileSystem } from '../../src/lib/sync/nodeFileSystem';
import { listBackups } from '../../src/lib/sync/restore';
import { readSyncSnapshot } from '../../src/lib/sync/syncFile';
import { FileDataSource } from './fileDataSource';
import { createServer, SERVER_NAME } from './server';

export type Command = 'serve' | 'check';

export interface CliArgs {
  command: Command;
  dir: string;
}

const USAGE = `Uso: pivella-mcp [serve|check] --dir <cartella di sync>\n  La cartella può arrivare anche da PIVELLA_SYNC_DIR.`;

export function parseArgs(argv: string[], env: Record<string, string | undefined>): CliArgs {
  let command: Command = 'serve';
  let dir = env.PIVELLA_SYNC_DIR;
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    const candidate = rest.shift()!;
    if (candidate !== 'serve' && candidate !== 'check') throw new Error(`Comando sconosciuto: ${candidate}\n${USAGE}`);
    command = candidate;
  }
  while (rest.length > 0) {
    const flag = rest.shift()!;
    if (flag === '--dir') {
      dir = rest.shift();
      if (!dir) throw new Error(`Manca il valore di --dir\n${USAGE}`);
    } else {
      throw new Error(`Opzione sconosciuta: ${flag}\n${USAGE}`);
    }
  }
  if (!dir) throw new Error(`Indica la cartella di sync con --dir o PIVELLA_SYNC_DIR\n${USAGE}`);
  return { command, dir };
}

/**
 * Cartelle cloud (Dropbox, iCloud, Google Drive, OneDrive): supporto in beta
 * per decisione di Davide del 14/9/2026. Il server parte e avvisa: il provider
 * può produrre una "copia in conflitto" se due dispositivi scrivono vicini nel
 * tempo, e quel file la sync non lo vede.
 */
export function isCloudFolder(path: string): boolean {
  return /(^|\/)(Dropbox|Google ?Drive|OneDrive|CloudStorage)(\/|$)|\/Library\/Mobile Documents(\/|$)/i.test(path);
}

export const WRITER_ID_DIR = '.pivella-mcp';
export const WRITER_ID_FILE = 'writer-id';

/** Writer id stabile per installazione, in `~/.pivella-mcp/writer-id` (13.2). */
export async function loadWriterId(home: string = homedir()): Promise<string> {
  const dir = join(home, WRITER_ID_DIR);
  const file = join(dir, WRITER_ID_FILE);
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (/^mcp-[0-9a-f]{8}$/.test(existing)) return existing;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const id = `mcp-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${id}\n`, { encoding: 'utf8', flag: 'w' });
  return id;
}

export const log = (message: string) => process.stderr.write(`[${SERVER_NAME}] ${message}\n`);

export async function check(dir: string, writerId: string, version: string): Promise<void> {
  const fs = nodeFileSystem(dir);
  const read = await readSyncSnapshot(fs, { now: new Date().toISOString(), writer: { id: writerId, kind: 'mcp', version } });
  if (!read) {
    log(`nessun file di sync in ${dir}: apri Pivella, imposta questa cartella in Impostazioni e fai una sync`);
    return;
  }
  const s = read.snapshot;
  log(`file ${read.source === 'legacy' ? 'forfettino-sync.json (v1, verrà migrato alla prima proposta)' : 'pivella-sync.json'}${read.upgradedFromV1 ? ' formato v1' : ` formato v${s.schemaVersion}`}, ultima scrittura ${s.updatedAt} da ${s.writer.id} (${s.writer.kind})`);
  log(`profili: ${s.users.map((u) => `${u.nome} [${u.id}]`).join(', ') || 'nessuno'}`);
  log(`record: ${s.clienti.length} clienti, ${s.fatture.length} fatture, ${s.workLogs.length} giornate, ${s.scadenze.length} scadenze, ${s.tombstones.length} tombstone, ${s.proposals.length} proposte`);
  const backups = await listBackups(fs);
  log(`backup in ${BACKUP_DIR}: ${backups.length}${backups[0] ? `, ultimo ${backups[0].name}` : ''}`);
  log(`writer id: ${writerId}`);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, version: string): Promise<void> {
  const args = parseArgs(argv, env);
  const dir = resolve(args.dir);
  if (isCloudFolder(dir)) {
    log(`attenzione: ${dir} sta in una cartella cloud (Dropbox, iCloud, Google Drive, OneDrive). Supporto in beta: con scritture rare funziona, ma se due dispositivi scrivono vicini nel tempo il provider può creare una copia in conflitto che la sync ignora.`);
  }
  const writerId = await loadWriterId();
  if (args.command === 'check') {
    await check(dir, writerId, version);
    return;
  }
  const ds = new FileDataSource(nodeFileSystem(dir), { writerId, version });
  const server = createServer(ds, { writerId, version });
  await server.connect(new StdioServerTransport());
  log(`in ascolto su stdio, cartella ${dir}, writer ${writerId}`);
}
