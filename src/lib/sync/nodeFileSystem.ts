/**
 * Adapter Node `fs` per `SyncFileSystem`. Usato dal server MCP e dai test.
 * `move` è `fs.rename`, atomico sullo stesso file system.
 */
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import type { SyncFileSystem } from './fileSystem';

export function nodeFileSystem(rootDir: string): SyncFileSystem {
  const root = resolve(rootDir);

  const outside = (path: string) => new Error(`Percorso fuori dalla cartella di sync: ${path}`);
  // La root canonica viene ricalcolata a ogni chiamata e confrontata con la
  // prima: se la cartella viene rinominata e al suo posto compare un symlink,
  // ogni operazione si ferma invece di seguire il link fuori dalla cartella.
  let initialRealRoot: string | null = null;
  const realRoot = async (): Promise<string> => {
    const current = await realpath(root);
    initialRealRoot ??= current;
    if (current !== initialRealRoot) throw new Error(`La cartella di sync è stata sostituita: ${root}`);
    return current;
  };

  /**
   * Percorso assoluto confinato nella root. Nessun componente sotto la root
   * può essere un symlink, nemmeno pendente: un link potrebbe far leggere,
   * scrivere o cancellare fuori dalla cartella, o far passare il file di sync
   * per un proprio backup.
   */
  const full = async (path: string): Promise<string> => {
    // Il separatore è solo `/`. Un backslash con semantica Windows farebbe
    // passare `missing\..\x` come un componente unico, nascondendo il `..`.
    if (path.includes('\\')) throw outside(path);
    const lexical = resolve(root, ...path.split('/'));
    if (lexical !== root && !lexical.startsWith(root + sep)) throw outside(path);

    // Nessun `..` in nessuna posizione: la validazione dei componenti sotto
    // deve poter fermarsi al primo inesistente senza che un `..` successivo
    // riporti il percorso su un symlink mai controllato.
    const components = path.split('/').filter((c) => c.length > 0 && c !== '.');
    if (components.some((c) => c === '..')) throw outside(path);

    const base = await realRoot();
    let current = base;
    for (const component of components) {
      current = join(current, component);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error(`Symlink non ammesso nella cartella di sync: ${path}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw err;
      }
    }
    return join(base, ...components);
  };

  return {
    async read(path) {
      try {
        return new Uint8Array(await readFile(await full(path)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async write(path, bytes) {
      const target = await full(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
    async remove(path) {
      await rm(await full(path), { force: true });
    },
    async list(dir) {
      try {
        const entries = await readdir(await full(dir), { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => e.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
    async move(from, to) {
      await rename(await full(from), await full(to));
    },
  };
}

