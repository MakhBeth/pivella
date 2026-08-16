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

const SYNC_FILENAME = 'pivella-sync.json';
// Pre-rename filename, read as fallback so existing sync folders keep working
const LEGACY_SYNC_FILENAME = 'forfettino-sync.json';
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

/**
 * Write sync data to the selected folder
 */
export async function writeSyncFile(
  handle: FileSystemDirectoryHandle,
  data: Record<string, any[]>
): Promise<void> {
  const fileHandle = await handle.getFileHandle(SYNC_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/**
 * Read sync data from the selected folder
 */
export async function readSyncFile(
  handle: FileSystemDirectoryHandle
): Promise<Record<string, any[]> | null> {
  try {
    const fileHandle = await handle.getFileHandle(SYNC_FILENAME);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err: any) {
    // File doesn't exist yet: fall back to the legacy filename
    if (err.name === 'NotFoundError') {
      try {
        const legacyHandle = await handle.getFileHandle(LEGACY_SYNC_FILENAME);
        const legacyFile = await legacyHandle.getFile();
        return JSON.parse(await legacyFile.text());
      } catch (legacyErr: any) {
        if (legacyErr.name === 'NotFoundError') {
          return null;
        }
        throw legacyErr;
      }
    }
    throw err;
  }
}

/**
 * Get the folder name from a directory handle
 */
export function getFolderName(handle: FileSystemDirectoryHandle): string {
  return handle.name;
}
