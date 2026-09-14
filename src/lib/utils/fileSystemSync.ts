/**
 * File System Access API utility for folder sync
 * Only works on Chromium browsers (Chrome, Edge, Opera)
 */

// Extend types for File System Access API (not fully typed in TS)
declare global {
  interface FileSystemDirectoryHandle {
    queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
    requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  }

  interface Window {
    showDirectoryPicker(options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }): Promise<FileSystemDirectoryHandle>;
  }
}

import { SYNC_FILENAME } from '../sync/backup';
import type { SyncFileSystem } from '../sync/fileSystem';
import { fsaFileSystem } from '../sync/fsaFileSystem';
import type { SyncSource } from '../sync/syncCycle';
import { LEGACY_SYNC_FILENAME } from '../sync/syncFile';

const HANDLE_STORE_KEY = 'syncDirectoryHandle';

/**
 * Check if File System Access API is supported
 */
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

/**
 * Get a user-friendly message for unsupported browsers
 */
export function getUnsupportedBrowserMessage(): string {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

  if (isIOS) {
    return 'Questa funzione non è disponibile su iOS. Apple richiede che tutti i browser usino il motore di Safari, che non supporta questa API.';
  }
  if (isSafari) {
    return 'Questa funzione non è disponibile su Safari. Usa Chrome o Edge per sincronizzare automaticamente con una cartella.';
  }
  if (isFirefox) {
    return 'Questa funzione non è disponibile su Firefox. Usa Chrome o Edge per sincronizzare automaticamente con una cartella.';
  }
  return 'Questa funzione è disponibile solo su browser Chromium (Chrome, Edge, Opera).';
}

// Helper to promisify IDB request
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Open the sync IndexedDB database
 */
function openSyncDB(name = 'PivellaSync'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles');
      }
    };
  });
}

/**
 * Store directory handle in IndexedDB for persistence
 */
export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openSyncDB();
  const tx = db.transaction('handles', 'readwrite');
  const store = tx.objectStore('handles');
  await promisifyRequest(store.put(handle, HANDLE_STORE_KEY));
}

/**
 * Retrieve stored directory handle from IndexedDB
 */
export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openSyncDB();
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const handle = await promisifyRequest(store.get(HANDLE_STORE_KEY));
    if (handle) return handle;

    // Migrate the handle stored under the pre-rename database name
    const legacyDb = await openSyncDB('ForfettinoSync');
    const legacyTx = legacyDb.transaction('handles', 'readonly');
    const legacyHandle = await promisifyRequest(
      legacyTx.objectStore('handles').get(HANDLE_STORE_KEY)
    );
    if (legacyHandle) {
      await storeDirectoryHandle(legacyHandle);
      return legacyHandle;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear stored directory handle
 */
export async function clearStoredDirectoryHandle(): Promise<void> {
  try {
    const db = await openSyncDB();
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    await promisifyRequest(store.delete(HANDLE_STORE_KEY));
  } catch {
    // Ignore errors
  }
}

/**
 * Request permission for a stored handle (needed after page reload)
 */
export async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const options = { mode: 'readwrite' as const };

  // Check if we already have permission
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  // Request permission
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
}

/**
 * Prompt user to select a sync folder
 */
export async function selectSyncFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    return null;
  }

  try {
    const handle = await (window as any).showDirectoryPicker({
      id: 'pivella-sync',
      mode: 'readwrite',
      startIn: 'documents'
    });

    await storeDirectoryHandle(handle);
    return handle;
  } catch (err: any) {
    // User cancelled or error
    if (err.name === 'AbortError') {
      return null;
    }
    throw err;
  }
}

// --- Sync v2 (13.2, 13.3) ----------------------------------------------------
//
// La logica sta in `lib/sync/syncCycle.ts`, `syncFile.ts` e `lock.ts`, pure e
// testate in Node. Qui solo l'adattamento all'handle della cartella.

export function syncFileSystemOf(handle: FileSystemDirectoryHandle): SyncFileSystem {
  return fsaFileSystem(handle);
}

async function fileVersion(handle: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const file = await (await handle.getFileHandle(name)).getFile();
    return `${name}:${file.lastModified}:${file.size}`;
  } catch (err: any) {
    if (err?.name === 'NotFoundError') return null;
    throw err;
  }
}

/**
 * Versione della sorgente letta dal ciclo: file di sync, oppure il file legacy
 * se il corrente manca. Serve al ciclo leggi-fondi-scrivi per capire se
 * qualcuno ha scritto nel frattempo, compreso il file legacy.
 */
export async function getSyncSourceVersion(handle: FileSystemDirectoryHandle): Promise<string | null> {
  return (await fileVersion(handle, SYNC_FILENAME)) ?? (await fileVersion(handle, LEGACY_SYNC_FILENAME));
}

/** Sorgente per `runSyncCycle`: file system sull'handle più `lastModified` del file di sync. */
export function folderSyncSource(handle: FileSystemDirectoryHandle): SyncSource {
  return { fs: syncFileSystemOf(handle), lastModified: () => getSyncSourceVersion(handle) };
}

/**
 * Get the folder name from a directory handle
 */
export function getFolderName(handle: FileSystemDirectoryHandle): string {
  return handle.name;
}
