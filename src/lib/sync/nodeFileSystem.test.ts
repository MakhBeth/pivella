import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFileSystem } from './nodeFileSystem';
import { BACKUP_DIR, BackupError, SYNC_FILENAME, writeSyncFile } from './backup';
import { createEmptySnapshot, parseSyncFile, serializeSnapshot } from './schema';

// Tutti i test lavorano solo in una directory temporanea creata ad hoc.
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pivella-sync-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const enc = (s: string) => new TextEncoder().encode(s);

test('node adapter offers move, so atomic writes use rename', async () => {
  await withTempDir(async (dir) => {
    const fs = nodeFileSystem(dir);
    assert.equal(typeof fs.move, 'function');
  });
});

test('node adapter: read returns null for missing files and list returns [] for missing dirs', async () => {
  await withTempDir(async (dir) => {
    const fs = nodeFileSystem(dir);
    assert.equal(await fs.read('nope.json'), null);
    assert.deepEqual(await fs.list('nope'), []);
    await fs.remove('nope.json'); // non deve lanciare
  });
});

test('end to end on disk: first write has no backup, second write backs up the first', async () => {
  await withTempDir(async (dir) => {
    const fs = nodeFileSystem(dir);
    const writer = { id: 'app-test', kind: 'app' as const };
    const v1 = serializeSnapshot(createEmptySnapshot({ now: '2026-09-01T00:00:00.000Z', writer }));
    const v2 = serializeSnapshot(createEmptySnapshot({ now: '2026-09-02T00:00:00.000Z', writer }));

    const first = await writeSyncFile(fs, enc(v1), { kind: 'app', now: new Date('2026-09-01T00:00:00.000Z') });
    assert.equal(first.backup.status, 'skipped-missing');
    assert.equal(first.write.method, 'move');
    assert.equal(await readFile(join(dir, SYNC_FILENAME), 'utf8'), v1);

    const second = await writeSyncFile(fs, enc(v2), { kind: 'mcp', now: new Date('2026-09-02T00:00:00.000Z') });
    assert.equal(second.backup.status, 'created');
    assert.equal(await readFile(join(dir, SYNC_FILENAME), 'utf8'), v2);
    const backups = (await readdir(join(dir, BACKUP_DIR))).filter((n) => n.startsWith('pivella-sync.'));
    assert.deepEqual(backups, ['pivella-sync.2026-09-02T00-00-00-000Z.mcp.json']);
    assert.equal(await readFile(join(dir, BACKUP_DIR, backups[0]), 'utf8'), v1);
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith('.part')), []);

    // Il backup è un file di sync valido e ripristinabile
    const parsed = parseSyncFile(await readFile(join(dir, BACKUP_DIR, backups[0]), 'utf8'), { now: 'x', writer });
    assert.equal(parsed.upgradedFromV1, false);
  });
});

test('end to end on disk: when the backup cannot be written the sync file is untouched', async () => {
  await withTempDir(async (dir) => {
    const fs = nodeFileSystem(dir);
    await writeFile(join(dir, SYNC_FILENAME), 'ORIGINALE');
    // Un file al posto della cartella dei backup rende impossibile crearla
    await writeFile(join(dir, BACKUP_DIR), 'non sono una cartella');
    await assert.rejects(
      writeSyncFile(fs, enc('NUOVO'), { kind: 'app', now: new Date() }),
      (err: unknown) => err instanceof BackupError
    );
    assert.equal(await readFile(join(dir, SYNC_FILENAME), 'utf8'), 'ORIGINALE');
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith('.part')), []);
  });
});

test('node adapter list ignores subdirectories', async () => {
  await withTempDir(async (dir) => {
    const fs = nodeFileSystem(dir);
    await mkdir(join(dir, BACKUP_DIR, 'sub'), { recursive: true });
    await fs.write(`${BACKUP_DIR}/a.json`, enc('a'));
    assert.deepEqual(await fs.list(BACKUP_DIR), ['a.json']);
  });
});
