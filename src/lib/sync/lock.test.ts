import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCK_FILE, LOCK_STALE_MS, SyncLockedError, acquireLock } from './lock';
import { fromBytes, memoryFileSystem, text } from './testing/memoryFileSystem';

const T0 = Date.parse('2026-09-14T10:00:00.000Z');

function clock(start = T0) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => new Date(t).toISOString(),
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
    sleeps,
  };
}

test('acquireLock writes the lock file with writerId, kind and acquiredAt, and release removes it', async () => {
  const fs = memoryFileSystem();
  const c = clock();
  const lock = await acquireLock(fs, { writerId: 'app-1', kind: 'app', now: c.now, sleep: c.sleep });
  const raw = JSON.parse(fromBytes(await fs.read(LOCK_FILE))!);
  assert.deepEqual(raw, { writerId: 'app-1', kind: 'app', acquiredAt: '2026-09-14T10:00:00.000Z' });
  assert.deepEqual(c.sleeps, [50], 'attende 50 ms e rilegge prima di dichiarare il lock acquisito');
  await lock.release();
  assert.equal(await fs.read(LOCK_FILE), null);
});

test('acquireLock fails with SOURCE_LOCKED when another writer holds a fresh lock', async () => {
  const fs = memoryFileSystem();
  const c = clock();
  await fs.write(LOCK_FILE, text(JSON.stringify({ writerId: 'mcp-9', kind: 'mcp', acquiredAt: c.now() })));
  await assert.rejects(
    acquireLock(fs, { writerId: 'app-1', kind: 'app', now: c.now, sleep: c.sleep, timeoutMs: 3000 }),
    (err: unknown) => err instanceof SyncLockedError && err.code === 'SOURCE_LOCKED',
  );
  const raw = JSON.parse(fromBytes(await fs.read(LOCK_FILE))!);
  assert.equal(raw.writerId, 'mcp-9', 'il lock altrui resta intatto');
});

test('acquireLock takes over a lock older than 10 seconds', async () => {
  const fs = memoryFileSystem();
  const c = clock();
  await fs.write(LOCK_FILE, text(JSON.stringify({ writerId: 'mcp-9', kind: 'mcp', acquiredAt: c.now() })));
  c.advance(LOCK_STALE_MS + 1);
  const lock = await acquireLock(fs, { writerId: 'app-1', kind: 'app', now: c.now, sleep: c.sleep });
  assert.equal(JSON.parse(fromBytes(await fs.read(LOCK_FILE))!).writerId, 'app-1');
  await lock.release();
});

test('acquireLock treats an unreadable lock file as stale', async () => {
  const fs = memoryFileSystem();
  const c = clock();
  await fs.write(LOCK_FILE, text('non json'));
  const lock = await acquireLock(fs, { writerId: 'app-1', kind: 'app', now: c.now, sleep: c.sleep });
  assert.equal(JSON.parse(fromBytes(await fs.read(LOCK_FILE))!).writerId, 'app-1');
  await lock.release();
});

test('acquireLock retries until the other writer releases, within the timeout', async () => {
  const fs = memoryFileSystem();
  const c = clock();
  await fs.write(LOCK_FILE, text(JSON.stringify({ writerId: 'mcp-9', kind: 'mcp', acquiredAt: c.now() })));
  const original = fs.read.bind(fs);
  let reads = 0;
  fs.read = async (path) => {
    if (path === LOCK_FILE && ++reads === 3) await fs.remove(LOCK_FILE);
    return original(path);
  };
  const lock = await acquireLock(fs, { writerId: 'app-1', kind: 'app', now: c.now, sleep: c.sleep });
  assert.equal(JSON.parse(fromBytes(await fs.read(LOCK_FILE))!).writerId, 'app-1');
  await lock.release();
});

test('acquireLock loses the race when the reread shows another writer', async () => {
  const fs = memoryFileSystem();
  const c = clock();
  const original = fs.read.bind(fs);
  let reads = 0;
  fs.read = async (path) => {
    // Alla rilettura dopo i 50 ms il file porta l'id di un altro writer.
    if (path === LOCK_FILE && ++reads === 2) {
      await fs.write(LOCK_FILE, text(JSON.stringify({ writerId: 'mcp-9', kind: 'mcp', acquiredAt: c.now() })));
    }
    return original(path);
  };
  await assert.rejects(
    acquireLock(fs, { writerId: 'app-1', kind: 'app', now: c.now, sleep: c.sleep, timeoutMs: 200 }),
    SyncLockedError,
  );
});
