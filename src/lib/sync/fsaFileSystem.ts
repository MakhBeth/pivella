/**
 * Adapter File System Access API per `SyncFileSystem` (solo Chromium desktop,
 * come la sync attuale). Non testabile in Node: viene esercitato dall'app.
 *
 * `move` è esposto solo se `FileSystemFileHandle.prototype.move` esiste
 * (feature detection, specifica 13.3); altrimenti `atomicWrite` usa il
 * fallback esplicito.
 */
import type { SyncFileSystem } from './fileSystem';

interface MovableFileHandle extends FileSystemFileHandle {
  move(name: string): Promise<void>;
}

export function fsaSupportsMove(): boolean {
  return typeof FileSystemFileHandle !== 'undefined' && 'move' in FileSystemFileHandle.prototype;
}

export function fsaFileSystem(root: FileSystemDirectoryHandle): SyncFileSystem {
  const split = (path: string): { dirs: string[]; name: string } => {
    const parts = path.split('/').filter((p) => p.length > 0);
    const name = parts.pop();
    if (!name) throw new Error(`Percorso non valido: ${path}`);
    return { dirs: parts, name };
  };

  const directory = async (dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> => {
    let handle = root;
    for (const dir of dirs) {
      try {
        handle = await handle.getDirectoryHandle(dir, { create });
      } catch (err) {
        if (!create && (err as DOMException).name === 'NotFoundError') return null;
        throw err;
      }
    }
    return handle;
  };

  const fs: SyncFileSystem = {
    async read(path) {
      const { dirs, name } = split(path);
      const dir = await directory(dirs, false);
      if (!dir) return null;
      try {
        const file = await (await dir.getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (err) {
        if ((err as DOMException).name === 'NotFoundError') return null;
        throw err;
      }
    },
    async write(path, bytes) {
      const { dirs, name } = split(path);
      const dir = (await directory(dirs, true))!;
      const fileHandle = await dir.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(bytes as BufferSource);
      await writable.close();
    },
    async remove(path) {
      const { dirs, name } = split(path);
      const dir = await directory(dirs, false);
      if (!dir) return;
      try {
        await dir.removeEntry(name);
      } catch (err) {
        if ((err as DOMException).name !== 'NotFoundError') throw err;
      }
    },
    async list(dirPath) {
      const dir = await directory(dirPath.split('/').filter((p) => p.length > 0), false);
      if (!dir) return [];
      const names: string[] = [];
      for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === 'file') names.push(name);
      }
      return names;
    },
  };

  if (fsaSupportsMove()) {
    fs.move = async (from, to) => {
      const src = split(from);
      const dst = split(to);
      if (src.dirs.join('/') !== dst.dirs.join('/')) {
        throw new Error('move supportato solo nella stessa cartella');
      }
      const dir = await directory(src.dirs, false);
      if (!dir) throw new Error(`Cartella non trovata: ${src.dirs.join('/')}`);
      const handle = (await dir.getFileHandle(src.name)) as MovableFileHandle;
      await handle.move(dst.name);
    };
  }

  return fs;
}
