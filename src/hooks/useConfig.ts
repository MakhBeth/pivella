import { useState, useEffect, useCallback } from 'react';
import type { Config } from '../types';
import { DEFAULT_CONFIG } from '../lib/constants/fiscali';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';

export function useConfig(dbManager: IndexedDBManager, dbReady: boolean, currentUserId: string | null) {
  const [config, setConfig] = useState<Config>({
    ...DEFAULT_CONFIG,
    id: currentUserId ? `config_${currentUserId}` : 'main',
    userId: currentUserId || ''
  });

  // Load config from DB when user changes
  useEffect(() => {
    if (!dbReady || !currentUserId) return;

    const loadConfig = async () => {
      try {
        const configId = `config_${currentUserId}`;
        const savedConfig = await dbManager.get('config', configId);
        if (savedConfig) {
          setConfig({
            ...DEFAULT_CONFIG,
            ...savedConfig,
            id: configId,
            userId: currentUserId,
          });
        } else {
          // Create default config for this user
          const newConfig: Config = {
            ...DEFAULT_CONFIG,
            id: configId,
            userId: currentUserId
          };
          setConfig(newConfig);
        }
      } catch (error) {
        console.error('Errore caricamento config:', error);
      }
    };
    loadConfig();
  }, [dbManager, dbReady, currentUserId]);

  // Save config to DB whenever it changes
  useEffect(() => {
    if (!dbReady || !currentUserId) return;
    // Don't save if config doesn't match current user
    if (config.userId !== currentUserId) return;

    const saveConfig = async () => {
      try {
        await dbManager.put('config', config);
      } catch (error) {
        console.error('Errore salvataggio config:', error);
      }
    };
    saveConfig();
  }, [config, dbManager, dbReady, currentUserId]);

  // Ogni modifica dell'utente timbra updatedAt e updatedBy; il caricamento da
  // DB no, così una config arrivata dal file non torna "più nuova" a ogni avvio.
  const updateConfig = useCallback((updates: Partial<Config>) => {
    setConfig(prev => dbManager.stamp({ ...prev, ...updates }));
  }, [dbManager]);

  return { config, setConfig, updateConfig };
}
