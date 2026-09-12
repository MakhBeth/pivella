/**
 * Database IndexedDB separato `PivellaSyncMeta` (specifica 13.8).
 *
 * Contiene ciò che serve alla sync v2 e non ai dati di dominio: tombstone,
 * writer id, ultimo ripristino riconosciuto, log conflitti. Esiste come
 * database a parte per non alzare la versione di `ForfettarioDB`, il cui
 * percorso di apertura cancella e ricrea il database su blocco o timeout.
 *
 * Accetta un `IDBFactory` esplicito così i test usano un'implementazione in
 * memoria e non toccano mai un database reale.
 */
import type { StoreName } from '../../types';
import type { Conflict } from '../sync/merge';
import type { Tombstone } from '../sync/schema';

export const SYNC_META_DB_NAME = 'PivellaSyncMeta';
export const SYNC_META_DB_VERSION = 1;
export const CONFLICT_LOG_LIMIT = 200;

const TOMBSTONES = 'tombstones';
const META = 'meta';

export type MetaKey = 'writerId' | 'lastRestoreAck' | 'conflicts' | 'orphans';

export interface TombstoneKey {
  store: StoreName;
  id: string;
}

export interface SyncMetaDb {
  readonly raw: IDBDatabase;
  close(): void;
  addTombstone(tombstone: Tombstone): Promise<void>;
  getTombstones(): Promise<Tombstone[]>;
  removeTombstones(keys: TombstoneKey[]): Promise<void>;
  replaceTombstones(tombstones: Tombstone[]): Promise<void>;
  getMeta<T = unknown>(key: MetaKey): Promise<T | undefined>;
  setMeta(key: MetaKey, value: unknown): Promise<void>;
  getWriterId(): Promise<string>;
  appendConflicts(conflicts: Conflict[]): Promise<void>;
  getConflicts(): Promise<Conflict[]>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transazione annullata'));
  });
}

export function openSyncMetaDb(factory: IDBFactory = globalThis.indexedDB): Promise<SyncMetaDb> {
  return new Promise((resolve, reject) => {
    const open = factory.open(SYNC_META_DB_NAME, SYNC_META_DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(TOMBSTONES)) {
        db.createObjectStore(TOMBSTONES, { keyPath: ['store', 'id'] });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error(`Apertura di ${SYNC_META_DB_NAME} bloccata`));
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(wrap(db));
    };
  });
}

function wrap(db: IDBDatabase): SyncMetaDb {
  const readMeta = async <T,>(key: MetaKey): Promise<T | undefined> => {
    const tx = db.transaction(META, 'readonly');
    const row = (await request(tx.objectStore(META).get(key))) as { key: MetaKey; value: T } | undefined;
    return row?.value;
  };

  const writeMeta = async (key: MetaKey, value: unknown): Promise<void> => {
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put({ key, value });
    await complete(tx);
  };

  return {
    raw: db,
    close: () => db.close(),

    async addTombstone(tombstone) {
      const tx = db.transaction(TOMBSTONES, 'readwrite');
      const store = tx.objectStore(TOMBSTONES);
      const existing = (await request(store.get([tombstone.store, tombstone.id]))) as Tombstone | undefined;
      if (!existing || tombstone.deletedAt > existing.deletedAt) store.put(tombstone);
      await complete(tx);
    },

    async getTombstones() {
      const tx = db.transaction(TOMBSTONES, 'readonly');
      return (await request(tx.objectStore(TOMBSTONES).getAll())) as Tombstone[];
    },

    async removeTombstones(keys) {
      const tx = db.transaction(TOMBSTONES, 'readwrite');
      const store = tx.objectStore(TOMBSTONES);
      for (const key of keys) store.delete([key.store, key.id]);
      await complete(tx);
    },

    async replaceTombstones(tombstones) {
      const tx = db.transaction(TOMBSTONES, 'readwrite');
      const store = tx.objectStore(TOMBSTONES);
      store.clear();
      for (const tombstone of tombstones) store.put(tombstone);
      await complete(tx);
    },

    getMeta: readMeta,
    setMeta: writeMeta,

    async getWriterId() {
      const existing = await readMeta<string>('writerId');
      if (existing) return existing;
      const id = `app-${globalThis.crypto.randomUUID().slice(0, 8)}`;
      await writeMeta('writerId', id);
      return id;
    },

    async appendConflicts(conflicts) {
      if (conflicts.length === 0) return;
      const tx = db.transaction(META, 'readwrite');
      const store = tx.objectStore(META);
      const row = (await request(store.get('conflicts'))) as { key: MetaKey; value: Conflict[] } | undefined;
      const merged = [...(row?.value ?? []), ...conflicts].slice(-CONFLICT_LOG_LIMIT);
      store.put({ key: 'conflicts', value: merged });
      await complete(tx);
    },

    async getConflicts() {
      return (await readMeta<Conflict[]>('conflicts')) ?? [];
    },
  };
}
