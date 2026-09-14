import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { IndexedDBManager } from '../db/IndexedDBManager';
import { openSyncMetaDb } from '../db/syncMetaDb';
import { BACKUP_DIR, BackupError, SYNC_FILENAME } from './backup';
import { LOCK_FILE } from './lock';
import { listBackups, readBackup, restoreBackupSafely, restoreFromBackup } from './restore';
import { createEmptySnapshot, type Writer } from './schema';
import { fromBytes, memoryFileSystem, text } from './testing/memoryFileSystem';

console.log = () => {};

const T0 = '2026-09-01T00:00:00.000Z';
const NOW = '2026-09-14T10:00:00.000Z';
const APP: Writer = { id: 'app-1', kind: 'app' };
const cliente = (id: string, nome: string) => ({ id, userId: 'u1', nome, updatedAt: T0, updatedBy: 'app-1' });

const V1_NAME = 'pivella-sync.2026-09-01T00-00-00-000Z.v1.json';
const APP_NAME = 'pivella-sync.2026-09-10T12-00-00-000Z.app.json';

async function setup() {
  const factory = new IDBFactory();
  const db = new IndexedDBManager({ factory, now: () => NOW });
  await db.init();
  const fs = memoryFileSystem({ withMove: true });
  const v1 = JSON.stringify({ users: [{ id: 'u1', nome: 'Utente', createdAt: T0 }], config: [], clienti: [cliente('c-v1', 'Dal v1')], fatture: [], workLogs: [], scadenze: [] });
  const v2 = createEmptySnapshot({ now: T0, writer: APP });
  v2.users.push({ id: 'u1', nome: 'Utente', createdAt: T0 } as any);
  v2.clienti.push(cliente('c-app', 'Dal backup app') as any, cliente('c-app-2', 'Secondo') as any);
  await fs.write(`${BACKUP_DIR}/${V1_NAME}`, text(v1));
  await fs.write(`${BACKUP_DIR}/${APP_NAME}`, text(JSON.stringify(v2)));
  await fs.write(`${BACKUP_DIR}/note.txt`, text('non un backup'));
  await fs.write(`${BACKUP_DIR}/latest.json`, text('{}'));
  const current = createEmptySnapshot({ now: NOW, writer: APP });
  current.users.push({ id: 'u1', nome: 'Utente', createdAt: T0 } as any);
  current.clienti.push(cliente('c-now', 'Stato corrente') as any);
  await fs.write(SYNC_FILENAME, text(JSON.stringify(current)));
  await db.put('users', { id: 'u1', nome: 'Utente', createdAt: T0 });
  await db.put('clienti', cliente('c-now', 'Stato corrente'));
  return { factory, db, fs };
}

test('listBackups returns only valid backup names, newest first, with kind, timestamp and size', async () => {
  const { fs } = await setup();
  const list = await listBackups(fs);
  assert.deepEqual(list.map((b) => b.name), [APP_NAME, V1_NAME]);
  assert.equal(list[0].kind, 'app');
  assert.equal(list[1].kind, 'v1');
  assert.equal(list[1].timestamp.toISOString(), T0);
  assert.ok(list[0].size > 0);
});

test('listBackups on a folder without backups returns an empty list', async () => {
  assert.deepEqual(await listBackups(memoryFileSystem()), []);
});

test('readBackup parses v1 and v2 backups and counts records per store and profiles', async () => {
  const { fs } = await setup();
  const v1 = await readBackup(fs, V1_NAME, { now: NOW, writer: APP });
  assert.equal(v1.upgradedFromV1, true);
  assert.equal(v1.counts.clienti, 1);
  assert.deepEqual(v1.users.map((u) => u.nome), ['Utente']);
  const app = await readBackup(fs, APP_NAME, { now: NOW, writer: APP });
  assert.equal(app.upgradedFromV1, false);
  assert.equal(app.counts.clienti, 2);
  assert.equal(app.counts.fatture, 0);
});

test('readBackup rejects a name that is not a backup', async () => {
  const { fs } = await setup();
  await assert.rejects(readBackup(fs, '../pivella-sync.json', { now: NOW, writer: APP }), /non valido/);
  await assert.rejects(readBackup(fs, 'note.txt', { now: NOW, writer: APP }), /non valido/);
});

test('restoreFromBackup backs up the current file as pre-restore, writes the backup with restoredAt and replaces the database', async () => {
  const { db, fs, factory } = await setup();
  const outcome = await restoreFromBackup(fs, db, APP_NAME, { now: () => new Date(NOW) });
  assert.equal(outcome.write.backup.status, 'created');
  assert.match(outcome.write.backup.file!, /\.pre-restore\.json$/);
  const preRestore = JSON.parse(fromBytes(await fs.read(outcome.write.backup.file!))!);
  assert.deepEqual(preRestore.clienti.map((c: any) => c.id), ['c-now'], 'il pre-restore è lo stato che stava per essere sovrascritto');

  const written = JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!);
  assert.equal(written.restoredAt, NOW);
  assert.equal(written.restoredFrom, APP_NAME);
  assert.equal(written.writer.kind, 'restore');
  assert.deepEqual(written.clienti.map((c: any) => c.id).sort(), ['c-app', 'c-app-2']);
  assert.deepEqual(written.tombstones, []);

  assert.deepEqual((await db.getAll('clienti')).map((c) => c.id).sort(), ['c-app', 'c-app-2']);
  assert.equal(await db.getLastRestoreAck(), NOW);
  const meta = await openSyncMetaDb(factory);
  assert.deepEqual(await meta.getTombstones(), []);
  meta.close();
  assert.equal(await fs.read(LOCK_FILE), null);
});

test('restoreFromBackup of a v1 backup upgrades it and restores it the same way', async () => {
  const { db, fs } = await setup();
  await restoreFromBackup(fs, db, V1_NAME, { now: () => new Date(NOW) });
  const written = JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!);
  assert.equal(written.schemaVersion, 2);
  assert.equal(written.restoredFrom, V1_NAME);
  assert.deepEqual((await db.getAll('clienti')).map((c) => c.id), ['c-v1']);
});

test('restoreFromBackup does nothing when the pre-restore backup fails', async () => {
  const { db, fs } = await setup();
  const write = fs.write.bind(fs);
  fs.write = async (path, bytes) => {
    if (path.includes('.pre-restore.json')) throw new Error('ENOSPC');
    return write(path, bytes);
  };
  const before = fromBytes(await fs.read(SYNC_FILENAME));
  await assert.rejects(restoreFromBackup(fs, db, APP_NAME, { now: () => new Date(NOW) }), BackupError);
  assert.equal(fromBytes(await fs.read(SYNC_FILENAME)), before);
  assert.deepEqual((await db.getAll('clienti')).map((c) => c.id), ['c-now']);
  assert.equal(await db.getLastRestoreAck(), null);
  assert.equal(await fs.read(LOCK_FILE), null);
});

// --- F19, F21: ripristino sicuro ---------------------------------------------

test('restoreFromBackup applies the prepare hook, so a v1 backup without profiles gets one', async () => {
  const { db, fs } = await setup();
  const v1NoUsers = JSON.stringify({ users: [], config: [], clienti: [{ id: 'c-old', nome: 'Senza profilo' }], fatture: [], workLogs: [], scadenze: [] });
  const name = 'pivella-sync.2026-08-01T00-00-00-000Z.v1.json';
  await fs.write(`${BACKUP_DIR}/${name}`, text(v1NoUsers));
  await restoreFromBackup(fs, db, name, {
    now: () => new Date(NOW),
    prepare: (s) => ({ ...s, users: [{ id: 'u1', nome: 'Utente', createdAt: T0 } as any], clienti: s.clienti.map((c) => ({ ...c, userId: 'u1' })) }),
  });
  assert.equal((await db.get('clienti', 'c-old')).userId, 'u1');
  assert.deepEqual((await db.getAll('users')).map((u) => u.id), ['u1']);
  assert.equal(JSON.parse(fromBytes(await fs.read(SYNC_FILENAME))!).clienti[0].userId, 'u1');
});

test('restoreBackupSafely first syncs unsynced local edits into the file, so the pre-restore backup keeps them', async () => {
  const { db, fs } = await setup();
  // Modifica locale non ancora nel file di sync.
  await db.put('clienti', { id: 'c-unsynced', userId: 'u1', nome: 'Mai scritto nel file', updatedAt: NOW, updatedBy: 'app-1' });
  // lastModified cresce solo quando il file di sync viene scritto, come su disco.
  let version = 0;
  const write = fs.write.bind(fs);
  fs.write = async (path, bytes) => { if (path === SYNC_FILENAME) version++; return write(path, bytes); };
  const move = fs.move!.bind(fs);
  fs.move = async (from, to) => { if (to === SYNC_FILENAME) version++; return move(from, to); };
  const source = { fs, lastModified: async () => ((await fs.read(SYNC_FILENAME)) ? `current:${version}` : null) };
  const outcome = await restoreBackupSafely(source, db, APP_NAME, { now: () => new Date(NOW) });
  const preRestore = JSON.parse(fromBytes(await fs.read(outcome.write.backup.file!))!);
  assert.ok(preRestore.clienti.some((c: any) => c.id === 'c-unsynced'), 'il pre-restore contiene la modifica locale');
  assert.deepEqual((await db.getAll('clienti')).map((c) => c.id).sort(), ['c-app', 'c-app-2']);
});

test('restoreBackupSafely aborts before touching anything when the preliminary sync cannot write', async () => {
  const { db, fs } = await setup();
  await db.put('clienti', { id: 'c-unsynced', userId: 'u1', nome: 'Mai scritto', updatedAt: NOW, updatedBy: 'app-1' });
  const write = fs.write.bind(fs);
  fs.write = async (path, bytes) => {
    if (path.startsWith(`${BACKUP_DIR}/`)) throw new Error('ENOSPC');
    return write(path, bytes);
  };
  const source = { fs, lastModified: async () => 'current:1' };
  await assert.rejects(restoreBackupSafely(source, db, APP_NAME, { now: () => new Date(NOW) }), BackupError);
  assert.ok((await db.getAll('clienti')).some((c) => c.id === 'c-unsynced'));
  assert.equal(await db.getLastRestoreAck(), null);
});

test('restoreBackupSafely reports a restore applied by the preliminary sync before giving up', async () => {
  const { db, fs } = await setup();
  const pending = createEmptySnapshot({ now: NOW, writer: { id: 'restore-9', kind: 'restore' } });
  pending.users.push({ id: 'u1', nome: 'Utente', createdAt: T0 } as any);
  pending.restoredAt = NOW;
  pending.restoredFrom = 'altro.json';
  await fs.write(SYNC_FILENAME, text(JSON.stringify(pending)));
  let restoredCalls = 0;
  const source = { fs, lastModified: async () => 'current:1' };
  await assert.rejects(restoreBackupSafely(source, db, APP_NAME, { now: () => new Date(NOW), onRestored: () => { restoredCalls++; } }), /ripristino più recente/);
  assert.equal(restoredCalls, 1, 'lo stato React deve sapere che il database è stato rimpiazzato');
});
