/**
 * Aggiornamento dello stato React per differenze del merge (passo 5).
 * Per ogni store: i record `upserted` vengono sostituiti o aggiunti prendendoli
 * dallo snapshot fuso, i `deleted` tolti. Con un `userId` restano solo i
 * record di quell'utente, come fanno le liste caricate dal database.
 */
import type { StoreChanges } from './merge';

export function applyStoreChanges<T extends { id: string; userId?: string }>(
  prev: T[],
  changes: StoreChanges,
  merged: T[],
  userId?: string,
): T[] {
  if (changes.upserted.length === 0 && changes.deleted.length === 0) return prev;
  const byId = new Map(merged.map((r) => [r.id, r]));
  const deleted = new Set(changes.deleted);
  const upserted = new Map<string, T | null>();
  for (const id of changes.upserted) {
    const record = byId.get(id);
    if (!record) continue;
    upserted.set(id, !userId || record.userId === userId ? record : null);
  }
  const next: T[] = [];
  for (const record of prev) {
    if (deleted.has(record.id)) continue;
    if (upserted.has(record.id)) {
      const replacement = upserted.get(record.id);
      if (replacement) next.push(replacement);
      upserted.delete(record.id);
      continue;
    }
    next.push(record);
  }
  for (const record of upserted.values()) if (record) next.push(record);
  return next;
}
