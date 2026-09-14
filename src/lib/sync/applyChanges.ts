/**
 * Aggiornamento dello stato React per differenze del merge (passo 5).
 * Per ogni store: i record `upserted` vengono sostituiti o aggiunti prendendoli
 * dallo snapshot fuso, i `deleted` tolti. Con un `userId` restano solo i
 * record di quell'utente, come fanno le liste caricate dal database.
 *
 * Lo stato può contenere una modifica fatta dall'utente dopo il merge: un
 * record in stato con `updatedAt` più recente di quello fuso non viene
 * sovrascritto, e una cancellazione si applica solo se il tombstone è più
 * recente del record in stato. IndexedDB ha già la versione giusta: il giro
 * successivo riallinea.
 */
import type { StoreName } from '../../types';
import type { StoreChanges } from './merge';
import { compareInstants, type Tombstone } from './schema';

/** Gli id sono unici per store, non globali: a ogni store i suoi tombstone. */
export function tombstonesFor(store: StoreName, tombstones: Tombstone[]): Tombstone[] {
  return tombstones.filter((t) => t.store === store);
}

export function applyStoreChanges<T extends { id: string; userId?: string; updatedAt?: string }>(
  prev: T[],
  changes: StoreChanges,
  merged: T[],
  userId?: string,
  tombstones: Tombstone[] = [],
): T[] {
  if (changes.upserted.length === 0 && changes.deleted.length === 0) return prev;
  const byId = new Map(merged.map((r) => [r.id, r]));
  const deletedAt = new Map(tombstones.map((t) => [t.id, t.deletedAt]));
  const deleted = new Set(changes.deleted);
  const upserted = new Map<string, T | null>();
  for (const id of changes.upserted) {
    const record = byId.get(id);
    if (!record) continue;
    upserted.set(id, !userId || record.userId === userId ? record : null);
  }
  const next: T[] = [];
  for (const record of prev) {
    if (deleted.has(record.id)) {
      const when = deletedAt.get(record.id);
      // Senza tombstone noto la cancellazione viene dal merge stesso: si applica.
      if (!when || compareInstants(when, record.updatedAt) > 0) continue;
      next.push(record);
      continue;
    }
    if (upserted.has(record.id)) {
      const replacement = upserted.get(record.id);
      upserted.delete(record.id);
      if (replacement && compareInstants(replacement.updatedAt, record.updatedAt) < 0) {
        next.push(record);
        continue;
      }
      if (replacement) next.push(replacement);
      continue;
    }
    next.push(record);
  }
  for (const record of upserted.values()) if (record) next.push(record);
  return next;
}
