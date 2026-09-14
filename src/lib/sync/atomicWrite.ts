/**
 * Scrittura atomica e verificata (specifica 13.3): `.part`, rilettura e
 * confronto di lunghezza e SHA-256, poi `move` se disponibile, altrimenti
 * fallback esplicito con seconda scrittura verificata.
 */
import type { SyncFileSystem } from './fileSystem';

export type AtomicWriteMethod = 'move' | 'fallback';

export interface AtomicWriteResult {
  method: AtomicWriteMethod;
  hash: string;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function atomicWrite(fs: SyncFileSystem, path: string, bytes: Uint8Array): Promise<AtomicWriteResult> {
  const part = `${path}.part`;
  const hash = await sha256Hex(bytes);

  await fs.write(part, bytes);
  try {
    await verify(fs, part, bytes.byteLength, hash);
  } catch (err) {
    await fs.remove(part).catch(() => undefined);
    throw err;
  }

  if (typeof fs.move === 'function') {
    try {
      await fs.move(part, path);
      return { method: 'move', hash };
    } catch (err) {
      // Feature detection sul prototipo non basta: Chromium espone move() e
      // sui file locali lo rifiuta, a volte con NotSupportedError, a volte con
      // NotAllowedError ("not allowed by the user agent or the platform in the
      // current context", visto il 14/9/2026). Entrambi attivano il fallback:
      // se fosse davvero un permesso mancante, anche la scrittura diretta
      // fallirebbe con lo stesso errore, e quello resta un errore.
      if (!isMoveRefused(err)) throw err;
    }
  }

  await fs.write(path, bytes);
  await verify(fs, path, bytes.byteLength, hash);
  await fs.remove(part);
  return { method: 'fallback', hash };
}

async function verify(fs: SyncFileSystem, path: string, length: number, hash: string): Promise<void> {
  const readBack = await fs.read(path);
  if (!readBack) throw new Error(`Scrittura non riuscita, verifica fallita: ${path} non trovato dopo la scrittura`);
  if (readBack.byteLength !== length) {
    throw new Error(`Scrittura non riuscita, verifica fallita: ${path} lunghezza ${readBack.byteLength}, attesa ${length}`);
  }
  const actual = await sha256Hex(readBack);
  if (actual !== hash) throw new Error(`Scrittura non riuscita, verifica fallita: ${path} hash diverso`);
}

function isMoveRefused(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null ? (err as { name?: string }).name : undefined;
  return name === 'NotSupportedError' || name === 'NotAllowedError';
}
