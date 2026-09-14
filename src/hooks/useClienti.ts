import { useState, useEffect, useCallback } from 'react';
import type { Cliente } from '../types';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';

export function useClienti(dbManager: IndexedDBManager, dbReady: boolean, currentUserId: string | null) {
  const [clienti, setClienti] = useState<Cliente[]>([]);

  // Load clienti from DB when user changes
  useEffect(() => {
    if (!dbReady || !currentUserId) return;

    const loadClienti = async () => {
      try {
        const savedClienti = await dbManager.getAllForUser('clienti', currentUserId);
        setClienti(savedClienti || []);
      } catch (error) {
        console.error('Errore caricamento clienti:', error);
      }
    };
    loadClienti();
  }, [dbManager, dbReady, currentUserId]);

  const addCliente = useCallback(async (cliente: Omit<Cliente, 'userId'> & { userId?: string }) => {
    if (!currentUserId) return;
    try {
      const clienteWithUser: Cliente = dbManager.stamp({
        ...cliente,
        userId: currentUserId
      });
      await dbManager.put('clienti', clienteWithUser);
      setClienti(prev => [...prev, clienteWithUser]);
    } catch (error) {
      console.error('Errore aggiunta cliente:', error);
      throw error;
    }
  }, [dbManager, currentUserId]);

  const updateCliente = useCallback(async (input: Cliente) => {
    try {
      const cliente = dbManager.stamp(input);
      await dbManager.put('clienti', cliente);
      setClienti(prev => prev.map(c => c.id === cliente.id ? cliente : c));
    } catch (error) {
      console.error('Errore aggiornamento cliente:', error);
      throw error;
    }
  }, [dbManager]);

  const removeCliente = useCallback(async (id: string) => {
    try {
      await dbManager.delete('clienti', id);
      setClienti(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      console.error('Errore eliminazione cliente:', error);
      throw error;
    }
  }, [dbManager]);

  return { clienti, setClienti, addCliente, updateCliente, removeCliente };
}
