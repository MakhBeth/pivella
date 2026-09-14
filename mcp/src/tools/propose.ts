/**
 * Fabbrica dei cinque tool di proposta (13.1, tool 12-16): validazione
 * condivisa con l'app, poi `addProposal`, l'unico metodo che scrive.
 * Nessun tool restituisce mai un record creato.
 */
import type { Proposal, ProposalKind } from '../../../src/lib/sync/schema';
import { validateProposalPayload, type PayloadByKind, type ValidationContext } from '../../../src/lib/sync/validate';
import { defineTool, motivazioneSchema, PROPOSAL_MESSAGE, snapshotOf, userIdSchema, type AnyShape, type ToolContext } from './shared';

export function describe(p: Proposal): string {
  return `Proposta ${p.id} (${p.kind}) per il profilo ${p.userId}: ${p.status}, creata il ${p.createdAt}, scade il ${p.expiresAt}${p.motivazione ? `. Motivazione: ${p.motivazione}` : ''}`;
}

interface ProposeSpec<K extends ProposalKind, Shape extends AnyShape> {
  name: string;
  title: string;
  description: string;
  kind: K;
  /** Parametri oltre a `userId` e `motivazione`: sono il payload della proposta. */
  payload: Shape;
  /** Campi in più nella risposta, calcolati dal payload validato. */
  extra?: (payload: PayloadByKind[K]) => Record<string, unknown>;
  summary: (payload: PayloadByKind[K]) => string;
}

export function proposeTool<K extends ProposalKind, Shape extends AnyShape>(spec: ProposeSpec<K, Shape>) {
  return defineTool({
    name: spec.name,
    title: spec.title,
    description: `${spec.description} Crea una proposta in attesa di conferma nell'app Pivella: nessun dato viene scritto finché l'utente non conferma. Passa motivazione per spiegare perché la proponi.`,
    input: { userId: userIdSchema, ...spec.payload, motivazione: motivazioneSchema },
    readOnly: false,
    async handler(ctx: ToolContext, args) {
      const { userId, motivazione, ...payload } = args as { userId: string; motivazione?: string } & Record<string, unknown>;
      const snap = await snapshotOf(ctx, userId);
      const vctx: ValidationContext = { config: snap.config, clienti: snap.clienti, fatture: snap.fatture, scadenze: snap.scadenze, today: ctx.now().toISOString().slice(0, 10) };
      const validated = validateProposalPayload(spec.kind, payload, vctx);
      const proposal = await ctx.ds.addProposal(ctx.principal, {
        userId,
        kind: spec.kind,
        payload: validated as unknown as Record<string, unknown>,
        motivazione,
        client: ctx.client,
      });
      const structured = { proposal, messaggio: PROPOSAL_MESSAGE, ...spec.extra?.(validated) };
      return { structured, text: `${spec.summary(validated)}. ${PROPOSAL_MESSAGE} (proposta ${proposal.id})` };
    },
  });
}
