import React, { createContext, useContext, useCallback, ReactNode, useEffect, useRef } from 'react';
import type { Config, Cliente, Fattura, WorkLog, Toast, Scadenza, User } from '../types';
import { useDatabase } from '../hooks/useDatabase';
import { useToast } from '../hooks/useToast';
import { useUsers } from '../hooks/useUsers';
import { useConfig } from '../hooks/useConfig';
import { useClienti } from '../hooks/useClienti';
import { useFatture } from '../hooks/useFatture';
import { useWorkLogs } from '../hooks/useWorkLogs';
import { useScadenze } from '../hooks/useScadenze';
import { useFolderSync } from '../hooks/useFolderSync';
import type { SyncSnapshot } from '../lib/sync/schema';
import type { SyncCycleOutcome } from '../lib/sync/syncCycle';
import { applyStoreChanges } from '../lib/sync/applyChanges';
import type { BackupEntry, BackupPreview } from '../lib/sync/restore';

// Helper to adjust color brightness
function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Define the context value interface
interface AppContextValue {
  // Database
  dbReady: boolean;
  dbError: Error | null;

  // Toast
  toast: Toast | null;
  showToast: (message: string, type?: 'success' | 'error') => void;

  // Users
  users: User[];
  currentUser: User | null;
  currentUserId: string | null;
  isUsersInitialized: boolean;
  switchUser: (userId: string) => void;
  addUser: (nome: string) => Promise<User>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;

  // Config
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  updateConfig: (updates: Partial<Config>) => void;

  // Clienti
  clienti: Cliente[];
  setClienti: React.Dispatch<React.SetStateAction<Cliente[]>>;
  addCliente: (cliente: Omit<Cliente, 'userId'> & { userId?: string }) => Promise<void>;
  updateCliente: (cliente: Cliente) => Promise<void>;
  removeCliente: (id: string) => Promise<void>;

  // Fatture
  fatture: Fattura[];
  setFatture: React.Dispatch<React.SetStateAction<Fattura[]>>;
  addFattura: (fattura: Omit<Fattura, 'userId'> & { userId?: string }) => Promise<void>;
  updateFattura: (fattura: Fattura) => Promise<void>;
  removeFattura: (id: string) => Promise<void>;

  // Work Logs
  workLogs: WorkLog[];
  setWorkLogs: React.Dispatch<React.SetStateAction<WorkLog[]>>;
  addWorkLog: (workLog: Omit<WorkLog, 'userId'> & { userId?: string }) => Promise<void>;
  updateWorkLog: (workLog: WorkLog) => Promise<void>;
  removeWorkLog: (id: string) => Promise<void>;

  // Scadenze
  scadenze: Scadenza[];
  setScadenze: React.Dispatch<React.SetStateAction<Scadenza[]>>;
  addScadenza: (scadenza: Omit<Scadenza, 'userId'> & { userId?: string }) => Promise<void>;
  updateScadenza: (scadenza: Scadenza) => Promise<void>;
  removeScadenza: (id: string) => Promise<void>;
  removeScadenzeByYear: (annoVersamento: number) => Promise<void>;
  bulkSaveScadenze: (scadenze: Array<Omit<Scadenza, 'userId'> & { userId?: string }>) => Promise<void>;
  getScadenzeByYear: (annoVersamento: number) => Scadenza[];
  getPaidAccontiForYear: (annoRiferimento: number) => { irpefPaid: number; inpsPaid: number };

  // Import/Export
  exportData: () => Promise<void>;
  importData: (data: Record<string, any[]>) => Promise<void>;

  // Folder Sync
  syncFolderHandle: FileSystemDirectoryHandle | null;
  syncFolderName: string | null;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
  syncToFolder: () => Promise<void>;
  syncNow: () => Promise<void>;
  syncStatus: { conflicts: number; archived: number } | null;
  listBackups: () => Promise<BackupEntry[]>;
  previewBackup: (name: string) => Promise<BackupPreview>;
  restoreBackup: (name: string) => Promise<void>;
  setSyncFolderHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setSyncFolderName: (name: string | null) => void;
  setLastSyncTime: (time: Date | null) => void;
}

// Create the context
const AppContext = createContext<AppContextValue | undefined>(undefined);

// Provider component
export function AppProvider({ children }: { children: ReactNode }) {
  // Initialize hooks
  const { dbManager, dbReady, dbError } = useDatabase();
  const { toast, showToast } = useToast();

  // Users hook - must be initialized before other data hooks
  const {
    users,
    setUsers,
    currentUserId,
    currentUser,
    isInitialized: isUsersInitialized,
    switchUser,
    addUser,
    updateUser,
    deleteUser
  } = useUsers(dbManager, dbReady);

  // Data hooks with user filtering
  const { config, setConfig, updateConfig } = useConfig(dbManager, dbReady, currentUserId);
  const { clienti, setClienti, addCliente, updateCliente, removeCliente } = useClienti(dbManager, dbReady, currentUserId);
  const { fatture, setFatture, addFattura, updateFattura, removeFattura } = useFatture(dbManager, dbReady, currentUserId);
  const { workLogs, setWorkLogs, addWorkLog, updateWorkLog, removeWorkLog } = useWorkLogs(dbManager, dbReady, currentUserId);
  const { scadenze, setScadenze, addScadenza, updateScadenza, removeScadenza, removeScadenzeByYear, bulkSaveScadenze, getScadenzeByYear, getPaidAccontiForYear } = useScadenze(dbManager, dbReady, currentUserId);

  // Refs to hold setters for folder sync callback
  const setConfigRef = useRef(setConfig);
  const setClientiRef = useRef(setClienti);
  const setFattureRef = useRef(setFatture);
  const setWorkLogsRef = useRef(setWorkLogs);
  const setScadenzeRef = useRef(setScadenze);
  const setUsersRef = useRef(setUsers);
  const usersRef = useRef(users);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    setConfigRef.current = setConfig;
    setClientiRef.current = setClienti;
    setFattureRef.current = setFatture;
    setWorkLogsRef.current = setWorkLogs;
    setScadenzeRef.current = setScadenze;
    setUsersRef.current = setUsers;
  }, [setConfig, setClienti, setFatture, setWorkLogs, setScadenze, setUsers]);

  const currentUserIdRef = useRef(currentUserId);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  /**
   * File senza profili (precedente al multi utente): ogni record senza userId
   * prende l'utente corrente e la lista utenti contiene solo lui. La
   * differenza rispetto al file viene riscritta dal ciclo di sync.
   */
  const prepareRemote = useCallback((snapshot: SyncSnapshot): SyncSnapshot => {
    if (snapshot.users.length > 0) return snapshot;
    const userId = currentUserIdRef.current;
    if (!userId) return snapshot;
    console.log('[AppContext] File di sync senza profili: assegno i record a', userId);
    const withUser = <T extends { userId?: string }>(records: T[]): T[] => records.map((r) => (r.userId ? r : { ...r, userId }));
    const current = usersRef.current.find((u) => u.id === userId);
    return {
      ...snapshot,
      users: current ? [current] : [],
      config: snapshot.config.map((c) => (c.userId ? c : { ...c, id: `config_${userId}`, userId })),
      clienti: withUser(snapshot.clienti),
      fatture: withUser(snapshot.fatture),
      workLogs: withUser(snapshot.workLogs),
      scadenze: withUser(snapshot.scadenze),
    };
  }, []);

  /** Ricarica per intero lo stato dal database: solo dopo un ripristino, che è un rimpiazzo totale. */
  const reloadStateFromDb = useCallback(async (): Promise<void> => {
    const userId = currentUserIdRef.current;
    const [allUsers, allConfig, allClienti, allFatture, allWorkLogs, allScadenze] = await Promise.all([
      dbManager.getAll('users'),
      dbManager.getAll('config'),
      dbManager.getAll('clienti'),
      dbManager.getAll('fatture'),
      dbManager.getAll('workLogs'),
      dbManager.getAll('scadenze'),
    ]);
    setUsersRef.current(allUsers);
    if (!userId) return;
    const userConfig = allConfig.find((c: Config) => c.userId === userId);
    if (userConfig) setConfigRef.current(userConfig);
    setClientiRef.current(allClienti.filter((c: Cliente) => c.userId === userId));
    setFattureRef.current(allFatture.filter((f: Fattura) => f.userId === userId));
    setWorkLogsRef.current(allWorkLogs.filter((w: WorkLog) => w.userId === userId));
    setScadenzeRef.current(allScadenze.filter((s: Scadenza) => s.userId === userId));
  }, [dbManager]);

  /**
   * Dopo un giro di sync che ha cambiato IndexedDB, lo stato React viene
   * aggiornato per differenze del merge: solo i record inseriti, aggiornati o
   * cancellati, presi dallo snapshot fuso. Una modifica fatta nel frattempo
   * su un altro record resta com'è.
   */
  const handleSynced = useCallback(async (outcome: SyncCycleOutcome): Promise<void> => {
    console.log('[AppContext] Aggiorno lo stato dopo la sync:', outcome.status);
    if (outcome.status === 'restored') {
      await reloadStateFromDb();
      return;
    }
    if (outcome.status !== 'unchanged' && outcome.status !== 'written') return;
    const { changes, snapshot } = outcome.merge;
    const userId = currentUserIdRef.current ?? undefined;
    setUsersRef.current((prev) => applyStoreChanges(prev, changes.users, snapshot.users));
    setClientiRef.current((prev) => applyStoreChanges(prev, changes.clienti, snapshot.clienti, userId));
    setFattureRef.current((prev) => applyStoreChanges(prev, changes.fatture, snapshot.fatture, userId));
    setWorkLogsRef.current((prev) => applyStoreChanges(prev, changes.workLogs, snapshot.workLogs, userId));
    setScadenzeRef.current((prev) => applyStoreChanges(prev, changes.scadenze, snapshot.scadenze, userId));
    if (userId && changes.config.upserted.includes(`config_${userId}`)) {
      const userConfig = snapshot.config.find((c) => c.id === `config_${userId}`);
      if (userConfig) setConfigRef.current(userConfig);
    }
  }, [reloadStateFromDb]);

  const {
    syncFolderHandle,
    syncFolderName,
    isSyncing,
    lastSyncTime,
    isInitialLoadDone,
    syncError,
    syncToFolder,
    syncNow,
    syncStatus,
    listBackups,
    previewBackup,
    restoreBackup,
    setSyncFolderHandle,
    setSyncFolderName,
    setLastSyncTime
  } = useFolderSync({
    dbManager,
    dbReady,
    isUsersInitialized,
    onSynced: handleSynced,
    prepareRemote
  });

  // Track previous values to detect changes
  const prevDataRef = useRef<string>('');

  // Auto-sync when data changes (including users)
  useEffect(() => {
    if (!isInitialLoadDone || !syncFolderHandle) return;

    // Create a simple hash of current data to detect changes
    const currentData = JSON.stringify({ users, config, clienti, fatture, workLogs, scadenze });

    if (prevDataRef.current && prevDataRef.current !== currentData) {
      syncToFolder();
    }

    prevDataRef.current = currentData;
  }, [users, config, clienti, fatture, workLogs, scadenze, isInitialLoadDone, syncFolderHandle, syncToFolder]);

  // Export/Import handlers
  const exportData = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const data = await dbManager.exportForUser(currentUserId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `forfettario-backup-${currentUser?.nome || 'utente'}-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup esportato!');
    } catch (error) {
      showToast('Errore export', 'error');
      throw error;
    }
  }, [dbManager, currentUserId, currentUser, showToast]);

  const importData = useCallback(async (data: Record<string, any[]>) => {
    if (!currentUserId) return;
    try {
      // Import data but ensure userId is set to current user
      const dataWithUser: Record<string, any[]> = {};

      for (const [key, items] of Object.entries(data)) {
        if (key === 'users') {
          // Skip users on import
          continue;
        } else if (key === 'config') {
          // Update config with current user's id
          dataWithUser[key] = items.map(item => ({
            ...item,
            id: `config_${currentUserId}`,
            userId: currentUserId
          }));
        } else {
          // Add userId to all items
          dataWithUser[key] = items.map(item => ({
            ...item,
            userId: currentUserId
          }));
        }
      }

      // Clear current user's data first, then import
      const existingClienti = await dbManager.getAllForUser('clienti', currentUserId);
      for (const c of existingClienti) {
        await dbManager.delete('clienti', c.id);
      }

      const existingFatture = await dbManager.getAllForUser('fatture', currentUserId);
      for (const f of existingFatture) {
        await dbManager.delete('fatture', f.id);
      }

      const existingWorkLogs = await dbManager.getAllForUser('workLogs', currentUserId);
      for (const w of existingWorkLogs) {
        await dbManager.delete('workLogs', w.id);
      }

      const existingScadenze = await dbManager.getAllForUser('scadenze', currentUserId);
      for (const s of existingScadenze) {
        await dbManager.delete('scadenze', s.id);
      }

      // Import new data
      for (const [key, items] of Object.entries(dataWithUser)) {
        for (const item of items) {
          await dbManager.put(key as any, item);
        }
      }

      // Reload all data from DB for current user
      const configId = `config_${currentUserId}`;
      const [savedConfig, savedClienti, savedFatture, savedWorkLogs, savedScadenze] = await Promise.all([
        dbManager.get('config', configId),
        dbManager.getAllForUser('clienti', currentUserId),
        dbManager.getAllForUser('fatture', currentUserId),
        dbManager.getAllForUser('workLogs', currentUserId),
        dbManager.getAllForUser('scadenze', currentUserId)
      ]);

      if (savedConfig) setConfig(savedConfig);
      setClienti(savedClienti || []);
      setFatture(savedFatture || []);
      setWorkLogs(savedWorkLogs || []);
      setScadenze(savedScadenze || []);

      showToast('Dati importati!');
    } catch (error) {
      showToast('Errore import', 'error');
      throw error;
    }
  }, [dbManager, currentUserId, setConfig, setClienti, setFatture, setWorkLogs, setScadenze, showToast]);

  // Show error toast if database fails
  React.useEffect(() => {
    if (dbError) {
      showToast('Errore caricamento database', 'error');
    }
  }, [dbError, showToast]);

  // Apply user color as CSS variable
  React.useEffect(() => {
    if (currentUser?.color) {
      document.documentElement.style.setProperty('--accent-primary', currentUser.color);
      // Generate a slightly darker shade for secondary
      const darkerColor = adjustColorBrightness(currentUser.color, -20);
      document.documentElement.style.setProperty('--accent-secondary', darkerColor);
      // Themes hardcode --on-accent for their own accent; recompute it for the
      // user color: white on dark accents, black on light ones (lightness flip)
      if (CSS.supports('color', 'contrast-color(red)')) {
        document.documentElement.style.setProperty('--on-accent', `contrast-color(${currentUser.color})`);
      } else if (CSS.supports('color', 'oklch(from red l c h)')) {
        document.documentElement.style.setProperty(
          '--on-accent',
          `oklch(from ${currentUser.color} clamp(0, (0.66 - l) * infinity, 1) 0 h)`
        );
      }
      // Chart scale: five steps of the user color, dark and saturated to
      // light and pastel, so adjacent slices differ in both axes
      if (CSS.supports('color', 'oklch(from red l c h)')) {
        const steps: Array<[number, number]> = [
          [-0.16, 1.15],
          [-0.08, 1.05],
          [0, 1],
          [0.09, 0.8],
          [0.18, 0.6],
        ];
        steps.forEach(([offset, chromaMul], i) => {
          document.documentElement.style.setProperty(
            `--chart-${i + 1}`,
            `oklch(from ${currentUser.color} clamp(0.25, calc(l + ${offset}), 0.93) calc(c * ${chromaMul}) h)`
          );
        });
      }
    } else {
      // No user color: let the active design style's tokens apply
      document.documentElement.style.removeProperty('--accent-primary');
      document.documentElement.style.removeProperty('--accent-secondary');
      document.documentElement.style.removeProperty('--on-accent');
      for (let i = 1; i <= 5; i++) {
        document.documentElement.style.removeProperty(`--chart-${i}`);
      }
    }
  }, [currentUser?.color]);

  const value: AppContextValue = {
    dbReady,
    dbError,
    toast,
    showToast,
    users,
    currentUser,
    currentUserId,
    isUsersInitialized,
    switchUser,
    addUser,
    updateUser,
    deleteUser,
    config,
    setConfig,
    updateConfig,
    clienti,
    setClienti,
    addCliente,
    updateCliente,
    removeCliente,
    fatture,
    setFatture,
    addFattura,
    updateFattura,
    removeFattura,
    workLogs,
    setWorkLogs,
    addWorkLog,
    updateWorkLog,
    removeWorkLog,
    scadenze,
    setScadenze,
    addScadenza,
    updateScadenza,
    removeScadenza,
    removeScadenzeByYear,
    bulkSaveScadenze,
    getScadenzeByYear,
    getPaidAccontiForYear,
    exportData,
    importData,
    syncFolderHandle,
    syncFolderName,
    isSyncing,
    lastSyncTime,
    syncError,
    syncToFolder,
    syncNow,
    syncStatus,
    listBackups,
    previewBackup,
    restoreBackup,
    setSyncFolderHandle,
    setSyncFolderName,
    setLastSyncTime
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Custom hook to use the context
export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
