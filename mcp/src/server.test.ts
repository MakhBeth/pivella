import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { SYNC_FILENAME } from '../../src/lib/sync/backup';
import { createEmptySnapshot, parseSyncFile, type Proposal } from '../../src/lib/sync/schema';
import { fromBytes, memoryFileSystem, text } from '../../src/lib/sync/testing/memoryFileSystem';
import { FileDataSource } from './fileDataSource';
import { createServer } from './server';

const T0 = '2026-09-01T00:00:00.000Z';
const NOW = '2026-09-14T10:00:00.000Z';

async function connect() {
  const fs = memoryFileSystem({ withMove: true });
  const s = createEmptySnapshot({ now: T0, writer: { id: 'app-1', kind: 'app' } });
  s.users.push({ id: 'u1', nome: 'Davide', createdAt: T0 });
  s.clienti.push({ id: 'c1', userId: 'u1', nome: 'Acme' });
  await fs.write(SYNC_FILENAME, text(JSON.stringify(s)));
  const ds = new FileDataSource(fs, { writerId: 'mcp-1', now: () => new Date(NOW), lock: { sleep: async () => {}, timeoutMs: 0 } });
  const server = createServer(ds, { writerId: 'mcp-1', version: '0.0.0', now: () => new Date(NOW) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { fs, client, server };
}

test('the server lists the seventeen tools with input schemas and read-only annotations', async () => {
  const { client, server } = await connect();
  const { tools } = await client.listTools();
  assert.equal(tools.length, 17);
  const byName = new Map(tools.map((t) => [t.name, t]));
  assert.equal(byName.get('list_fatture')?.inputSchema.type, 'object');
  assert.ok(byName.get('list_fatture')?.inputSchema.properties && 'userId' in byName.get('list_fatture')!.inputSchema.properties!);
  assert.equal(byName.get('list_users')?.annotations?.readOnlyHint, true);
  assert.equal(byName.get('propose_cliente')?.annotations?.readOnlyHint, false);
  await server.close();
});

test('a tool call returns structured content and a one line text', async () => {
  const { client, server } = await connect();
  const result = await client.callTool({ name: 'list_users', arguments: {} });
  assert.equal(result.isError ?? false, false);
  assert.deepEqual(result.structuredContent, { users: [{ id: 'u1', nome: 'Davide', createdAt: T0 }] });
  const content = result.content as Array<{ type: string; text: string }>;
  assert.equal(content[0].type, 'text');
  assert.match(content[0].text, /Davide/);
  await server.close();
});

test('errors come back as isError with the contract body, never as protocol errors', async () => {
  const { client, server } = await connect();
  const result = await client.callTool({ name: 'get_config', arguments: { userId: 'zz' } });
  assert.equal(result.isError, true);
  const content = result.content as Array<{ type: string; text: string }>;
  const body = JSON.parse(content[0].text);
  assert.equal(body.code, 'USER_NOT_FOUND');
  assert.equal(typeof body.message, 'string');
  const bad = await client.callTool({ name: 'get_config', arguments: { userId: 42 } });
  assert.equal(bad.isError, true);
  assert.equal(JSON.parse((bad.content as Array<{ text: string }>)[0].text).code, 'VALIDATION');
  await server.close();
});

test('proposals record the MCP client name from the handshake', async () => {
  const { fs, client, server } = await connect();
  const result = await client.callTool({ name: 'propose_cliente', arguments: { userId: 'u1', nome: 'Beta', motivazione: 'nuovo' } });
  assert.equal(result.isError ?? false, false);
  const proposal = (result.structuredContent as { proposal: Proposal }).proposal;
  assert.deepEqual(proposal.createdBy, { writerId: 'mcp-1', client: 'test-client' });
  const file = parseSyncFile(fromBytes(fs.files.get(SYNC_FILENAME) ?? null) ?? '', { now: NOW, writer: { id: 'x', kind: 'mcp' } }).snapshot;
  assert.equal(file.proposals[0].createdBy.client, 'test-client');
  await server.close();
});
