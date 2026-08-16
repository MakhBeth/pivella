import { useState, useEffect, useCallback } from 'react';
import type { User } from '../types';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';

const CURRENT_USER_KEY = 'pivella_current_user_id';
// Pre-rename key, read as fallback so existing users keep their session
const LEGACY_CURRENT_USER_KEY = 'forfettino_current_user_id';

export function useUsers(dbManager: IndexedDBManager, dbReady: boolean) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load users and run migration on mount
  useEffect(() => {
    if (!dbReady) return;

    const initUsers = async () => {
      try {
        console.log('[useUsers] Starting migration...');
        // Run migration (creates default user if none exist)
        const migratedUserId = await dbManager.migrateToMultiUser();
        console.log('[useUsers] Migration done, userId:', migratedUserId);

        // Load all users
        const savedUsers = await dbManager.getAll('users');
        console.log('[useUsers] Loaded users:', savedUsers);
        setUsers(savedUsers || []);

        // Get stored current user id from localStorage
        const storedUserId =
          localStorage.getItem(CURRENT_USER_KEY) ?? localStorage.getItem(LEGACY_CURRENT_USER_KEY);
        console.log('[useUsers] Stored userId:', storedUserId);

        // Validate stored user exists
        const validUser = savedUsers.find((u: User) => u.id === storedUserId);
        if (validUser) {
          setCurrentUserId(storedUserId);
          console.log('[useUsers] Using stored userId');
        } else {
          // Use the migrated/first user
          setCurrentUserId(migratedUserId);
          localStorage.setItem(CURRENT_USER_KEY, migratedUserId);
          console.log('[useUsers] Using migrated userId');
        }

        setIsInitialized(true);
        console.log('[useUsers] Initialized!');
      } catch (error) {
        console.error('[useUsers] Errore inizializzazione utenti:', error);
      }
    };

    initUsers();
  }, [dbManager, dbReady]);

  const currentUser = users.find(u => u.id === currentUserId) || null;

  const switchUser = useCallback((userId: string) => {
    const user = users.find(u => u.id === userId);
    if (user) {
      setCurrentUserId(userId);
      localStorage.setItem(CURRENT_USER_KEY, userId);
    }
  }, [users]);

  const addUser = useCallback(async (nome: string) => {
    if (!dbReady || !dbManager.db) {
      throw new Error('Database non pronto');
    }
    try {
      const newUser: User = {
        id: 'user_' + Date.now().toString(),
        nome,
        createdAt: new Date().toISOString()
      };
      await dbManager.put('users', newUser);
      setUsers(prev => [...prev, newUser]);
      return newUser;
    } catch (error) {
      console.error('Errore aggiunta utente:', error);
      throw error;
    }
  }, [dbManager, dbReady]);

  const updateUser = useCallback(async (user: User) => {
    if (!dbReady || !dbManager.db) {
      throw new Error('Database non pronto');
    }
    try {
      await dbManager.put('users', user);
      setUsers(prev => prev.map(u => u.id === user.id ? user : u));
    } catch (error) {
      console.error('Errore aggiornamento utente:', error);
      throw error;
    }
  }, [dbManager, dbReady]);

  const deleteUser = useCallback(async (userId: string) => {
    if (!dbReady || !dbManager.db) {
      throw new Error('Database non pronto');
    }
    // Prevent deleting the last user
    if (users.length <= 1) {
      throw new Error('Impossibile eliminare l\'ultimo utente');
    }

    try {
      // Delete user
      await dbManager.delete('users', userId);

      // Delete all user data
      const clienti = await dbManager.getAll('clienti');
      for (const c of clienti.filter((c: any) => c.userId === userId)) {
        await dbManager.delete('clienti', c.id);
      }

      const fatture = await dbManager.getAll('fatture');
      for (const f of fatture.filter((f: any) => f.userId === userId)) {
        await dbManager.delete('fatture', f.id);
      }

      const workLogs = await dbManager.getAll('workLogs');
      for (const w of workLogs.filter((w: any) => w.userId === userId)) {
        await dbManager.delete('workLogs', w.id);
      }

      const scadenze = await dbManager.getAll('scadenze');
      for (const s of scadenze.filter((s: any) => s.userId === userId)) {
        await dbManager.delete('scadenze', s.id);
      }

      // Delete user config
      await dbManager.delete('config', `config_${userId}`);

      // Update state
      const remainingUsers = users.filter(u => u.id !== userId);
      setUsers(remainingUsers);

      // If deleted user was current, switch to first remaining
      if (currentUserId === userId && remainingUsers.length > 0) {
        setCurrentUserId(remainingUsers[0].id);
        localStorage.setItem(CURRENT_USER_KEY, remainingUsers[0].id);
      }
    } catch (error) {
      console.error('Errore eliminazione utente:', error);
      throw error;
    }
  }, [dbManager, dbReady, users, currentUserId]);

  return {
    users,
    setUsers,
    currentUserId,
    currentUser,
    isInitialized,
    switchUser,
    addUser,
    updateUser,
    deleteUser
  };
}
