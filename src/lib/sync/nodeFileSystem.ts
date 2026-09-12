/**
 * Adapter Node `fs` per `SyncFileSystem`. Usato dal server MCP e dai test.
 * `move` è `fs.rename`, atomico sullo stesso file system.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import type { SyncFileSystem } from './fileSystem';

export function nodeFileSystem(rootDir: string): SyncFileSystem {
  const root = resolve(rootDir);

  const full = (path: string): string => {
    const target = resolve(root, ...path.split('/'));
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Percorso fuori dalla cartella di sync: ${path}`);
    }
    return target;
  };

  return {
    async read(path) {
      try {
        return new Uint8Array(await readFile(full(path)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async write(path, bytes) {
      const target = full(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
    async remove(path) {
      await rm(full(path), { force: true });
    },
    async list(dir) {
      try {
        const entries = await readdir(full(dir), { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => e.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
    async move(from, to) {
      await rename(full(from), full(to));
    },
  };
}

