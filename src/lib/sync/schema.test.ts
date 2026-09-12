import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC_SCHEMA_VERSION,
  SyncSchemaError,
  canonicalJson,
  createEmptySnapshot,
  parseSyncFile,
  serializeSnapshot,
  snapshotsEquivalent,
  upgradeV1,
  type SyncSnapshot,
  type Writer,
} from './schema';

const NOW = '2026-09-12T10:00:00.000Z';
const WRITER: Writer = { id: 'app-test', kind: 'app', version: '0.0.0' };

const V1_FILE = {
  users: [{ id: 'user_1', nome: 'Utente', createdAt: '2026-01-01T00:00:00.000Z' }],
  config: [{ id: 'config_user_1', userId: 'user_1', coefficiente: 78 }],
  clienti: [{ id: '10', userId: 'user_1', nome: 'Acme' }],
  fatture: [],
  workLogs: [{ id: '20', userId: 'user_1', clienteId: '10', data: '2026-09-01', tipo: 'giornata', quantita: 1 }],
  scadenze: [],
};

test('schema version is 2', () => {
  assert.equal(SYNC_SCHEMA_VERSION, 2);
});

test('upgradeV1 wraps a v1 file in a v2 envelope and stamps every record', () => {
  const snap = upgradeV1(V1_FILE, { now: NOW, writer: WRITER });
  assert.equal(snap.schemaVersion, 2);
  assert.equal(snap.updatedAt, NOW);
  assert.deepEqual(snap.writer, WRITER);
  assert.equal(snap.restoredAt, null);
  assert.equal(snap.restoredFrom, null);
  assert.deepEqual(snap.tombstones, []);
  assert.deepEqual(snap.proposals, []);
  for (const store of ['users', 'config', 'clienti', 'fatture', 'workLogs', 'scadenze'] as const) {
    for (const record of snap[store]) {
      assert.equal(record.updatedAt, NOW);
      assert.equal(record.updatedBy, WRITER.id);
    }
  }
  assert.equal(snap.clienti[0].nome, 'Acme');
});

test('upgradeV1 tolerates missing stores', () => {
  const snap = upgradeV1({ clienti: [] }, { now: NOW, writer: WRITER });
  assert.deepEqual(snap.users, []);
  assert.deepEqual(snap.workLogs, []);
});

test('parseSyncFile detects v1 and reports the upgrade', () => {
  const { snapshot, upgradedFromV1 } = parseSyncFile(JSON.stringify(V1_FILE), { now: NOW, writer: WRITER });
  assert.equal(upgradedFromV1, true);
  assert.equal(snapshot.schemaVersion, 2);
});

test('parseSyncFile returns a v2 file untouched', () => {
  const original = createEmptySnapshot({ now: NOW, writer: WRITER });
  original.clienti.push({ id: '1', userId: 'u', nome: 'X', updatedAt: NOW, updatedBy: 'other' });
  const { snapshot, upgradedFromV1 } = parseSyncFile(serializeSnapshot(original), { now: '2027-01-01T00:00:00.000Z', writer: WRITER });
  assert.equal(upgradedFromV1, false);
  assert.deepEqual(snapshot, original);
});

test('parseSyncFile rejects a newer schema version', () => {
  const text = JSON.stringify({ ...createEmptySnapshot({ now: NOW, writer: WRITER }), schemaVersion: 3 });
  assert.throws(
    () => parseSyncFile(text, { now: NOW, writer: WRITER }),
    (err: unknown) => err instanceof SyncSchemaError && err.code === 'SOURCE_UNAVAILABLE' && err.details?.schemaVersion === 3
  );
});

test('parseSyncFile rejects malformed JSON', () => {
  assert.throws(() => parseSyncFile('{not json', { now: NOW, writer: WRITER }), SyncSchemaError);
});

test('canonicalJson sorts keys recursively so equal objects serialize equally', () => {
  const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } });
  const b = canonicalJson({ a: { c: 2, d: [3, { y: 2, z: 1 }] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}');
});

test('snapshotsEquivalent ignores envelope updatedAt and writer but not data', () => {
  const a: SyncSnapshot = createEmptySnapshot({ now: NOW, writer: WRITER });
  const b: SyncSnapshot = createEmptySnapshot({ now: '2027-01-01T00:00:00.000Z', writer: { id: 'mcp-1', kind: 'mcp' } });
  assert.equal(snapshotsEquivalent(a, b), true);
  b.fatture.push({ id: 'f', userId: 'u', clienteId: 'c', clienteNome: 'C', data: '2026-01-01', importo: 1, updatedAt: NOW, updatedBy: 'x' });
  assert.equal(snapshotsEquivalent(a, b), false);
});

test('snapshotsEquivalent ignores record order', () => {
  const a = createEmptySnapshot({ now: NOW, writer: WRITER });
  const b = createEmptySnapshot({ now: NOW, writer: WRITER });
  const r1 = { id: '1', userId: 'u', nome: 'A', updatedAt: NOW, updatedBy: 'x' };
  const r2 = { id: '2', userId: 'u', nome: 'B', updatedAt: NOW, updatedBy: 'x' };
  a.clienti.push(r1, r2);
  b.clienti.push(r2, r1);
  assert.equal(snapshotsEquivalent(a, b), true);
});

test('serializeSnapshot produces pretty JSON that parses back', () => {
  const snap = createEmptySnapshot({ now: NOW, writer: WRITER });
  const text = serializeSnapshot(snap);
  assert.ok(text.includes('\n  "schemaVersion": 2'));
  assert.deepEqual(JSON.parse(text), snap);
});
