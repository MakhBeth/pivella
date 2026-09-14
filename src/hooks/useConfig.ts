import { useState, useEffect, useCallback, useRef } from 'react';
import type { Config } from '../types';
import { DEFAULT_CONFIG } from '../lib/constants/fiscali';
import { canonicalJson, compareInstants } from '../lib/sync/schema';
import type { IndexedDBManager } from '../lib/db/IndexedDBManager';

export function useConfig(dbManager: IndexedDBManager, dbReady: boolean, currentUserId: string | null) {
  const [config, setConfig] = useState<Config>({
    ...DEFAULT_CONFIG,
    id: currentUserId ? `config_${currentUserId}` : 'main',
    userId: currentUserId || ''
  });

  const persistedRef = useRef<{ json: string; updatedAt?: string } | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Load config from DB when user changes
  useEffect(() => {
    if (!dbReady || !currentUserId) return;

    const loadConfig = async () => {
      try {
        const configId = `config_${currentUserId}`;
        const savedConfig = await dbManager.get('config', configId);
        if (savedConfig) {
          applyPersistedConfig(savedConfig);
        } else {
          // Create default config for this user
          const newConfig: Config = {
            ...DEFAULT_CONFIG,
            id: configId,
            userId: currentUserId
          };
          persistedRef.current = null;
          setConfig(newConfig);
        }
      } catch (error) {
        console.error('Errore caricamento config:', error);
      }
    };
    loadConfig();
  }, [dbManager, dbReady, currentUserId]);

  /**
   * Config già presente nel database (caricamento, merge, ripristino): viene
   * normalizzata con i default e messa in stato senza essere risalvata, così
   * non riceve un timbro nuovo e non genera un conflitto fasullo con il file.
   */
  const applyPersistedConfig = useCallback((saved: Config) => {
    const loaded: Config = { ...DEFAULT_CONFIG, ...saved, id: saved.id, userId: saved.userId };
    // Una modifica dell'utente in attesa di salvataggio (timbro più recente) non va sovrascritta.
    const current = configRef.current;
    if (current.id === loaded.id && compareInstants(current.updatedAt, loaded.updatedAt) > 0) return;
    persistedRef.current = { json: canonicalJson(loaded), updatedAt: loaded.updatedAt };
    setConfig(loaded);
  }, []);

  /** Config di default per un utente che non ne ha più una (dopo un ripristino): viene salvata. */
  const resetConfig = useCallback((userId: string) => {
    persistedRef.current = null;
    setConfig({ ...DEFAULT_CONFIG, id: `config_${userId}`, userId });
  }, []);

  // Salva solo ciò che è cambiato rispetto all'ultima versione caricata o
  // salvata. Il caricamento normalizza la config con i default: riscriverla
  // con il vecchio timbro produrrebbe un conflitto fasullo a ogni avvio
  // contro il file di sync. Una modifica arrivata senza timbro nuovo (setConfig
  // diretto) viene timbrata qui.
  useEffect(() => {
    if (!dbReady || !currentUserId) return;
    if (config.userId !== currentUserId) return;
    const json = canonicalJson(config);
    if (persistedRef.current?.json === json) return;

    const toSave = persistedRef.current && config.updatedAt === persistedRef.current.updatedAt
      ? dbManager.stamp(config)
      : config;
    persistedRef.current = { json: canonicalJson(toSave), updatedAt: toSave.updatedAt };
    const saveConfig = async () => {
      try {
        await dbManager.put('config', toSave);
      } catch (error) {
        console.error('Errore salvataggio config:', error);
      }
    };
    saveConfig();
    if (toSave !== config) setConfig(toSave);
  }, [config, dbManager, dbReady, currentUserId]);

  // Ogni modifica dell'utente timbra updatedAt e updatedBy; il caricamento da
  // DB no, così una config arrivata dal file non torna "più nuova" a ogni avvio.
  const updateConfig = useCallback((updates: Partial<Config>) => {
    setConfig(prev => dbManager.stamp({ ...prev, ...updates }));
  }, [dbManager]);

  return { config, setConfig, updateConfig, applyPersistedConfig, resetConfig };
}
