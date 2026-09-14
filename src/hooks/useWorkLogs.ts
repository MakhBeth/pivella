import { useState, useEffect, useCallback } from 'react';
import type { WorkLog } from '../types';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';

export function useWorkLogs(dbManager: IndexedDBManager, dbReady: boolean, currentUserId: string | null) {
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);

  // Load work logs from DB when user changes
  useEffect(() => {
    if (!dbReady || !currentUserId) return;

    const loadWorkLogs = async () => {
      try {
        const savedWorkLogs = await dbManager.getAllForUser('workLogs', currentUserId);
        setWorkLogs(savedWorkLogs || []);
      } catch (error) {
        console.error('Errore caricamento work logs:', error);
      }
    };
    loadWorkLogs();
  }, [dbManager, dbReady, currentUserId]);

  const addWorkLog = useCallback(async (workLog: Omit<WorkLog, 'userId'> & { userId?: string }) => {
    if (!currentUserId) return;
    try {
      const workLogWithUser: WorkLog = dbManager.stamp({
        ...workLog,
        userId: currentUserId
      });
      await dbManager.put('workLogs', workLogWithUser);
      setWorkLogs(prev => [...prev, workLogWithUser]);
    } catch (error) {
      console.error('Errore aggiunta work log:', error);
      throw error;
    }
  }, [dbManager, currentUserId]);

  const updateWorkLog = useCallback(async (input: WorkLog) => {
    try {
      const workLog = dbManager.stamp(input);
      await dbManager.put('workLogs', workLog);
      setWorkLogs(prev => prev.map(w => w.id === workLog.id ? workLog : w));
    } catch (error) {
      console.error('Errore aggiornamento work log:', error);
      throw error;
    }
  }, [dbManager]);

  const removeWorkLog = useCallback(async (id: string) => {
    try {
      await dbManager.delete('workLogs', id);
      setWorkLogs(prev => prev.filter(w => w.id !== id));
    } catch (error) {
      console.error('Errore eliminazione work log:', error);
      throw error;
    }
  }, [dbManager]);

  return { workLogs, setWorkLogs, addWorkLog, updateWorkLog, removeWorkLog };
}
