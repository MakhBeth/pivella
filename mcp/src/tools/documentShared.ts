/** Helpers per i documenti su disco, esclusi dai tool usati nel browser. */
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import type { Cliente, Config, Fattura } from '../../../src/types';
import { DatiEmittenteMancantiError, emittenteMancante, righeOrFallback } from '../../../src/lib/fatturaDocumento';
import { DataSourceError } from '../datasource';
import { documentsDir, resolveCartella } from '../documents';
import { anno, snapshotOf, validationError, type ToolContext } from './shared';

export interface DocumentoFattura { fattura: Fattura; cliente: Cliente | undefined; config: Config; dir: string; avvisi: string[]; fallbackRighe: boolean }

/** Fattura, cliente, config e cartella di destinazione per i tool genera_*. */
export async function documentoFattura(ctx: ToolContext, userId: string, fatturaId: string, cartella?: string): Promise<DocumentoFattura> {
  const snap = await snapshotOf(ctx, userId);
  const fattura = snap.fatture.find((f) => f.id === fatturaId);
  if (!fattura) throw new DataSourceError('NOT_FOUND', `Fattura ${fatturaId} inesistente per il profilo ${userId}`, { fatturaId });
  if (!snap.config) throw new DatiEmittenteMancantiError(emittenteMancante(null));
  const mancanti = emittenteMancante(snap.config);
  if (mancanti.length > 0) throw new DatiEmittenteMancantiError(mancanti);
  const cartellaRisolta = cartella !== undefined ? resolveCartella(cartella, homedir()) : undefined;
  if (cartellaRisolta !== undefined && !isAbsolute(cartellaRisolta)) throw validationError('cartella', 'deve essere un percorso assoluto');
  if (cartellaRisolta === undefined && !ctx.syncDir) throw validationError('cartella', 'indica una cartella: il server non conosce la cartella di sync');
  const cliente = snap.clienti.find((c) => c.id === fattura.clienteId);
  const avvisi: string[] = [];
  const { fallback } = righeOrFallback(fattura);
  if (fallback) avvisi.push('La fattura non ha le righe salvate: ho usato una riga unica con il totale. Controlla che corrisponda all\'XML inviato allo SDI.');
  if (!cliente) avvisi.push(`Cliente ${fattura.clienteId} non trovato: uso solo il nome salvato nella fattura.`);
  else if (!cliente.indirizzo || !cliente.cap || !cliente.comune) avvisi.push(`Indirizzo del cliente ${cliente.nome} incompleto: l'XML potrebbe essere scartato dallo SDI.`);
  return { fattura, cliente, config: snap.config, dir: cartellaRisolta ?? documentsDir(ctx.syncDir!, anno(fattura.data)), avvisi, fallbackRighe: fallback };
}
