import { useState, useEffect, useCallback } from 'react';
import type { Scadenza } from '../types';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';

export function useScadenze(dbManager: IndexedDBManager, dbReady: boolean, currentUserId: string | null) {
  const [scadenze, setScadenze] = useState<Scadenza[]>([]);

  useEffect(() => {
    if (!dbReady || !currentUserId) return;

    const loadScadenze = async () => {
      try {
        const savedScadenze = await dbManager.getAllForUser('scadenze', currentUserId);
        setScadenze(savedScadenze || []);
      } catch (error) {
        console.error('Errore caricamento scadenze:', error);
      }
    };
    loadScadenze();
  }, [dbManager, dbReady, currentUserId]);

  const addScadenza = useCallback(async (scadenza: Omit<Scadenza, 'userId'> & { userId?: string }) => {
    if (!currentUserId) return;
    try {
      const scadenzaWithUser: Scadenza = dbManager.stamp({
        ...scadenza,
        userId: currentUserId
      });
      await dbManager.put('scadenze', scadenzaWithUser);
      setScadenze(prev => [...prev, scadenzaWithUser]);
    } catch (error) {
      console.error('Errore aggiunta scadenza:', error);
      throw error;
    }
  }, [dbManager, currentUserId]);

  const updateScadenza = useCallback(async (input: Scadenza) => {
    try {
      const scadenza = dbManager.stamp(input);
      await dbManager.put('scadenze', scadenza);
      setScadenze(prev => prev.map(s => s.id === scadenza.id ? scadenza : s));
    } catch (error) {
      console.error('Errore aggiornamento scadenza:', error);
      throw error;
    }
  }, [dbManager]);

  const removeScadenza = useCallback(async (id: string) => {
    try {
      await dbManager.delete('scadenze', id);
      setScadenze(prev => prev.filter(s => s.id !== id));
    } catch (error) {
      console.error('Errore eliminazione scadenza:', error);
      throw error;
    }
  }, [dbManager]);

  const removeScadenzeByYear = useCallback(async (annoVersamento: number) => {
    if (!currentUserId) return;
    try {
      const allScadenze: Scadenza[] = await dbManager.getAllForUser('scadenze', currentUserId);
      const toRemove = allScadenze.filter(s => s.annoVersamento === annoVersamento);
      for (const s of toRemove) {
        await dbManager.delete('scadenze', s.id);
      }
      setScadenze(prev => prev.filter(s => s.annoVersamento !== annoVersamento));
    } catch (error) {
      console.error('Errore eliminazione scadenze per anno:', error);
      throw error;
    }
  }, [dbManager, currentUserId]);

  const bulkSaveScadenze = useCallback(async (newScadenze: Array<Omit<Scadenza, 'userId'> & { userId?: string }>) => {
    if (!currentUserId) return;
    try {
      const scadenzeWithUser: Scadenza[] = newScadenze.map(s => dbManager.stamp({
        ...s,
        userId: currentUserId
      }));
      for (const scadenza of scadenzeWithUser) {
        await dbManager.put('scadenze', scadenza);
      }
      setScadenze(prev => {
        const existingIds = new Set(scadenzeWithUser.map(s => s.id));
        const filtered = prev.filter(s => !existingIds.has(s.id));
        return [...filtered, ...scadenzeWithUser];
      });
    } catch (error) {
      console.error('Errore salvataggio scadenze:', error);
      throw error;
    }
  }, [dbManager, currentUserId]);

  const getScadenzeByYear = useCallback((annoVersamento: number) => {
    return scadenze.filter(s => s.annoVersamento === annoVersamento);
  }, [scadenze]);

  const getPaidAccontiForYear = useCallback((annoRiferimento: number) => {
    const relevantScadenze = scadenze.filter(
      s => s.annoRiferimento === annoRiferimento && s.pagato
    );

    const irpefPaid = relevantScadenze
      .filter(s => s.tipo === 'acconto_irpef')
      .reduce((sum, s) => sum + s.importo, 0);

    const inpsPaid = relevantScadenze
      .filter(s => s.tipo === 'acconto_inps')
      .reduce((sum, s) => sum + s.importo, 0);

    return { irpefPaid, inpsPaid };
  }, [scadenze]);

  return {
    scadenze,
    setScadenze,
    addScadenza,
    updateScadenza,
    removeScadenza,
    removeScadenzeByYear,
    bulkSaveScadenze,
    getScadenzeByYear,
    getPaidAccontiForYear,
  };
}
