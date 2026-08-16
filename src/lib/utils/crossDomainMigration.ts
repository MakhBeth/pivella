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

// Every visit to a legacy origin exports its data and hops to the canonical
// origin via the migration fragment. Set to null to disable the handoff.
const CANONICAL_ORIGIN: string | null = 'https://pivella.it';
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

// "Pristine" = no user data and no saved settings on this origin. `users` is
// deliberately excluded: the app auto-creates a default user on first boot, so
// a lone auto-created user must not block the clean-copy path (clearing it is
// exactly what avoids a duplicate default user after migration).
async function isPristine(db: IDBDatabase): Promise<boolean> {
  const guardedStores = ['clienti', 'fatture', 'workLogs', 'scadenze', 'config'];
  for (const store of guardedStores) {
    const count = await requestToPromise(db.transaction(store).objectStore(store).count());
    if (count > 0) return false;
  }
  return true;
}

// The payload is attacker-craftable: reject anything that is not a plain
// record-per-store export before touching the database.
function isValidPayload(payload: MigrationPayload): boolean {
  if (payload?.v !== 1 || typeof payload.stores !== 'object' || payload.stores === null) {
    return false;
  }
  for (const [store, items] of Object.entries(payload.stores)) {
    if (!(STORES as readonly string[]).includes(store)) return false;
    if (!Array.isArray(items)) return false;
    for (const item of items) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
      const id = (item as Record<string, unknown>).id;
      if (typeof id !== 'string' && typeof id !== 'number') return false;
    }
  }
  return true;
}

function importStores(
  db: IDBDatabase,
  stores: Record<string, any[]>,
  pristine: boolean
): Promise<void> {
  // Clean copy on a pristine origin; merge by id otherwise, so an
  // already-used install is never wiped. A single transaction spanning all
  // stores keeps the import atomic: on any failure nothing is committed.
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...STORES], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Import transaction aborted'));
    for (const store of STORES) {
      const items = stores[store];
      if (!items) continue;
      const objectStore = tx.objectStore(store);
      if (pristine) {
        objectStore.clear();
      }
      for (const item of items) {
        objectStore.put(item);
      }
    }
  });
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

    const ls = {
      theme:
        localStorage.getItem('pivella-theme') ?? localStorage.getItem('forfettino-theme'),
      currentUserId:
        localStorage.getItem('pivella_current_user_id') ??
        localStorage.getItem('forfettino_current_user_id'),
    };

    const hasData = Object.values(stores).some((items) => items.length > 0);
    if (!hasData && !ls.theme && !ls.currentUserId) {
      window.location.replace(CANONICAL_ORIGIN + '/');
      return true;
    }

    const payload: MigrationPayload = { v: 1, stores, ls };
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

function stripMigrationHash(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

export async function runCrossDomainMigration(): Promise<void> {
  if (!window.location.hash.startsWith(HASH_PREFIX)) return;

  const encoded = window.location.hash.slice(HASH_PREFIX.length);

  let payload: MigrationPayload;
  try {
    payload = JSON.parse(await gunzipToText(base64UrlToBytes(encoded)));
  } catch {
    stripMigrationHash();
    return;
  }
  if (!isValidPayload(payload)) {
    console.warn('[migration] Payload di migrazione non valido, scartato.');
    stripMigrationHash();
    return;
  }

  try {
    const db = await openDB();
    let imported = false;
    try {
      const pristine = await isPristine(db);
      // The fragment is attacker-craftable (anyone can link to
      // #pivella-migration=...), so never import without explicit consent.
      const ok = window.confirm(
        pristine
          ? 'Importare in questa installazione di Pivella i dati ricevuti dal vecchio dominio?'
          : 'Sono stati ricevuti dati da migrare dal vecchio dominio, ma questa installazione di Pivella contiene già dei dati.\n\n' +
              'Vuoi unire i dati ricevuti a quelli esistenti? (Le voci con lo stesso id verranno sovrascritte.)'
      );
      if (!ok) {
        console.warn('[migration] Import rifiutato dall’utente, payload scartato.');
        stripMigrationHash();
        return;
      }
      await importStores(db, payload.stores, pristine);
      imported = true;
    } finally {
      db.close();
    }

    if (imported) {
      const { theme, currentUserId } = payload.ls ?? {};
      if (theme && !localStorage.getItem('pivella-theme')) {
        localStorage.setItem('pivella-theme', theme);
      }
      if (currentUserId && !localStorage.getItem('pivella_current_user_id')) {
        localStorage.setItem('pivella_current_user_id', currentUserId);
      }
      // Only a successful import consumes the fragment: on failure it stays
      // in the URL so a reload retries the migration.
      stripMigrationHash();
      console.log('[migration] Dati importati dal vecchio dominio');
    }
  } catch (err) {
    console.error('[migration] Importazione dati dal vecchio dominio fallita:', err);
    window.alert(
      'La migrazione dei dati dal vecchio dominio non è riuscita. Ricarica la pagina per riprovare.'
    );
  }
}
