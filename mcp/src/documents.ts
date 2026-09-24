/**
 * File scritti dai tool genera_*: nomi ripuliti, sempre dentro la cartella
 * scelta, creazione esclusiva. Non tocca mai il file di sync.
 */
import { mkdir, open, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_TENTATIVI = 100;

export function safeFileComponent(value: string): string {
  const out = value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!out) throw new Error(`Nome di file non valido: ${JSON.stringify(value)}`);
  return out;
}

export function documentsDir(syncDir: string, anno: number): string {
  return join(syncDir, 'documenti', String(anno));
}

/** Espande un `~` o `~/...` iniziale con la home passata; lascia invariato il resto. */
export function resolveCartella(cartella: string, homedir: string): string {
  if (cartella === '~') return homedir;
  if (cartella.startsWith('~/')) return join(homedir, cartella.slice(2));
  return cartella;
}

/** Vero se `target` non ricade dentro `root` (fuori, uguale a root, o un percorso assoluto/relativo che scappa). Funziona anche con `root` = `/`. */
export function isFuoriDaCartella(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export async function writeExclusive(dir: string, baseName: string, ext: string, data: Uint8Array | string): Promise<string> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  for (let n = 1; n <= MAX_TENTATIVI; n++) {
    const name = `${baseName}${n === 1 ? '' : `-${n}`}.${ext}`;
    const target = resolve(root, name);
    if (isFuoriDaCartella(root, target) || name.includes('/') || name.includes('\\')) throw new Error(`Il file ${name} uscirebbe dalla cartella ${root}`);
    let handle;
    try {
      handle = await open(target, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      // L'apertura stessa è fallita: non abbiamo creato nulla, niente da ripulire.
      throw err;
    }
    try {
      await handle.writeFile(data);
      await handle.close();
      return target;
    } catch (err) {
      await handle.close().catch(() => { /* ignore close errors */ });
      // Il file è stato creato dall'apertura esclusiva ma la scrittura è fallita: va ripulito.
      try { await unlink(target); } catch { /* ignore unlink errors */ }
      throw err;
    }
  }
  throw new Error(`Troppi file con il nome ${baseName}.${ext} in ${root}`);
}
