import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC_SCHEMA_VERSION,
  SyncSchemaError,
  canonicalJson,
  compareInstants,
  createEmptySnapshot,
  instantOf,
  tombstoneTimestamp,
  parseSyncFile,
  serializeSnapshot,
  snapshotsEquivalent,
  upgradeV1,
  type SyncSnapshot,
  type Writer,
} from './schema';

const NOW = '2026-09-12T10:00:00.000Z';
const WRITER: Writer = { id: 'app-test', kind: 'app', version: '0.0.0' };
const STAMP = { now: NOW, writer: WRITER };

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

// --- F11: struttura v2 validata ---------------------------------------------

test('parseSyncFile rejects a v2 file whose store is not an array', () => {
  const text = JSON.stringify({ ...createEmptySnapshot({ now: NOW, writer: WRITER }), fatture: { id: 'x' } });
  assert.throws(
    () => parseSyncFile(text, { now: NOW, writer: WRITER }),
    (err: unknown) => err instanceof SyncSchemaError && err.details?.store === 'fatture'
  );
});

test('parseSyncFile rejects a record without a string id', () => {
  const text = JSON.stringify({ ...createEmptySnapshot({ now: NOW, writer: WRITER }), clienti: [{ nome: 'senza id' }] });
  assert.throws(() => parseSyncFile(text, { now: NOW, writer: WRITER }), SyncSchemaError);
});

test('parseSyncFile rejects duplicate ids inside a store', () => {
  const snap = createEmptySnapshot({ now: NOW, writer: WRITER });
  snap.clienti.push({ id: 'dup', userId: 'u', nome: 'A', updatedAt: T('01') }, { id: 'dup', userId: 'u', nome: 'B', updatedAt: T('02') });
  assert.throws(
    () => parseSyncFile(serializeSnapshot(snap), { now: NOW, writer: WRITER }),
    (err: unknown) => err instanceof SyncSchemaError && err.details?.store === 'clienti' && err.details?.id === 'dup'
  );
});

test('upgradeV1 rejects duplicate ids too', () => {
  assert.throws(() => upgradeV1({ fatture: [{ id: 'a' }, { id: 'a' }] }, { now: NOW, writer: WRITER }), SyncSchemaError);
});

// --- F6: confronto per istante, non per stringa -----------------------------

function T(day: string): string {
  return `2026-09-${day}T00:00:00.000Z`;
}

test('instantOf parses ISO strings with and without milliseconds and with offsets', () => {
  assert.equal(instantOf('2026-09-01T10:00:00Z'), Date.parse('2026-09-01T10:00:00.000Z'));
  assert.equal(instantOf('2026-09-01T12:00:00+02:00'), Date.parse('2026-09-01T10:00:00.000Z'));
});

test('instantOf treats missing or invalid timestamps as the epoch', () => {
  assert.equal(instantOf(undefined), 0);
  assert.equal(instantOf('not a date'), 0);
});

test('compareInstants orders 10:00:00Z before 10:00:00.500Z', () => {
  assert.ok(compareInstants('2026-09-01T10:00:00Z', '2026-09-01T10:00:00.500Z') < 0);
  assert.ok(compareInstants('2026-09-01T10:00:00.500Z', '2026-09-01T10:00:00Z') > 0);
  assert.equal(compareInstants('2026-09-01T10:00:00Z', '2026-09-01T10:00:00.000Z'), 0);
});

// --- F13: deletedAt strettamente maggiore dell'updatedAt del record ---------

test('tombstoneTimestamp returns now when now is later than the record', () => {
  assert.equal(tombstoneTimestamp('2026-09-02T00:00:00.000Z', { updatedAt: '2026-09-01T00:00:00.000Z' }), '2026-09-02T00:00:00.000Z');
});

test('tombstoneTimestamp adds one millisecond when the record has the same or a later timestamp', () => {
  assert.equal(tombstoneTimestamp('2026-09-01T00:00:00.000Z', { updatedAt: '2026-09-01T00:00:00.000Z' }), '2026-09-01T00:00:00.001Z');
  assert.equal(tombstoneTimestamp('2026-09-01T00:00:00.000Z', { updatedAt: '2026-09-01T00:00:00.250Z' }), '2026-09-01T00:00:00.251Z');
  assert.equal(tombstoneTimestamp('2026-09-01T00:00:00.000Z', {}), '2026-09-01T00:00:00.000Z');
});

test('parseSyncFile rejects a v2 file with a null or missing store', () => {
  const base = createEmptySnapshot({ now: NOW, writer: WRITER });
  assert.throws(
    () => parseSyncFile(JSON.stringify({ ...base, fatture: null }), { now: NOW, writer: WRITER }),
    (err: unknown) => err instanceof SyncSchemaError && err.details?.store === 'fatture'
  );
  const { fatture: _omitted, ...missing } = base;
  void _omitted;
  assert.throws(
    () => parseSyncFile(JSON.stringify(missing), { now: NOW, writer: WRITER }),
    (err: unknown) => err instanceof SyncSchemaError && err.details?.store === 'fatture'
  );
});

test('parseSyncFile rejects a v2 file whose proposals are malformed', () => {
  const snapshot = createEmptySnapshot(STAMP);
  const file = { ...snapshot, proposals: [{ id: 'p1', kind: 'workLog' }] };
  assert.throws(() => parseSyncFile(JSON.stringify(file), STAMP), (err: unknown) => {
    return err instanceof SyncSchemaError && err.code === 'SOURCE_UNAVAILABLE' && err.details?.proposal === 'p1';
  });
});

test('parseSyncFile rejects a v2 file whose tombstones are malformed', () => {
  const snapshot = createEmptySnapshot(STAMP);
  const file = { ...snapshot, tombstones: [{ store: 'clienti', id: 'c1' }] };
  assert.throws(() => parseSyncFile(JSON.stringify(file), STAMP), (err: unknown) => {
    return err instanceof SyncSchemaError && err.code === 'SOURCE_UNAVAILABLE' && err.details?.tombstone === 'clienti/c1';
  });
});

test('parseSyncFile keeps well formed proposals and tombstones', () => {
  const snapshot = createEmptySnapshot(STAMP);
  const proposal = {
    id: 'p1', userId: 'u1', kind: 'workLog', payload: { clienteId: 'c1' }, status: 'pending',
    createdAt: NOW, updatedAt: NOW, expiresAt: NOW, createdBy: { writerId: 'mcp-1' }, result: null, rejectReason: null,
  };
  const tombstone = { store: 'clienti', id: 'c1', deletedAt: NOW, deletedBy: 'app-1' };
  const file = { ...snapshot, proposals: [proposal], tombstones: [tombstone] };
  const parsed = parseSyncFile(JSON.stringify(file), STAMP).snapshot;
  assert.deepEqual(parsed.proposals, [proposal]);
  assert.deepEqual(parsed.tombstones, [tombstone]);
});
