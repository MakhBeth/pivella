import test from 'node:test';
import assert from 'node:assert/strict';

import { memoryFileSystem, text, fromBytes } from './testing/memoryFileSystem';
import { atomicWrite, sha256Hex } from './atomicWrite';
import {
  BACKUP_DIR,
  BackupError,
  LATEST_FILE,
  SYNC_FILENAME,
  backupBeforeWrite,
  backupFileName,
  parseBackupFileName,
  planRotation,
  rotateBackups,
  writeSyncFile,
} from './backup';

const NOW = new Date('2026-09-12T14:03:22.114Z');

// --- scrittura atomica ------------------------------------------------------

test('atomicWrite uses move when the file system offers it and leaves no .part behind', async () => {
  const fs = memoryFileSystem({ withMove: true });
  const r = await atomicWrite(fs, 'a/b.json', text('hello'));
  assert.equal(r.method, 'move');
  assert.equal(fromBytes(fs.files.get('a/b.json') ?? null), 'hello');
  assert.equal(fs.files.has('a/b.json.part'), false);
  assert.ok(fs.log.includes('move a/b.json.part a/b.json'));
});

test('atomicWrite falls back to direct write plus verification when move is missing', async () => {
  const fs = memoryFileSystem({ withMove: false });
  const r = await atomicWrite(fs, 'a/b.json', text('hello'));
  assert.equal(r.method, 'fallback');
  assert.equal(fromBytes(fs.files.get('a/b.json') ?? null), 'hello');
  assert.equal(fs.files.has('a/b.json.part'), false);
  // il .part è stato scritto, verificato, poi il file finale scritto e verificato
  assert.deepEqual(fs.log.filter((l) => l.startsWith('write')), ['write a/b.json.part', 'write a/b.json']);
});

test('atomicWrite falls back when move rejects with NotAllowedError, as Chrome does on local folders', async () => {
  const fs = memoryFileSystem({ withMove: true });
  fs.move = async () => { throw new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NotAllowedError'); };
  const r = await atomicWrite(fs, 'x.json', text('hello'));
  assert.equal(r.method, 'fallback');
  assert.equal(fromBytes(fs.files.get('x.json') ?? null), 'hello');
  assert.equal(fs.files.has('x.json.part'), false);
});

test('atomicWrite falls back when move rejects with NotSupportedError, and only then', async () => {
  const fs = memoryFileSystem({ withMove: true });
  fs.move = async () => { throw new DOMException('move non supportato qui', 'NotSupportedError'); };
  const r = await atomicWrite(fs, 'x.json', text('hello'));
  assert.equal(r.method, 'fallback');
  assert.equal(fromBytes(fs.files.get('x.json') ?? null), 'hello');
  assert.equal(fs.files.has('x.json.part'), false);

  const fs2 = memoryFileSystem({ withMove: true });
  fs2.move = async () => { throw new DOMException('disco in errore', 'InvalidStateError'); };
  await assert.rejects(atomicWrite(fs2, 'y.json', text('hello')), /disco in errore/);
});

test('atomicWrite rejects a read-back with the same length but a different hash', async () => {
  const fs = memoryFileSystem({ withMove: true });
  const original = fs.read.bind(fs);
  fs.read = async (p) => (p.endsWith('.part') ? text('hellp') : original(p));
  await assert.rejects(atomicWrite(fs, 'x.json', text('hello')), /hash/);
});

test('atomicWrite verifies the bytes read back and fails if they differ', async () => {
  const fs = memoryFileSystem({ withMove: true });
  const original = fs.read.bind(fs);
  fs.read = async (p) => (p.endsWith('.part') ? text('corrupted') : original(p));
  await assert.rejects(atomicWrite(fs, 'x.json', text('hello')), /verifica/);
  assert.equal(fs.files.has('x.json'), false);
});

test('sha256Hex matches a known vector', async () => {
  assert.equal(await sha256Hex(text('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// --- nomi -------------------------------------------------------------------

test('backupFileName encodes timestamp and kind in a file-system safe way', () => {
  assert.equal(backupFileName(NOW, 'mcp'), 'pivella-sync.2026-09-12T14-03-22-114Z.mcp.json');
});

test('parseBackupFileName accepts a collision suffix and keeps the timestamp', () => {
  const parsed = parseBackupFileName('pivella-sync.2026-09-12T14-03-22-114Z-2.app.json');
  assert.deepEqual(parsed, { timestamp: NOW, kind: 'app' });
});

test('parseBackupFileName round-trips and rejects foreign files', () => {
  const parsed = parseBackupFileName('pivella-sync.2026-09-12T14-03-22-114Z.pre-restore.json');
  assert.deepEqual(parsed, { timestamp: NOW, kind: 'pre-restore' });
  assert.equal(parseBackupFileName('latest.json'), null);
  assert.equal(parseBackupFileName('pivella-sync.2026-09-12T14-03-22-114Z.app.json.part'), null);
});

// --- rotazione (pura) -------------------------------------------------------

function names(count: number, start: Date, stepHours: number, kind = 'app'): string[] {
  return Array.from({ length: count }, (_, i) => backupFileName(new Date(start.getTime() - i * stepHours * 3_600_000), kind as 'app'));
}

test('planRotation keeps the 30 most recent regardless of age', () => {
  const list = names(30, NOW, 24 * 5); // uno ogni 5 giorni, fino a 145 giorni fa
  assert.deepEqual(planRotation(list, NOW), []);
});

test('planRotation beyond 30 keeps only the last per day for files older than 24h', () => {
  const recent = names(30, NOW, 1); // ultime 30 ore
  const twoDaysAgo = new Date(NOW.getTime() - 48 * 3_600_000);
  const sameDay = [
    backupFileName(new Date(twoDaysAgo.getTime()), 'app'),
    backupFileName(new Date(twoDaysAgo.getTime() - 3_600_000), 'app'),
    backupFileName(new Date(twoDaysAgo.getTime() - 2 * 3_600_000), 'mcp'),
  ];
  const toDelete = planRotation([...recent, ...sameDay], NOW);
  assert.deepEqual(toDelete.sort(), sameDay.slice(1).sort());
});

test('planRotation beyond 30 keeps files younger than 24h even if many', () => {
  const list = names(40, NOW, 0.5); // ogni 30 minuti, tutte nelle ultime 20 ore
  assert.deepEqual(planRotation(list, NOW), []);
});

test('planRotation deletes everything older than 90 days except protected kinds', () => {
  const recent = names(30, NOW, 1);
  const old = new Date(NOW.getTime() - 100 * 86_400_000);
  const oldApp = backupFileName(old, 'app');
  const oldV1 = backupFileName(new Date(old.getTime() - 86_400_000), 'v1');
  const oldRestore = backupFileName(new Date(old.getTime() - 2 * 86_400_000), 'pre-restore');
  assert.deepEqual(planRotation([...recent, oldApp, oldV1, oldRestore], NOW), [oldApp]);
});

test('planRotation ignores files that are not backups', () => {
  assert.deepEqual(planRotation(['latest.json', 'note.txt', ...names(35, NOW, 48)], NOW).includes('latest.json'), false);
});

// --- backup prima della scrittura ------------------------------------------

test('backupBeforeWrite copies the current sync file, verifies it and records the hash', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('{"v":1}'));
  const r = await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  assert.equal(r.status, 'created');
  const expectedName = `${BACKUP_DIR}/${backupFileName(NOW, 'app')}`;
  assert.equal(r.file, expectedName);
  assert.equal(fromBytes(fs.files.get(expectedName) ?? null), '{"v":1}');
  assert.deepEqual(JSON.parse(fromBytes(fs.files.get(LATEST_FILE) ?? null)!), {
    hash: await sha256Hex(text('{"v":1}')),
    file: backupFileName(NOW, 'app'),
  });
});

test('backupBeforeWrite is skipped when the sync file does not exist yet', async () => {
  const fs = memoryFileSystem({ withMove: true });
  const r = await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  assert.equal(r.status, 'skipped-missing');
  assert.equal(fs.files.size, 0);
});

test('backupBeforeWrite is skipped when the latest backup already has the same hash', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('same'));
  await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  const before = fs.files.size;
  const r = await backupBeforeWrite(fs, { kind: 'mcp', now: new Date(NOW.getTime() + 1000) });
  assert.equal(r.status, 'skipped-identical');
  assert.equal(fs.files.size, before);
});

test('backupBeforeWrite creates a new backup when the latest file points to a backup deleted by hand', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('same'));
  const first = await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  assert.equal(first.status, 'created');
  // L'utente cancella a mano i backup ma lascia latest.json
  await fs.remove(first.file!);
  const second = await backupBeforeWrite(fs, { kind: 'app', now: new Date(NOW.getTime() + 1000) });
  assert.equal(second.status, 'created');
  assert.equal(fromBytes(fs.files.get(second.file!) ?? null), 'same');
});

test('backupBeforeWrite creates a new backup when the latest file is unreadable or malformed', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('same'));
  await fs.write(LATEST_FILE, text('garbage'));
  const r = await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  assert.equal(r.status, 'created');
});

// --- F1 ---
test('backupBeforeWrite ignores a latest file that points outside the backup folder', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('stato'));
  const hash = await sha256Hex(text('stato'));
  await fs.write(LATEST_FILE, text(JSON.stringify({ hash, file: '../pivella-sync.json' })));
  const r = await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  assert.equal(r.status, 'created');
  assert.equal(fromBytes(fs.files.get(r.file!) ?? null), 'stato');
});

// --- F2 ---
test('backupBeforeWrite never overwrites an existing backup with the same timestamp and kind', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('v0'));
  await writeSyncFile(fs, text('v1'), { kind: 'app', now: NOW });
  await writeSyncFile(fs, text('v2'), { kind: 'app', now: NOW });
  const backups = (await fs.list(BACKUP_DIR)).filter((n) => n.startsWith('pivella-sync.')).sort();
  assert.equal(backups.length, 2);
  const contents = backups.map((n) => fromBytes(fs.files.get(`${BACKUP_DIR}/${n}`) ?? null)).sort();
  assert.deepEqual(contents, ['v0', 'v1']);
  for (const n of backups) assert.notEqual(parseBackupFileName(n), null);
});

// --- F3 ---
test('backupBeforeWrite always creates a protected backup even if an identical ordinary one exists', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('same'));
  await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  const r = await backupBeforeWrite(fs, { kind: 'pre-restore', now: new Date(NOW.getTime() + 1000) });
  assert.equal(r.status, 'created');
  assert.ok(r.file!.endsWith('.pre-restore.json'));
  const again = await backupBeforeWrite(fs, { kind: 'v1', now: new Date(NOW.getTime() + 2000) });
  assert.equal(again.status, 'created');
});

// --- F4 ---
test('backupBeforeWrite creates a new backup when latest.json is the JSON literal null', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('same'));
  await fs.write(LATEST_FILE, text('null'));
  assert.equal((await backupBeforeWrite(fs, { kind: 'app', now: NOW })).status, 'created');
});

test('backupBeforeWrite creates a new backup when latest.json cannot be read', async () => {
  const fs = memoryFileSystem({ withMove: true, failRead: (p) => p === LATEST_FILE });
  await fs.write(SYNC_FILENAME, text('same'));
  await fs.write(LATEST_FILE, text('{}'));
  assert.equal((await backupBeforeWrite(fs, { kind: 'app', now: NOW })).status, 'created');
});

test('backupBeforeWrite creates a new backup when the referenced backup cannot be read', async () => {
  const fs = memoryFileSystem({ withMove: true, failRead: (p) => p.startsWith(BACKUP_DIR) && p.endsWith('.app.json') });
  await fs.write(SYNC_FILENAME, text('same'));
  const first = await backupBeforeWrite(fs, { kind: 'mcp', now: NOW });
  assert.equal(first.status, 'created');
  fs.files.set(LATEST_FILE, text(JSON.stringify({ hash: first.hash, file: backupFileName(NOW, 'app') })));
  const second = await backupBeforeWrite(fs, { kind: 'mcp', now: new Date(NOW.getTime() + 1000) });
  assert.equal(second.status, 'created');
});

test('backupBeforeWrite removes stale .part files from a previous failed attempt', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('x'));
  await fs.write(`${BACKUP_DIR}/pivella-sync.2026-09-01T00-00-00-000Z.app.json.part`, text('junk'));
  await backupBeforeWrite(fs, { kind: 'app', now: NOW });
  assert.equal([...fs.files.keys()].some((p) => p.endsWith('.part')), false);
});

test('backupBeforeWrite throws BackupError with the reason when the copy fails', async () => {
  const fs = memoryFileSystem({ withMove: true, failWrite: (p) => p.startsWith(BACKUP_DIR) });
  await fs.write(SYNC_FILENAME, text('x'));
  await assert.rejects(
    backupBeforeWrite(fs, { kind: 'app', now: NOW }),
    (err: unknown) => err instanceof BackupError && err.code === 'BACKUP_FAILED' && /ENOSPC/.test(err.reason)
  );
  assert.equal(fs.files.has(LATEST_FILE), false);
});

// --- scrittura del file di sync --------------------------------------------

test('writeSyncFile: backup is written, verified and published before the sync .part is even created, and rotation runs after publication', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('old'));
  for (const n of names(33, new Date(NOW.getTime() - 86_400_000), 96)) await fs.write(`${BACKUP_DIR}/${n}`, text('b'));
  const r = await writeSyncFile(fs, text('new'), { kind: 'app', now: NOW });
  assert.equal(r.backup.status, 'created');
  assert.equal(fromBytes(fs.files.get(SYNC_FILENAME) ?? null), 'new');
  assert.equal(fromBytes(fs.files.get(r.backup.file!) ?? null), 'old');

  const log = fs.log;
  const idx = (entry: string) => { const i = log.indexOf(entry); assert.ok(i >= 0, `missing log entry: ${entry}`); return i; };
  const backupMove = idx(`move ${r.backup.file}.part ${r.backup.file}`);
  const backupVerifyRead = log.findIndex((l, i) => i < backupMove && l === `read ${r.backup.file}.part`);
  const latestWrite = idx(`write ${LATEST_FILE}`);
  const syncPartWrite = idx(`write ${SYNC_FILENAME}.part`);
  const syncMove = idx(`move ${SYNC_FILENAME}.part ${SYNC_FILENAME}`);
  const firstRotationRemove = log.findIndex((l, i) => i > syncMove && l.startsWith(`remove ${BACKUP_DIR}/`));

  assert.ok(backupVerifyRead >= 0 && backupVerifyRead < backupMove, 'backup .part is re-read before publication');
  assert.ok(backupMove < latestWrite, 'index written after backup publication');
  assert.ok(latestWrite < syncPartWrite, 'sync .part is created only after the backup is fully published');
  assert.ok(syncPartWrite < syncMove, 'sync published after its .part');
  assert.ok(firstRotationRemove > syncMove, 'rotation runs only after the sync file is published');
  assert.ok(r.rotation.deleted.length > 0);
});

test('writeSyncFile does not touch the sync file when backup publication (move) fails', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('old'));
  fs.move = async (from) => { throw new Error(`EIO move ${from}`); };
  await assert.rejects(writeSyncFile(fs, text('new'), { kind: 'app', now: NOW }), BackupError);
  assert.equal(fromBytes(fs.files.get(SYNC_FILENAME) ?? null), 'old');
  assert.equal(fs.log.some((l) => l.includes(`${SYNC_FILENAME}.part`)), false);
});

test('writeSyncFile does not touch the sync file when the index write fails', async () => {
  const fs = memoryFileSystem({ withMove: true, failWrite: (p) => p === LATEST_FILE });
  await fs.write(SYNC_FILENAME, text('old'));
  await assert.rejects(writeSyncFile(fs, text('new'), { kind: 'app', now: NOW }), BackupError);
  assert.equal(fromBytes(fs.files.get(SYNC_FILENAME) ?? null), 'old');
  assert.equal(fs.log.some((l) => l.includes(`${SYNC_FILENAME}.part`)), false);
});

test('writeSyncFile does not touch the sync file at all when the backup fails', async () => {
  const fs = memoryFileSystem({ withMove: true, failWrite: (p) => p.startsWith(BACKUP_DIR) });
  await fs.write(SYNC_FILENAME, text('old'));
  const logBefore = fs.log.length;
  await assert.rejects(writeSyncFile(fs, text('new'), { kind: 'app', now: NOW }), BackupError);
  assert.equal(fromBytes(fs.files.get(SYNC_FILENAME) ?? null), 'old');
  const touched = fs.log.slice(logBefore).filter((l) => (l.startsWith('write') || l.startsWith('move') || l.startsWith('remove')) && l.includes(SYNC_FILENAME));
  assert.deepEqual(touched, []);
});

test('writeSyncFile rotation failures do not fail the write', async () => {
  const fs = memoryFileSystem({ withMove: true });
  await fs.write(SYNC_FILENAME, text('old'));
  // 35 file distanziati di 4 giorni: quelli oltre i 30 hanno più di 90 giorni e vanno cancellati
  for (const n of names(35, new Date(NOW.getTime() - 86_400_000), 96)) await fs.write(`${BACKUP_DIR}/${n}`, text('b'));
  fs.remove = async () => { throw new Error('EPERM'); };
  const r = await writeSyncFile(fs, text('new'), { kind: 'app', now: NOW });
  assert.equal(fromBytes(fs.files.get(SYNC_FILENAME) ?? null), 'new');
  assert.ok(r.rotation.failed.length > 0);
});

test('rotateBackups deletes what planRotation says and reports it', async () => {
  const fs = memoryFileSystem({ withMove: true });
  const list = names(33, NOW, 96); // i 3 oltre i 30 hanno 120, 124 e 128 giorni
  for (const n of list) await fs.write(`${BACKUP_DIR}/${n}`, text('b'));
  const r = await rotateBackups(fs, NOW);
  assert.equal(r.deleted.length, 3);
  assert.equal((await fs.list(BACKUP_DIR)).length, 30);
});
