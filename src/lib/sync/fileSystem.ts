/**
 * Astrazione minima del file system della cartella di sync.
 *
 * I percorsi sono relativi alla cartella di sync, separatore '/'.
 * Implementazioni: Node `fs` (server MCP, test) e File System Access API (app).
 * `move` è opzionale: la sua presenza è la feature detection della rinomina
 * atomica (specifica 13.3).
 */
export interface SyncFileSystem {
  /** Contenuto del file, oppure null se non esiste. */
  read(path: string): Promise<Uint8Array | null>;
  /** Scrive (crea o sovrascrive), creando le cartelle intermedie. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Cancella un file; nessun errore se non esiste. */
  remove(path: string): Promise<void>;
  /** Nomi dei file (non cartelle) dentro `dir`; [] se la cartella non esiste. */
  list(dir: string): Promise<string[]>;
  /** Rinomina atomica nella stessa cartella. Assente se la piattaforma non la offre. */
  move?(from: string, to: string): Promise<void>;
}
