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
  syncToFolder: () => Promise<void>;
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

  useEffect(() => {
    setConfigRef.current = setConfig;
    setClientiRef.current = setClienti;
    setFattureRef.current = setFatture;
    setWorkLogsRef.current = setWorkLogs;
    setScadenzeRef.current = setScadenze;
    setUsersRef.current = setUsers;
  }, [setConfig, setClienti, setFatture, setWorkLogs, setScadenze, setUsers]);

  // Folder sync with load on startup
  // Returns true if data was migrated and needs to be synced back
  const handleDataLoaded = useCallback(async (data: Record<string, any[]>): Promise<boolean> => {
    console.log('[AppContext] handleDataLoaded called with:', data);
    console.log('[AppContext] currentUserId:', currentUserId);

    // Check if data needs migration (no users or records without userId)
    let targetUserId = currentUserId;
    let wasMigrated = false;

    if (!data.users || data.users.length === 0) {
      console.log('[AppContext] No users in synced data, migrating...');
      wasMigrated = true;

      // Use existing currentUserId if available (from useUsers migration)
      // Otherwise create a new one
      let defaultUserId = currentUserId;
      if (!defaultUserId) {
        // This shouldn't happen since we wait for isUsersInitialized
        console.warn('[AppContext] No currentUserId available, creating new user');
        defaultUserId = 'user_' + Date.now().toString();
      }

      // Get existing user from DB if available
      const existingUsers = await dbManager.getAll('users');
      console.log('[AppContext] Existing users in DB:', existingUsers);

      let userToUse: User;
      if (existingUsers.length > 0 && existingUsers.find((u: User) => u.id === defaultUserId)) {
        userToUse = existingUsers.find((u: User) => u.id === defaultUserId)!;
        console.log('[AppContext] Using existing user:', userToUse);
      } else if (existingUsers.length > 0) {
        userToUse = existingUsers[0];
        defaultUserId = userToUse.id;
        console.log('[AppContext] Using first existing user:', userToUse);
      } else {
        userToUse = {
          id: defaultUserId,
          nome: 'Utente Principale',
          createdAt: new Date().toISOString()
        };
        console.log('[AppContext] Creating new user:', userToUse);
      }

      data.users = [userToUse];
      targetUserId = defaultUserId;

      // Migrate config
      if (data.config) {
        data.config = data.config.map((c: any) => ({
          ...c,
          id: c.userId ? c.id : `config_${defaultUserId}`,
          userId: c.userId || defaultUserId
        }));
      }

      // Migrate all other records
      if (data.clienti) {
        data.clienti = data.clienti.map((c: any) => ({ ...c, userId: c.userId || defaultUserId }));
      }
      if (data.fatture) {
        data.fatture = data.fatture.map((f: any) => ({ ...f, userId: f.userId || defaultUserId }));
      }
      if (data.workLogs) {
        data.workLogs = data.workLogs.map((w: any) => ({ ...w, userId: w.userId || defaultUserId }));
      }
      if (data.scadenze) {
        data.scadenze = data.scadenze.map((s: any) => ({ ...s, userId: s.userId || defaultUserId }));
      }

      // Store the user id
      localStorage.setItem('pivella_current_user_id', defaultUserId!);
      console.log('[AppContext] Migration complete, userId:', defaultUserId);
    } else {
      // Use the first user if currentUserId is not set
      if (!targetUserId) {
        targetUserId = data.users[0].id;
        localStorage.setItem('pivella_current_user_id', targetUserId!);
      }
    }

    // Import data into IndexedDB
    console.log('[AppContext] Importing data to IndexedDB...');
    try {
      await dbManager.importAll(data);
      console.log('[AppContext] Import complete');
    } catch (err) {
      console.error('[AppContext] Import failed:', err);
      throw err;
    }

    // Then update state - filter by target user for data, but keep all users
    if (data.users) {
      setUsersRef.current(data.users);
    }
    if (data.config && targetUserId) {
      const userConfig = data.config.find((c: Config) => c.userId === targetUserId);
      if (userConfig) setConfigRef.current(userConfig);
    }
    if (data.clienti && targetUserId) {
      setClientiRef.current(data.clienti.filter((c: Cliente) => c.userId === targetUserId));
    }
    if (data.fatture && targetUserId) {
      setFattureRef.current(data.fatture.filter((f: Fattura) => f.userId === targetUserId));
    }
    if (data.workLogs && targetUserId) {
      setWorkLogsRef.current(data.workLogs.filter((w: WorkLog) => w.userId === targetUserId));
    }
    if (data.scadenze && targetUserId) {
      setScadenzeRef.current(data.scadenze.filter((s: Scadenza) => s.userId === targetUserId));
    }

    return wasMigrated;
  }, [dbManager, currentUserId]);

  const {
    syncFolderHandle,
    syncFolderName,
    isSyncing,
    lastSyncTime,
    isInitialLoadDone,
    syncToFolder,
    setSyncFolderHandle,
    setSyncFolderName,
    setLastSyncTime
  } = useFolderSync({
    dbManager,
    dbReady,
    isUsersInitialized,
    onDataLoaded: handleDataLoaded
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
    } else {
      // No user color: let the active design style's tokens apply
      document.documentElement.style.removeProperty('--accent-primary');
      document.documentElement.style.removeProperty('--accent-secondary');
      document.documentElement.style.removeProperty('--on-accent');
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
    syncToFolder,
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
