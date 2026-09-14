import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCloudFolder, loadWriterId, parseArgs } from './cli';

test('parseArgs reads the command and the sync folder from flags or environment', () => {
  assert.deepEqual(parseArgs(['serve', '--dir', '/tmp/sync'], {}), { command: 'serve', dir: '/tmp/sync' });
  assert.deepEqual(parseArgs(['--dir', '/tmp/sync'], {}), { command: 'serve', dir: '/tmp/sync' });
  assert.deepEqual(parseArgs(['check'], { PIVELLA_SYNC_DIR: '/env/sync' }), { command: 'check', dir: '/env/sync' });
  assert.deepEqual(parseArgs(['--dir', '/flag'], { PIVELLA_SYNC_DIR: '/env/sync' }), { command: 'serve', dir: '/flag' });
});

test('parseArgs rejects unknown commands, unknown flags and a missing folder', () => {
  assert.throws(() => parseArgs(['restore'], {}), /Comando sconosciuto/);
  assert.throws(() => parseArgs(['serve', '--web'], {}), /Opzione sconosciuta/);
  assert.throws(() => parseArgs(['serve'], {}), /cartella di sync/);
});

test('isCloudFolder recognises Dropbox, iCloud, Google Drive and OneDrive paths', () => {
  assert.equal(isCloudFolder('/Users/x/Dropbox/pivella'), true);
  assert.equal(isCloudFolder('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/pivella'), true);
  assert.equal(isCloudFolder('/Users/x/Library/CloudStorage/GoogleDrive-x@gmail.com/My Drive/p'), true);
  assert.equal(isCloudFolder('/Users/x/Google Drive/p'), true);
  assert.equal(isCloudFolder('/Users/x/OneDrive/p'), true);
  assert.equal(isCloudFolder('/Users/x/Documents/pivella-sync'), false);
});

test('loadWriterId creates an mcp- id once and reuses it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pivella-mcp-home-'));
  try {
    const first = await loadWriterId(home);
    assert.match(first, /^mcp-[0-9a-f]{8}$/);
    assert.equal((await readFile(join(home, '.pivella-mcp', 'writer-id'), 'utf8')).trim(), first);
    assert.equal(await loadWriterId(home), first);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
