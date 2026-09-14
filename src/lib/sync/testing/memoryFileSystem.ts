import type { SyncFileSystem } from '../fileSystem';

export interface MemoryFileSystemOptions {
  withMove?: boolean;
  /** Fa fallire ogni write il cui percorso soddisfa il predicato. */
  failWrite?: (path: string) => boolean;
  /** Fa fallire ogni read il cui percorso soddisfa il predicato. */
  failRead?: (path: string) => boolean;
}

export interface MemoryFileSystem extends SyncFileSystem {
  files: Map<string, Uint8Array>;
  log: string[];
}

/** File system in memoria per i test. Mai usato in produzione. */
export function memoryFileSystem(options: MemoryFileSystemOptions = {}): MemoryFileSystem {
  const files = new Map<string, Uint8Array>();
  const log: string[] = [];
  const fs: MemoryFileSystem = {
    files,
    log,
    async read(path) {
      log.push(`read ${path}`);
      if (options.failRead?.(path)) throw new Error(`EIO read ${path}`);
      const bytes = files.get(path);
      return bytes ? new Uint8Array(bytes) : null;
    },
    async write(path, bytes) {
      log.push(`write ${path}`);
      if (options.failWrite?.(path)) throw new Error(`ENOSPC write ${path}`);
      files.set(path, new Uint8Array(bytes));
    },
    async remove(path) {
      log.push(`remove ${path}`);
      files.delete(path);
    },
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length));
    },
  };
  if (options.withMove) {
    fs.move = async (from, to) => {
      log.push(`move ${from} ${to}`);
      const bytes = files.get(from);
      if (!bytes) throw new Error(`ENOENT move ${from}`);
      files.set(to, bytes);
      files.delete(from);
    };
  }
  return fs;
}

export const text = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromBytes = (b: Uint8Array | null): string | null => (b ? new TextDecoder().decode(b) : null);
