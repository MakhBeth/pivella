import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { documentsDir, safeFileComponent, writeExclusive } from './documents';

test('safeFileComponent strips path characters and rejects empty results', () => {
  assert.equal(safeFileComponent('12/2026'), '12-2026');
  assert.equal(safeFileComponent('../x'), 'x');
  assert.equal(safeFileComponent('a  b..c'), 'a-b-c');
  assert.throws(() => safeFileComponent('../'));
  assert.throws(() => safeFileComponent(''));
});

test('writeExclusive never overwrites and adds a numeric suffix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  const a = await writeExclusive(dir, 'fattura-cortesia-01-2026', 'pdf', 'uno');
  const b = await writeExclusive(dir, 'fattura-cortesia-01-2026', 'pdf', 'due');
  assert.equal(a, join(dir, 'fattura-cortesia-01-2026.pdf'));
  assert.equal(b, join(dir, 'fattura-cortesia-01-2026-2.pdf'));
  assert.equal(await readFile(a, 'utf8'), 'uno');
});

test('concurrent writes produce distinct files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  const paths = await Promise.all(Array.from({ length: 5 }, (_, i) => writeExclusive(dir, 'x', 'xml', String(i))));
  assert.equal(new Set(paths).size, 5);
  assert.equal((await readdir(dir)).length, 5);
});

test('writeExclusive creates missing folders and refuses names that escape them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  const dir = documentsDir(root, 2026);
  assert.equal(dir, join(root, 'documenti', '2026'));
  const p = await writeExclusive(dir, 'ok', 'xml', 'x');
  assert.ok(p.startsWith(dir + sep));
  await assert.rejects(writeExclusive(dir, `..${sep}fuori`, 'xml', 'x'));
});

test('writeExclusive cleans up files when write fails and next write uses base name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  // Make write fail by passing invalid data type (number instead of string/Uint8Array)
  await assert.rejects(writeExclusive(dir, 'x', 'txt', 123 as unknown as string));
  // Verify no file was left behind
  assert.equal((await readdir(dir)).length, 0);
  // Verify next valid write lands on the base name, not -2
  const p = await writeExclusive(dir, 'x', 'txt', 'valid');
  assert.equal(p, join(dir, 'x.txt'));
  assert.equal(await readFile(p, 'utf8'), 'valid');
});

test('writeExclusive propagates non-EEXIST errors after cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pivella-docs-'));
  // Pass invalid data to trigger write error (not EEXIST)
  await assert.rejects(writeExclusive(dir, 'fail', 'txt', 999 as unknown as string));
  // Verify no files left behind
  assert.equal((await readdir(dir)).length, 0);
});
