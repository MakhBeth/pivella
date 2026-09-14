import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKUP_DIR, LATEST_FILE, SYNC_FILENAME } from './backup';
import { LEGACY_SYNC_FILENAME, readSyncSnapshot, writeSyncSnapshot } from './syncFile';
import { createEmptySnapshot, parseSyncFile, type Writer } from './schema';
import { fromBytes, memoryFileSystem, text } from './testing/memoryFileSystem';

const T0 = '2026-09-01T00:00:00.000Z';
const NOW = '2026-09-14T10:00:00.000Z';
const APP: Writer = { id: 'app-1', kind: 'app' };
const STAMP = { now: NOW, writer: APP };

const v1File = JSON.stringify({ users: [{ id: 'u1', nome: 'Utente', createdAt: T0 }], clienti: [{ id: 'c1', userId: 'u1', nome: 'Cliente' }] });

test('readSyncSnapshot returns null when neither the sync file nor the legacy file exist', async () => {
  const fs = memoryFileSystem();
  assert.equal(await readSyncSnapshot(fs, STAMP), null);
});

test('readSyncSnapshot reads a v2 file and reports source current', async () => {
  const fs = memoryFileSystem();
  const snapshot = createEmptySnapshot({ now: T0, writer: APP });
  snapshot.clienti.push({ id: 'c1', userId: 'u1', nome: 'Cliente', updatedAt: T0, updatedBy: 'app-1' } as any);
  await fs.write(SYNC_FILENAME, text(JSON.stringify(snapshot)));
  const read = (await readSyncSnapshot(fs, STAMP))!;
  assert.equal(read.source, 'current');
  assert.equal(read.upgradedFromV1, false);
  assert.equal(read.snapshot.clienti.length, 1);
});

test('readSyncSnapshot upgrades a v1 file under the current name', async () => {
  const fs = memoryFileSystem();
  await fs.write(SYNC_FILENAME, text(v1File));
  const read = (await readSyncSnapshot(fs, STAMP))!;
  assert.equal(read.source, 'current');
  assert.equal(read.upgradedFromV1, true);
  assert.equal(read.snapshot.schemaVersion, 2);
  assert.equal(read.snapshot.clienti[0].updatedAt, NOW);
});

test('readSyncSnapshot falls back to the legacy forfettino file name', async () => {
  const fs = memoryFileSystem();
  await fs.write(LEGACY_SYNC_FILENAME, text(v1File));
  const read = (await readSyncSnapshot(fs, STAMP))!;
  assert.equal(read.source, 'legacy');
  assert.equal(read.upgradedFromV1, true);
  assert.equal(read.snapshot.users.length, 1);
});

test('readSyncSnapshot prefers the current file over the legacy one', async () => {
  const fs = memoryFileSystem();
  await fs.write(LEGACY_SYNC_FILENAME, text(v1File));
  await fs.write(SYNC_FILENAME, text(JSON.stringify(createEmptySnapshot({ now: T0, writer: APP }))));
  const read = (await readSyncSnapshot(fs, STAMP))!;
  assert.equal(read.source, 'current');
  assert.equal(read.snapshot.users.length, 0);
});

test('writeSyncSnapshot stamps the envelope, prunes, backs up the previous file with kind app and round-trips', async () => {
  const fs = memoryFileSystem({ withMove: true });
  const previous = createEmptySnapshot({ now: T0, writer: APP });
  await fs.write(SYNC_FILENAME, text(JSON.stringify(previous)));
  const before = await readSyncSnapshot(fs, STAMP);

  const next = createEmptySnapshot({ now: T0, writer: { id: 'mcp-1', kind: 'mcp' } });
  next.clienti.push({ id: 'c1', userId: 'u1', nome: 'Cliente', updatedAt: T0, updatedBy: 'app-1' } as any);
  // Tombstone di un anno fa: la potatura lo toglie prima di serializzare.
  next.tombstones.push({ store: 'fatture', id: 'f-old', deletedAt: '2025-01-01T00:00:00.000Z', deletedBy: 'app-1' });
  next.tombstones.push({ store: 'fatture', id: 'f-new', deletedAt: T0, deletedBy: 'app-1' });

  const result = await writeSyncSnapshot(fs, next, { now: new Date(NOW), writer: APP, previous: before });
  assert.equal(result.backup.status, 'created');
  assert.match(result.backup.file!, /\.app\.json$/);

  const written = parseSyncFile(fromBytes(await fs.read(SYNC_FILENAME))!, STAMP).snapshot;
  assert.equal(written.updatedAt, NOW);
  assert.deepEqual(written.writer, APP);
  assert.deepEqual(written.tombstones.map((t) => t.id), ['f-new']);
  assert.equal(written.clienti[0].nome, 'Cliente');
  assert.equal(next.tombstones.length, 2, 'lo snapshot passato non viene mutato');
});

test('writeSyncSnapshot over a v1 file keeps the original with kind v1', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text(v1File));
  const previous = await readSyncSnapshot(fs, STAMP);
  const result = await writeSyncSnapshot(fs, previous!.snapshot, { now: new Date(NOW), writer: APP, previous });
  assert.equal(result.backup.status, 'created');
  assert.match(result.backup.file!, /\.v1\.json$/);
  assert.equal(fromBytes(await fs.read(result.backup.file!)), v1File, 'byte esatti del file v1');
  assert.equal(JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!).schemaVersion, 2);
});

test('writeSyncSnapshot over a legacy-named file keeps it as v1 backup, writes the new name and leaves the legacy file untouched', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(LEGACY_SYNC_FILENAME, text(v1File));
  const previous = await readSyncSnapshot(fs, STAMP);
  const result = await writeSyncSnapshot(fs, previous!.snapshot, { now: new Date(NOW), writer: APP, previous });
  assert.equal(result.backup.status, 'created');
  assert.match(result.backup.file!, /\.v1\.json$/);
  assert.equal(fromBytes(await fs.read(result.backup.file!)), v1File);
  assert.equal(JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!).schemaVersion, 2);
  assert.equal(fromBytes(await fs.read(LEGACY_SYNC_FILENAME)), v1File);
  assert.ok((await fs.list(BACKUP_DIR)).includes(result.backup.file!.replace(`${BACKUP_DIR}/`, '')));
  assert.notEqual(await fs.read(LATEST_FILE), null);
});

test('writeSyncSnapshot on first sync creates the file without a backup', async () => {
  const fs = memoryFileSystem({ withMove: true });
  const result = await writeSyncSnapshot(fs, createEmptySnapshot(STAMP), { now: new Date(NOW), writer: APP, previous: null });
  assert.equal(result.backup.status, 'skipped-missing');
  assert.equal(JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!).schemaVersion, 2);
});

test('writeSyncSnapshot does not touch the sync file when the backup fails', async () => {
  const fs = memoryFileSystem({ withMove: true, failWrite: (p) => p.startsWith(`${BACKUP_DIR}/`) });
  const previous = createEmptySnapshot({ now: T0, writer: APP });
  await fs.write(SYNC_FILENAME, text(JSON.stringify(previous)));
  const before = await readSyncSnapshot(fs, STAMP);
  const next = createEmptySnapshot(STAMP);
  next.clienti.push({ id: 'c1', userId: 'u1', nome: 'X', updatedAt: NOW, updatedBy: 'app-1' } as any);
  await assert.rejects(writeSyncSnapshot(fs, next, { now: new Date(NOW), writer: APP, previous: before }), /Backup non riuscito/);
  assert.equal(fromBytes(await fs.read(SYNC_FILENAME)), JSON.stringify(previous));
});
