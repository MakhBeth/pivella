import type { StoreName, User } from '../../types';
import { DB_NAME, DB_VERSION, STORES } from '../constants/fiscali';
import type { Conflict, MergeResult, StoreChanges } from '../sync/merge';
import { canonicalJson, compareInstants, createEmptySnapshot, tombstoneTimestamp, type SyncRecord, type SyncSnapshot } from '../sync/schema';
import { openSyncMetaDb, type SyncMetaDb } from './syncMetaDb';

export interface IndexedDBManagerOptions {
  /** Implementazione IndexedDB; i test passano `fake-indexeddb`, l'app usa quella del browser. */
  factory?: IDBFactory;
  /** Orologio per i timbri `updatedAt` e i tombstone, iniettabile nei test. */
  now?: () => string;
}

/** Record con i campi di versione della sync v2 (13.2). */
export interface Stamped {
  updatedAt?: string;
  updatedBy?: string;
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transazione annullata'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function sortById<T extends { id: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Record locali che un ripristino con `snapshot` cambierebbe o eliminerebbe. */
function droppedByRestore(local: SyncSnapshot, snapshot: SyncSnapshot): Conflict[] {
  const dropped: Conflict[] = [];
  for (const store of STORES) {
    const restored = new Map((snapshot[store] as SyncRecord[]).map((r) => [r.id, r]));
    for (const record of local[store] as SyncRecord[]) {
      const next = restored.get(record.id);
      if (next && canonicalJson(next) === canonicalJson(record)) continue;
      dropped.push({
        store,
        id: record.id,
        reason: 'restore',
        kept: { updatedAt: next?.updatedAt ?? null, updatedBy: next?.updatedBy ?? null },
        dropped: { updatedAt: record.updatedAt ?? null, updatedBy: record.updatedBy ?? null },
        droppedRecord: record,
      });
    }
  }
  return dropped;
}

export class IndexedDBManager {
  db: IDBDatabase | null;
  /** Id di questo writer, da `PivellaSyncMeta`. Disponibile dopo `init`. */
  writerId: string | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;
  private syncMeta: SyncMetaDb | null = null;
  private readonly factory: IDBFactory;
  private readonly now: () => string;

  constructor(options: IndexedDBManagerOptions = {}) {
    this.db = null;
    this.factory = options.factory ?? globalThis.indexedDB;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async init(): Promise<IDBDatabase> {
    // If already initialized, return existing db
    if (this.db) {
      console.log('[DB] Already initialized, returning existing connection');
      return this.db;
    }

    // If init is in progress, wait for it
    if (this.initPromise) {
      console.log('[DB] Init already in progress, waiting...');
      return this.initPromise;
    }

    // Start init
    this.initPromise = this.doInit();
    try {
      const db = await this.initPromise;
      // PivellaSyncMeta si apre solo dopo ForfettarioDB, fuori dal percorso
      // con timeout che cancella e ricrea il database (13.8).
      await this.initSyncMeta();
      return db;
    } finally {
      this.initPromise = null;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.syncMeta?.close();
    this.syncMeta = null;
  }

  private async initSyncMeta(): Promise<void> {
    try {
      const meta = await this.ensureSyncMeta();
      this.writerId = await meta.getWriterId();
    } catch (e) {
      console.warn('[DB] PivellaSyncMeta non disponibile:', e);
      return;
    }
    // Riconciliazione locale, best effort: un errore qui non blocca l'avvio.
    try {
      await this.reconcileTombstones();
    } catch (e) {
      console.warn('[DB] Riconciliazione tombstone fallita:', e);
    }
  }

  private async ensureSyncMeta(): Promise<SyncMetaDb> {
    if (!this.syncMeta) {
      this.syncMeta = await openSyncMetaDb(this.factory);
      this.syncMeta.raw.onversionchange = () => {
        this.syncMeta?.close();
        this.syncMeta = null;
      };
    }
    return this.syncMeta;
  }

  /**
   * Cancella da ForfettarioDB ogni record con un tombstone strettamente più
   * recente del suo `updatedAt` (13.8). Un record senza `updatedAt` vale come
   * più vecchio di qualsiasi tombstone. Stesso confronto del merge, in locale.
   */
  async reconcileTombstones(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    const meta = await this.ensureSyncMeta();
    const tombstones = await meta.getTombstones();
    if (tombstones.length === 0) return 0;
    const stores = [...new Set(tombstones.map((t) => t.store))];
    const tx = this.db.transaction(stores, 'readwrite');
    let removed = 0;
    for (const t of tombstones) {
      const store = tx.objectStore(t.store);
      const record = (await request(store.get(t.id))) as Stamped | undefined;
      if (record && compareInstants(t.deletedAt, record.updatedAt) > 0) {
        store.delete(t.id);
        removed++;
      }
    }
    await complete(tx);
    return removed;
  }

  /**
   * Snapshot v2 dello stato locale: tutti gli store di ForfettarioDB più i
   * tombstone di PivellaSyncMeta. Le proposte vivono solo nel file, quindi
   * qui sono vuote; `restoredAt` è l'ultimo ripristino riconosciuto (13.3).
   */
  async exportSnapshot(): Promise<SyncSnapshot> {
    if (!this.db) throw new Error('Database not initialized');
    const meta = await this.ensureSyncMeta();
    const writerId = this.writerId ?? (await meta.getWriterId());
    const snapshot = createEmptySnapshot({ now: this.now(), writer: { id: writerId, kind: 'app' } });
    for (const store of STORES) (snapshot[store] as SyncRecord[]) = await this.getAll(store);
    snapshot.tombstones = await meta.getTombstones();
    snapshot.restoredAt = (await meta.getMeta<string>('lastRestoreAck')) ?? null;
    snapshot.restoredFrom = (await meta.getMeta<string>('lastRestoreFrom')) ?? null;
    return snapshot;
  }

  /** Conteggi per Impostazioni: conflitti nel log limitato e record archiviati per intero. */
  async getSyncStatus(): Promise<{ conflicts: number; archived: number }> {
    const meta = await this.ensureSyncMeta();
    const [conflicts, archive] = await Promise.all([meta.getConflicts(), meta.getArchive()]);
    return { conflicts: conflicts.length, archived: archive.length };
  }

  async getLastRestoreAck(): Promise<string | null> {
    const meta = await this.ensureSyncMeta();
    return (await meta.getMeta<string>('lastRestoreAck')) ?? null;
  }

  /**
   * Ripristino: rimpiazzo totale, non un merge (13.3, punti 4 e 6). Tutti gli
   * store da `importAll`, tombstone locali svuotati, `lastRestoreAck` =
   * `restoredAt` del file così i giri successivi tornano al merge.
   */
  async restoreFromSnapshot(snapshot: SyncSnapshot): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const meta = await this.ensureSyncMeta();
    // Ogni record locale che il ripristino cambia o elimina finisce
    // nell'archivio per intero: è la sua unica copia (i backup sono del file).
    // Archivio e rimpiazzo stanno in due database, quindi in due transazioni:
    // il rimpiazzo avviene in una sola transazione che prima rilegge gli
    // store e li confronta con ciò che è stato archiviato. Se qualcosa è
    // cambiato nel frattempo (anche da un'altra scheda) si archivia di nuovo
    // e si riprova, così nessun record resta senza copia.
    for (let attempt = 0; attempt < 5; attempt++) {
      const local = await this.exportSnapshot();
      await meta.appendConflicts(droppedByRestore(local, snapshot), this.now());
      if (await this.replaceStoresIfUnchanged(snapshot, local)) {
        await meta.replaceTombstones([]);
        await meta.setMeta('lastRestoreAck', snapshot.restoredAt ?? this.now());
        await meta.setMeta('lastRestoreFrom', snapshot.restoredFrom);
        return;
      }
    }
    throw new Error('Ripristino annullato: il database continua a cambiare durante il rimpiazzo');
  }

  /**
   * Rimpiazzo totale di tutti gli store in una sola transazione, solo se il
   * contenuto corrente è ancora identico a `expected`. La transazione
   * readwrite su tutti gli store serializza anche le scritture delle altre
   * schede, quindi tra il confronto e il rimpiazzo non passa nulla.
   */
  private async replaceStoresIfUnchanged(snapshot: SyncSnapshot, expected: SyncSnapshot): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    const tx = this.db.transaction([...STORES], 'readwrite');
    let unchanged = true;
    try {
      for (const store of STORES) {
        const current = (await request(tx.objectStore(store).getAll())) as SyncRecord[];
        if (canonicalJson(sortById(current)) !== canonicalJson(sortById(expected[store] as SyncRecord[]))) {
          unchanged = false;
          break;
        }
      }
      if (!unchanged) {
        tx.abort();
        return false;
      }
      for (const store of STORES) {
        const objectStore = tx.objectStore(store);
        objectStore.clear();
        for (const record of snapshot[store] as SyncRecord[]) objectStore.put(record);
      }
    } catch (e) {
      tx.abort();
      throw e;
    }
    await complete(tx);
    return true;
  }

  /** Timbra sempre `updatedAt` e `updatedBy`: da usare negli hook a ogni modifica dell'utente. */
  stamp<T extends object>(record: T): T & Required<Stamped> {
    return { ...record, updatedAt: this.now(), updatedBy: this.writerId ?? 'app-unknown' };
  }

  /**
   * Applica a ForfettarioDB l'esito di `mergeSnapshots(base, remoto)`.
   * Ordine obbligato: prima l'archivio dei record locali perdenti (la loro
   * unica copia), poi i tombstone, poi le differenze per store in una sola
   * transazione, così un crash a metà non lascia nulla di mezzo applicato.
   *
   * Tra `exportSnapshot` e questa chiamata l'utente può aver modificato o
   * cancellato record: un record che oggi non è più uguale alla sua versione
   * in `base` viene saltato, perché il merge non lo ha visto. Il giro
   * successivo lo rifonde con la versione giusta. Restituisce ciò che è
   * stato applicato davvero, per aggiornare lo stato React.
   */
  async mergeIntoDb(result: MergeResult, base?: SyncSnapshot): Promise<Record<StoreName, StoreChanges>> {
    if (!this.db) throw new Error('Database not initialized');
    const meta = await this.ensureSyncMeta();
    await meta.appendConflicts(result.conflicts, this.now());
    if (base) await meta.mergeTombstones(result.snapshot.tombstones, base.tombstones);
    else await meta.replaceTombstones(result.snapshot.tombstones);
    if (result.orphans.length > 0) await meta.setMeta('orphans', result.orphans);
    // Tombstone correnti, compresi quelli scritti dopo lo snapshot: un record
    // creato e cancellato nel frattempo non deve tornare con l'upsert del file.
    const deletedAt = new Map((await meta.getTombstones()).map((t) => [`${t.store}/${t.id}`, t.deletedAt]));

    const applied = {} as Record<StoreName, StoreChanges>;
    for (const s of STORES) applied[s] = { upserted: [], deleted: [] };
    const touched = STORES.filter((s) => result.changes[s].upserted.length > 0 || result.changes[s].deleted.length > 0);
    if (touched.length === 0) return applied;

    const tx = this.db.transaction(touched, 'readwrite');
    try {
      for (const storeName of touched) {
        const store = tx.objectStore(storeName);
        const byId = new Map((result.snapshot[storeName] as SyncRecord[]).map((r) => [r.id, r]));
        const baseById = base ? new Map((base[storeName] as SyncRecord[]).map((r) => [r.id, r])) : null;
        const unchangedSinceBase = async (id: string): Promise<boolean> => {
          if (!baseById) return true;
          const current = (await request(store.get(id))) as SyncRecord | undefined;
          const expected = baseById.get(id);
          if (!current && !expected) return true;
          if (!current || !expected) return false;
          return canonicalJson(current) === canonicalJson(expected);
        };
        for (const id of result.changes[storeName].upserted) {
          const record = byId.get(id);
          if (!record) throw new Error(`Record ${storeName}/${id} assente dallo snapshot fuso`);
          if (!(await unchangedSinceBase(id))) continue;
          if (compareInstants(deletedAt.get(`${storeName}/${id}`), (record as Stamped).updatedAt) > 0) continue;
          store.put(record);
          applied[storeName].upserted.push(id);
        }
        for (const id of result.changes[storeName].deleted) {
          if (!(await unchangedSinceBase(id))) continue;
          store.delete(id);
          applied[storeName].deleted.push(id);
        }
      }
    } catch (e) {
      tx.abort();
      throw e;
    }
    await complete(tx);
    return applied;
  }

  private async doInit(): Promise<IDBDatabase> {
    // First, try to close any existing connections by opening without version
    try {
      console.log('[DB] Closing any existing connections...');
      await this.closeExistingConnections();
    } catch (e) {
      console.warn('[DB] Could not close existing connections:', e);
    }

    // Try to open normally
    try {
      return await this.openDatabase();
    } catch (error: any) {
      // If blocked or stuck, try to delete and recreate
      if (error.name === 'TimeoutError' || error.name === 'BlockedError') {
        console.warn('[DB] Database blocked, attempting to delete and recreate...');
        await this.deleteDatabase();
        return await this.openDatabase();
      }
      throw error;
    }
  }

  private closeExistingConnections(): Promise<void> {
    return new Promise((resolve) => {
      const request = this.factory.open(DB_NAME);

      const timeout = setTimeout(() => {
        console.log('[DB] Close connections timeout');
        resolve();
      }, 1000);

      request.onsuccess = () => {
        clearTimeout(timeout);
        const db = request.result;
        console.log('[DB] Existing connection opened, version:', db.version, '- closing...');
        db.close();
        resolve();
      };

      request.onerror = () => {
        clearTimeout(timeout);
        console.log('[DB] No existing connection to close');
        resolve();
      };
    });
  }

  private deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[DB] Deleting database...');
      const request = this.factory.deleteDatabase(DB_NAME);

      const timeout = setTimeout(() => {
        console.warn('[DB] Delete timeout, continuing anyway...');
        resolve();
      }, 3000);

      request.onsuccess = () => {
        clearTimeout(timeout);
        console.log('[DB] Database deleted');
        resolve();
      };
      request.onerror = () => {
        clearTimeout(timeout);
        console.error('[DB] Error deleting database:', request.error);
        reject(request.error);
      };
      request.onblocked = () => {
        console.warn('[DB] Delete blocked, waiting...');
        // Don't resolve yet, wait for success or timeout
      };
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      console.log('[DB] Opening database version', DB_VERSION);
      const request = this.factory.open(DB_NAME, DB_VERSION);

      // Timeout to detect stuck database
      const timeout = setTimeout(() => {
        console.error('[DB] Database open timeout - likely blocked');
        const error = new Error('Database open timeout');
        error.name = 'TimeoutError';
        reject(error);
      }, 3000);

      request.onerror = () => {
        clearTimeout(timeout);
        console.error('[DB] Error opening database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        clearTimeout(timeout);
        console.log('[DB] Database opened successfully');
        this.db = request.result;

        // Handle version change from other tabs
        this.db.onversionchange = () => {
          console.log('[DB] Version change detected, closing connection');
          this.db?.close();
          this.db = null;
        };

        resolve(this.db);
      };

      request.onupgradeneeded = (event: any) => {
        console.log('[DB] Upgrade needed, old version:', event.oldVersion, 'new version:', event.newVersion);
        const db = event.target.result;
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('clienti')) {
          db.createObjectStore('clienti', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('fatture')) {
          db.createObjectStore('fatture', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('workLogs')) {
          db.createObjectStore('workLogs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('scadenze')) {
          db.createObjectStore('scadenze', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id' });
        }
        console.log('[DB] Upgrade complete');
      };

      request.onblocked = () => {
        clearTimeout(timeout);
        console.warn('[DB] Database upgrade blocked');
        const error = new Error('Database upgrade blocked');
        error.name = 'BlockedError';
        reject(error);
      };
    });
  }

  async getAll(storeName: StoreName): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getAllForUser(storeName: StoreName, userId: string): Promise<any[]> {
    const all = await this.getAll(storeName);
    return all.filter((item: any) => item.userId === userId);
  }

  async get(storeName: StoreName, key: string): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /** Rete di sicurezza: timbra `updatedAt` e `updatedBy` solo se mancano. Chi arriva dal merge conserva i suoi. */
  async put(storeName: StoreName, data: any): Promise<IDBValidKey> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const record = data && typeof data === 'object' && (!data.updatedAt || !data.updatedBy)
      ? { ...data, updatedAt: data.updatedAt || this.now(), updatedBy: data.updatedBy || this.writerId || 'app-unknown' }
      : data;
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(record);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Prima il tombstone in PivellaSyncMeta, con `deletedAt` strettamente
   * maggiore dell'`updatedAt` del record, poi la cancellazione (13.8). Un
   * crash nel mezzo ritarda la cancellazione al merge successivo, mai la annulla.
   */
  async delete(storeName: StoreName, key: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const meta = await this.ensureSyncMeta();
    const existing = ((await this.get(storeName, key)) ?? {}) as Stamped;
    await meta.addTombstone({
      store: storeName,
      id: key,
      deletedAt: tombstoneTimestamp(this.now(), existing),
      deletedBy: this.writerId ?? (await meta.getWriterId()),
    });
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async clear(storeName: StoreName): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async exportAll(): Promise<Record<string, any[]>> {
    const data: Record<string, any[]> = {};
    for (const store of STORES) {
      data[store] = await this.getAll(store);
    }
    return data;
  }

  async exportForUser(userId: string): Promise<Record<string, any[]>> {
    const data: Record<string, any[]> = {};
    for (const store of STORES) {
      if (store === 'users') {
        // Export only the current user
        const users = await this.getAll('users');
        data[store] = users.filter((u: User) => u.id === userId);
      } else {
        data[store] = await this.getAllForUser(store, userId);
      }
    }
    return data;
  }

  async importAll(data: Record<string, any[]>): Promise<void> {
    console.log('[DB] importAll starting, stores in data:', Object.keys(data));
    for (const store of STORES) {
      if (data[store]) {
        console.log(`[DB] Importing ${store}: ${data[store].length} items`);
        await this.clear(store);
        for (const item of data[store]) {
          await this.put(store, item);
        }
      }
    }
    console.log('[DB] importAll complete');
  }

  async migrateToMultiUser(): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    console.log('[DB] migrateToMultiUser starting...');
    // Check if users already exist
    const existingUsers = await this.getAll('users');
    console.log('[DB] Existing users:', existingUsers);
    if (existingUsers.length > 0) {
      // Migration already done, return the first user's id
      console.log('[DB] Migration already done, returning:', existingUsers[0].id);
      return existingUsers[0].id;
    }

    console.log('[DB] Creating default user...');
    // Create the default user
    const defaultUserId = 'user_' + Date.now().toString();
    const defaultUser: User = {
      id: defaultUserId,
      nome: 'Utente Principale',
      createdAt: new Date().toISOString()
    };
    await this.put('users', defaultUser);
    console.log('[DB] Default user created:', defaultUserId);

    // Migrate config: rename 'main' to 'config_${userId}' and add userId
    const oldConfig = await this.get('config', 'main');
    console.log('[DB] Old config:', oldConfig);
    if (oldConfig) {
      const newConfig = {
        ...oldConfig,
        id: `config_${defaultUserId}`,
        userId: defaultUserId
      };
      await this.put('config', newConfig);
      await this.delete('config', 'main');
      console.log('[DB] Config migrated');
    }

    // Migrate clienti
    const clienti = await this.getAll('clienti');
    for (const cliente of clienti) {
      if (!cliente.userId) {
        await this.put('clienti', { ...cliente, userId: defaultUserId });
      }
    }

    // Migrate fatture
    const fatture = await this.getAll('fatture');
    for (const fattura of fatture) {
      if (!fattura.userId) {
        await this.put('fatture', { ...fattura, userId: defaultUserId });
      }
    }

    // Migrate workLogs
    const workLogs = await this.getAll('workLogs');
    for (const workLog of workLogs) {
      if (!workLog.userId) {
        await this.put('workLogs', { ...workLog, userId: defaultUserId });
      }
    }

    // Migrate scadenze
    const scadenze = await this.getAll('scadenze');
    for (const scadenza of scadenze) {
      if (!scadenza.userId) {
        await this.put('scadenze', { ...scadenza, userId: defaultUserId });
      }
    }

    console.log('[DB] Migration complete, returning:', defaultUserId);
    return defaultUserId;
  }
}

// Export singleton instance
export const dbManager = new IndexedDBManager();
