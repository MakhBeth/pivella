import { useState, useEffect, useCallback } from 'react';
import type { Fattura } from '../types';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';

export function useFatture(dbManager: IndexedDBManager, dbReady: boolean, currentUserId: string | null) {
  const [fatture, setFatture] = useState<Fattura[]>([]);

  // Load fatture from DB when user changes
  useEffect(() => {
    if (!dbReady || !currentUserId) return;

    const loadFatture = async () => {
      try {
        const savedFatture = await dbManager.getAllForUser('fatture', currentUserId);
        setFatture(savedFatture || []);
      } catch (error) {
        console.error('Errore caricamento fatture:', error);
      }
    };
    loadFatture();
  }, [dbManager, dbReady, currentUserId]);

  const addFattura = useCallback(async (fattura: Omit<Fattura, 'userId'> & { userId?: string }) => {
    if (!currentUserId) return;
    try {
      const fatturaWithUser: Fattura = dbManager.stamp({
        ...fattura,
        userId: currentUserId
      });
      await dbManager.put('fatture', fatturaWithUser);
      setFatture(prev => [...prev, fatturaWithUser]);
    } catch (error) {
      console.error('Errore aggiunta fattura:', error);
      throw error;
    }
  }, [dbManager, currentUserId]);

  const updateFattura = useCallback(async (input: Fattura) => {
    try {
      const fattura = dbManager.stamp(input);
      await dbManager.put('fatture', fattura);
      setFatture(prev => prev.map(f => f.id === fattura.id ? fattura : f));
    } catch (error) {
      console.error('Errore aggiornamento fattura:', error);
      throw error;
    }
  }, [dbManager]);

  const removeFattura = useCallback(async (id: string) => {
    try {
      await dbManager.delete('fatture', id);
      setFatture(prev => prev.filter(f => f.id !== id));
    } catch (error) {
      console.error('Errore eliminazione fattura:', error);
      throw error;
    }
  }, [dbManager]);

  return { fatture, setFatture, addFattura, updateFattura, removeFattura };
}
