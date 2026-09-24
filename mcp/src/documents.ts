/**
 * File scritti dai tool genera_*: nomi ripuliti, sempre dentro la cartella
 * scelta, creazione esclusiva. Non tocca mai il file di sync.
 */
import { mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const MAX_TENTATIVI = 100;

export function safeFileComponent(value: string): string {
  const out = value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!out) throw new Error(`Nome di file non valido: ${JSON.stringify(value)}`);
  return out;
}

export function documentsDir(syncDir: string, anno: number): string {
  return join(syncDir, 'documenti', String(anno));
}

export async function writeExclusive(dir: string, baseName: string, ext: string, data: Uint8Array | string): Promise<string> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  for (let n = 1; n <= MAX_TENTATIVI; n++) {
    const name = `${baseName}${n === 1 ? '' : `-${n}`}.${ext}`;
    const target = resolve(root, name);
    if (!target.startsWith(root + sep) || name.includes('/') || name.includes('\\')) throw new Error(`Il file ${name} uscirebbe dalla cartella ${root}`);
    try {
      const handle = await open(target, 'wx');
      try { await handle.writeFile(data); } finally { await handle.close(); }
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      // Clean up the file if it was created but the write/close failed
      try { await unlink(target); } catch { /* ignore unlink errors */ }
      throw err;
    }
  }
  throw new Error(`Troppi file con il nome ${baseName}.${ext} in ${root}`);
}
