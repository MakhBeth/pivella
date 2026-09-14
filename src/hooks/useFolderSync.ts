import { useState, useEffect, useCallback, useRef } from 'react';
import {
  isFileSystemAccessSupported,
  getStoredDirectoryHandle,
  verifyPermission,
  folderSyncSource,
  getFolderName
} from '../lib/utils/fileSystemSync';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';
import { runSyncCycle, type AppliedChanges } from '../lib/sync/syncCycle';
import type { MergeResult } from '../lib/sync/merge';
import { listBackups, readBackup, restoreBackupSafely, type BackupEntry, type BackupPreview } from '../lib/sync/restore';
import { BackupError } from '../lib/sync/backup';
import { SyncLockedError } from '../lib/sync/lock';
import type { SyncSnapshot } from '../lib/sync/schema';

interface UseFolderSyncOptions {
  dbManager: IndexedDBManager;
  dbReady: boolean;
  isUsersInitialized: boolean;
  /** Chiamato a ogni applicazione a IndexedDB, prima della scrittura del file: chi ascolta aggiorna lo stato React per differenze. */
  onApplied?: (applied: AppliedChanges, merge: MergeResult) => Promise<void> | void;
  /** Chiamato dopo un rimpiazzo totale (ripristino): chi ascolta ricarica tutto dal database. */
  onRestored?: () => Promise<void> | void;
  /** Aggiusta lo snapshot letto dal file prima del merge (es. record senza userId). */
  prepareRemote?: (snapshot: SyncSnapshot) => SyncSnapshot;
}

interface UseFolderSyncReturn {
  syncFolderHandle: FileSystemDirectoryHandle | null;
  syncFolderName: string | null;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  isInitialLoadDone: boolean;
  /** Ultimo errore di sync (backup fallito, lock, permesso). Null quando l'ultimo giro è andato bene. */
  syncError: string | null;
  syncToFolder: () => Promise<void>;
  /** Giro immediato, senza debounce: per il pulsante Riprova e Sincronizza ora. */
  syncNow: () => Promise<void>;
  /** Conflitti nel log e record archiviati, aggiornati dopo ogni giro. */
  syncStatus: { conflicts: number; archived: number } | null;
  /** Backup nella cartella, dal più recente. */
  listBackups: () => Promise<BackupEntry[]>;
  previewBackup: (name: string) => Promise<BackupPreview>;
  /** Rimpiazzo totale da un backup (13.3). Lancia se il backup pre-restore fallisce. */
  restoreBackup: (name: string) => Promise<void>;
  setSyncFolderHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setSyncFolderName: (name: string | null) => void;
  setLastSyncTime: (time: Date | null) => void;
}

function describeSyncError(err: unknown): string {
  if (err instanceof BackupError) return `Sincronizzazione sospesa: impossibile creare il backup (${err.reason})`;
  if (err instanceof SyncLockedError) return 'Sincronizzazione rimandata: il file è in uso da un altro programma';
  if (err instanceof Error) return `Errore di sincronizzazione: ${err.message}`;
  return 'Errore di sincronizzazione';
}

/**
 * Sync v2 con la cartella (13.2): a ogni trigger un giro completo leggi,
 * fondi, applica, riscrivi solo se diverso. Trigger: avvio, focus della
 * finestra, ogni cambiamento con debounce di 500 ms, pulsante manuale.
 * Niente polling nella prima release.
 */
export function useFolderSync({
  dbManager,
  dbReady,
  isUsersInitialized,
  onApplied,
  onRestored,
  prepareRemote
}: UseFolderSyncOptions): UseFolderSyncReturn {
  const [syncFolderHandle, setSyncFolderHandleState] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncFolderName, setSyncFolderName] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ conflicts: number; archived: number } | null>(null);

  // Un solo giro alla volta; un trigger arrivato durante il giro ne chiede un altro alla fine.
  const runningRef = useRef(false);
  const rerunRequestedRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncFolderHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  // Callback in ref: cambiano a ogni render e non devono far ripartire l'avvio.
  const onAppliedRef = useRef(onApplied);
  const onRestoredRef = useRef(onRestored);
  const prepareRemoteRef = useRef(prepareRemote);

  // Il ref va aggiornato subito, non in un effect: chi seleziona una cartella
  // chiama syncNow nello stesso tick e il giro deve vedere il nuovo handle.
  const setSyncFolderHandle = useCallback((handle: FileSystemDirectoryHandle | null) => {
    syncFolderHandleRef.current = handle;
    setSyncFolderHandleState(handle);
  }, []);

  useEffect(() => {
    onAppliedRef.current = onApplied;
    onRestoredRef.current = onRestored;
    prepareRemoteRef.current = prepareRemote;
  }, [onApplied, onRestored, prepareRemote]);

  const runCycle = useCallback(async (handle?: FileSystemDirectoryHandle | null): Promise<void> => {
    const folderHandle = handle ?? syncFolderHandleRef.current;
    if (!folderHandle || !dbReady || !dbManager.writerId) return;
    if (runningRef.current) {
      rerunRequestedRef.current = true;
      return;
    }

    runningRef.current = true;
    setIsSyncing(true);
    try {
      if (!(await verifyPermission(folderHandle))) {
        setSyncError('Permesso sulla cartella di sincronizzazione da rinnovare');
        return;
      }
      const outcome = await runSyncCycle({
        db: dbManager,
        source: folderSyncSource(folderHandle),
        writer: { id: dbManager.writerId, kind: 'app' },
        prepareRemote: prepareRemoteRef.current,
        onApplied: (applied, merge) => onAppliedRef.current?.(applied, merge),
      });
      console.log('[useFolderSync] Giro completato:', outcome.status, 'locale cambiato:', outcome.localChanged);
      if (outcome.status === 'restored') await onRestoredRef.current?.();
      if (outcome.status === 'stale') {
        setSyncError('Il file di sincronizzazione continua a cambiare: nuovo tentativo al prossimo giro');
      } else {
        setSyncError(null);
        setLastSyncTime(new Date());
      }
      setSyncStatus(await dbManager.getSyncStatus());
    } catch (err: any) {
      console.error('[useFolderSync] Errore di sync:', err);
      setSyncError(describeSyncError(err));
      // Permesso revocato: la cartella va riselezionata.
      if (err?.name === 'NotAllowedError') {
        setSyncFolderHandle(null);
        setSyncFolderName(null);
      }
    } finally {
      runningRef.current = false;
      setIsSyncing(false);
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        void runCycle();
      }
    }
  }, [dbManager, dbReady]);

  // Avvio: recupera l'handle salvato e fa il primo giro.
  useEffect(() => {
    if (!dbReady || !isUsersInitialized || !isFileSystemAccessSupported()) {
      if (!isFileSystemAccessSupported()) setIsInitialLoadDone(true);
      return;
    }

    let cancelled = false;
    async function initSyncFolder() {
      try {
        const handle = await getStoredDirectoryHandle();
        if (!handle || cancelled) return;
        if (!(await verifyPermission(handle))) {
          setSyncError('Permesso sulla cartella di sincronizzazione da rinnovare');
          return;
        }
        setSyncFolderHandle(handle);
        setSyncFolderName(getFolderName(handle));
        await runCycle(handle);
      } catch (err) {
        console.error('[useFolderSync] Errore all\'avvio:', err);
      } finally {
        if (!cancelled) setIsInitialLoadDone(true);
      }
    }

    initSyncFolder();
    return () => {
      cancelled = true;
    };
  }, [dbReady, isUsersInitialized, runCycle]);

  // Focus della finestra: un giro, così le modifiche del server MCP arrivano subito.
  useEffect(() => {
    if (!isFileSystemAccessSupported()) return;
    const handleFocus = () => {
      if (syncFolderHandleRef.current && isInitialLoadDone) void runCycle();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isInitialLoadDone, runCycle]);

  useEffect(() => () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
  }, []);

  const syncToFolder = useCallback(async () => {
    if (!syncFolderHandle || !dbReady) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      void runCycle();
    }, 500);
  }, [syncFolderHandle, dbReady, runCycle]);

  const syncNow = useCallback(async () => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    await runCycle();
  }, [runCycle]);

  const listBackupsInFolder = useCallback(async () => {
    const handle = syncFolderHandleRef.current;
    if (!handle) return [];
    return listBackups(folderSyncSource(handle).fs);
  }, []);

  const previewBackup = useCallback(async (name: string) => {
    const handle = syncFolderHandleRef.current;
    if (!handle) throw new Error('Nessuna cartella di sincronizzazione');
    return readBackup(folderSyncSource(handle).fs, name, { now: new Date().toISOString(), writer: { id: dbManager.writerId ?? 'app-unknown', kind: 'app' } });
  }, [dbManager]);

  const restoreBackup = useCallback(async (name: string) => {
    const handle = syncFolderHandleRef.current;
    if (!handle) throw new Error('Nessuna cartella di sincronizzazione');
    if (runningRef.current) throw new Error('Sincronizzazione in corso, riprova tra un attimo');
    runningRef.current = true;
    setIsSyncing(true);
    try {
      if (!(await verifyPermission(handle))) throw new Error('Permesso sulla cartella di sincronizzazione da rinnovare');
      // Prima un giro di sync (le modifiche locali finiscono nel file e quindi
      // nel backup pre-restore), poi il rimpiazzo. Se il giro non scrive, niente.
      await restoreBackupSafely(folderSyncSource(handle), dbManager, name, {
        prepare: prepareRemoteRef.current,
        onApplied: (applied, merge) => onAppliedRef.current?.(applied, merge),
        onRestored: () => onRestoredRef.current?.(),
      });
      await onRestoredRef.current?.();
      setSyncError(null);
      setLastSyncTime(new Date());
      setSyncStatus(await dbManager.getSyncStatus());
    } catch (err) {
      setSyncError(describeSyncError(err));
      throw err;
    } finally {
      runningRef.current = false;
      setIsSyncing(false);
    }
  }, [dbManager]);

  return {
    syncFolderHandle,
    syncFolderName,
    isSyncing,
    lastSyncTime,
    isInitialLoadDone,
    syncError,
    syncToFolder,
    syncNow,
    syncStatus,
    listBackups: listBackupsInFolder,
    previewBackup,
    restoreBackup,
    setSyncFolderHandle,
    setSyncFolderName,
    setLastSyncTime
  };
}
