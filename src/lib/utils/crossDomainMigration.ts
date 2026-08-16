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

// Set to 'https://pivella.it' once the domain is live: every visit to a legacy
// origin will then export its data and hop to the canonical origin via the
// migration fragment. MUST stay null until the domain actually resolves,
// otherwise users get redirected to a dead site.
const CANONICAL_ORIGIN: string | null = null;
const LEGACY_ORIGINS = [
  'https://pivella.netlify.app',
  'https://forfettino.netlify.app',
  'https://forfettairo.netlify.app',
];

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

async function gzipToBase64Url(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function dumpStores(db: IDBDatabase): Promise<Record<string, any[]>> {
  const stores: Record<string, any[]> = {};
  for (const store of STORES) {
    if (!db.objectStoreNames.contains(store)) continue;
    stores[store] = await requestToPromise(db.transaction(store).objectStore(store).getAll());
  }
  return stores;
}

/**
 * When the app is served from a retired origin, export everything and hop to
 * the canonical origin with the migration fragment. Returns true if a
 * navigation was triggered (the caller should not render the app).
 */
export async function runLegacyOriginHandoff(): Promise<boolean> {
  if (!CANONICAL_ORIGIN || window.location.origin === CANONICAL_ORIGIN) return false;
  if (!LEGACY_ORIGINS.includes(window.location.origin)) return false;

  try {
    const db = await openDB();
    let stores: Record<string, any[]>;
    try {
      stores = await dumpStores(db);
    } finally {
      db.close();
    }

    const hasData = Object.values(stores).some((items) => items.length > 0);
    if (!hasData) {
      window.location.replace(CANONICAL_ORIGIN + '/');
      return true;
    }

    const payload: MigrationPayload = {
      v: 1,
      stores,
      ls: {
        theme:
          localStorage.getItem('pivella-theme') ?? localStorage.getItem('forfettino-theme'),
        currentUserId:
          localStorage.getItem('pivella_current_user_id') ??
          localStorage.getItem('forfettino_current_user_id'),
      },
    };
    const encoded = await gzipToBase64Url(JSON.stringify(payload));
    // Stay well below browser URL limits; huge datasets keep using the old
    // origin, where Export/Import remains available as the manual path.
    if (encoded.length >= 1500000) return false;

    window.location.replace(CANONICAL_ORIGIN + '/' + HASH_PREFIX + encoded);
    return true;
  } catch (err) {
    console.error('[migration] Handoff verso il dominio canonico fallita:', err);
    return false;
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
