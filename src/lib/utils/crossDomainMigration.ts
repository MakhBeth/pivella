/**
 * One-shot data migration from the old domain (forfettino.netlify.app).
 *
 * IndexedDB and localStorage are per-origin, so the rename to
 * pivella.netlify.app would strand user data on the old domain. The redirect
 * page hosted there dumps the whole database, gzips it and hands it over in
 * the URL fragment (#pivella-migration=<base64url>); this module imports it
 * before the app boots.
 */

import { DB_NAME, DB_VERSION, STORES } from '../constants/fiscali';

const HASH_PREFIX = '#pivella-migration=';

interface MigrationPayload {
  v: number;
  stores: Record<string, any[]>;
  ls?: {
    theme?: string | null;
    currentUserId?: string | null;
  };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function gunzipToText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function importStores(db: IDBDatabase, stores: Record<string, any[]>): Promise<void> {
  // If this origin has no real data yet, do a clean copy; otherwise merge by id
  // so an already-used Pivella install is never wiped.
  const userDataStores = ['clienti', 'fatture', 'workLogs', 'scadenze'];
  let pristine = true;
  for (const store of userDataStores) {
    const count = await requestToPromise(db.transaction(store).objectStore(store).count());
    if (count > 0) {
      pristine = false;
      break;
    }
  }

  for (const store of STORES) {
    const items = stores[store];
    if (!items) continue;
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    if (pristine) {
      await requestToPromise(objectStore.clear());
    }
    for (const item of items) {
      await requestToPromise(objectStore.put(item));
    }
  }
}

export async function runCrossDomainMigration(): Promise<void> {
  if (!window.location.hash.startsWith(HASH_PREFIX)) return;

  const encoded = window.location.hash.slice(HASH_PREFIX.length);
  history.replaceState(null, '', window.location.pathname + window.location.search);

  try {
    const json = await gunzipToText(base64UrlToBytes(encoded));
    const payload: MigrationPayload = JSON.parse(json);
    if (payload?.v !== 1 || !payload.stores) return;

    const db = await openDB();
    try {
      await importStores(db, payload.stores);
    } finally {
      db.close();
    }

    const { theme, currentUserId } = payload.ls ?? {};
    if (theme && !localStorage.getItem('pivella-theme')) {
      localStorage.setItem('pivella-theme', theme);
    }
    if (currentUserId && !localStorage.getItem('pivella_current_user_id')) {
      localStorage.setItem('pivella_current_user_id', currentUserId);
    }
    console.log('[migration] Dati importati da forfettino.netlify.app');
  } catch (err) {
    console.error('[migration] Importazione dati dal vecchio dominio fallita:', err);
  }
}
