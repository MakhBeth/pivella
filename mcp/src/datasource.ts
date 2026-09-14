/**
 * Interfaccia `DataSource` (specifica 13.4): l'unica dipendenza dei tool.
 * I tool non conoscono file, cartelle, handle, HTTP o database.
 */
import type { Cliente, Config, Fattura, Scadenza, User, WorkLog } from '../../src/types';
import type { NewProposal } from '../../src/lib/sync/proposals';
import type { Proposal, ProposalStatus } from '../../src/lib/sync/schema';

export type { NewProposal };

export type Principal =
  | { kind: 'local'; writerId: string }
  | { kind: 'account'; accountId: string; scopes: Array<'read' | 'propose'>; writerId: string };

export interface UserSnapshot {
  user: User;
  config: Config | null;
  clienti: Cliente[];
  fatture: Fattura[];
  workLogs: WorkLog[];
  scadenze: Scadenza[];
  readAt: string;
}

export interface ProposalFilter {
  userId: string;
  status?: ProposalStatus;
  limit?: number;
  offset?: number;
}

export type ErrorCode =
  | 'USER_NOT_FOUND'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'PROPOSAL_NOT_PENDING'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_LOCKED'
  | 'BACKUP_FAILED'
  | 'PERMISSION_DENIED'
  | 'INTERNAL';

export class DataSourceError extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DataSourceError';
    this.code = code;
    this.details = details;
  }
}

export interface DataSource {
  listUsers(p: Principal): Promise<User[]>;
  getSnapshot(p: Principal, userId: string): Promise<UserSnapshot>;
  listProposals(p: Principal, f: ProposalFilter): Promise<{ items: Proposal[]; total: number }>;
  getProposal(p: Principal, proposalId: string): Promise<Proposal | null>;
  addProposal(p: Principal, input: NewProposal): Promise<Proposal>;
  withdrawProposal(p: Principal, proposalId: string): Promise<Proposal>;
}

export const LIST_DEFAULT_LIMIT = 500;
export const LIST_MAX_LIMIT = 2000;

/** Paginazione comune a tutte le liste (13.1). */
export function paginate<T>(items: T[], limit?: number, offset?: number): { items: T[]; total: number; hasMore: boolean } {
  const size = Math.min(Math.max(1, Math.trunc(limit ?? LIST_DEFAULT_LIMIT)), LIST_MAX_LIMIT);
  const start = Math.max(0, Math.trunc(offset ?? 0));
  const page = items.slice(start, start + size);
  return { items: page, total: items.length, hasMore: start + page.length < items.length };
}
