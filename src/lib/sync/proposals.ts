/**
 * Ciclo di vita delle proposte (13.2): creazione, scadenza, ritiro.
 * Modulo puro. L'applicazione di una proposta (`applyProposal`) è lato app
 * e arriverà con la UI delle proposte; il server MCP non applica mai.
 */
import { compareInstants, type Proposal, type ProposalKind } from './schema';

export const PROPOSAL_EXPIRY_DAYS = 14;

export interface NewProposal {
  userId: string;
  kind: ProposalKind;
  /** Già validato con `validateProposalPayload`. */
  payload: Record<string, unknown>;
  motivazione?: string;
  /** `clientInfo.name` dell'handshake MCP. */
  client?: string;
}

export interface CreateProposalOptions {
  now: string;
  writerId: string;
  /** Iniettabile per i test; altrimenti `prop_<uuid>`. */
  id?: string;
}

export class ProposalNotPendingError extends Error {
  code = 'PROPOSAL_NOT_PENDING' as const;
  details: { proposalId: string; status: Proposal['status'] };
  constructor(proposalId: string, status: Proposal['status']) {
    super(`La proposta ${proposalId} non è in attesa: stato ${status}`);
    this.name = 'ProposalNotPendingError';
    this.details = { proposalId, status };
  }
}

export function createProposal(input: NewProposal, options: CreateProposalOptions): Proposal {
  const expiresAt = new Date(Date.parse(options.now) + PROPOSAL_EXPIRY_DAYS * 86_400_000).toISOString();
  const proposal: Proposal = {
    id: options.id ?? `prop_${globalThis.crypto.randomUUID()}`,
    userId: input.userId,
    kind: input.kind,
    payload: { ...input.payload },
    status: 'pending',
    createdAt: options.now,
    updatedAt: options.now,
    expiresAt,
    createdBy: input.client ? { writerId: options.writerId, client: input.client } : { writerId: options.writerId },
    result: null,
    rejectReason: null,
  };
  if (input.motivazione !== undefined) proposal.motivazione = input.motivazione;
  return proposal;
}

/** Stessa regola di `mergeProposals`: `expiresAt <= now` vale come scaduta. */
export function isExpired(proposal: Proposal, now: string): boolean {
  return proposal.status === 'pending' && compareInstants(proposal.expiresAt, now) <= 0;
}

export function isPending(proposal: Proposal, now: string): boolean {
  return proposal.status === 'pending' && !isExpired(proposal, now);
}

/** Vista con le scadenze applicate, senza toccare l'input né il file. */
export function withExpiry(proposals: Proposal[], now: string): Proposal[] {
  return proposals.map((p) => (isExpired(p, now) ? { ...p, status: 'expired', updatedAt: now } : p));
}

export function withdrawProposal(proposal: Proposal, now: string): Proposal {
  if (!isPending(proposal, now)) {
    throw new ProposalNotPendingError(proposal.id, isExpired(proposal, now) ? 'expired' : proposal.status);
  }
  return { ...proposal, status: 'withdrawn', updatedAt: now };
}
