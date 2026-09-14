/**
 * Applicazione di una proposta nell'app (13.4, `applyProposal` lato app):
 * rivalida il payload con le stesse regole del server, poi traduce la
 * proposta nei record da scrivere. Puro: chi chiama esegue le scritture.
 * Solo l'app applica; il server MCP non passa mai di qui.
 */
import type { Cliente, Fattura, Scadenza, StoreName, WorkLog } from '../../types';
import { isPending, ProposalNotPendingError } from './proposals';
import type { Proposal, SyncRecord } from './schema';
import { fatturaPreview, ProposalValidationError, validateProposalPayload, valuteDisponibili, type ClientePayload, type FatturaPayload, type ValidationContext, type WorkLogPayload } from './validate';

export interface PlanContext extends ValidationContext {
  userId: string;
  /** Istante ISO dell'applicazione. */
  now: string;
  /** Generatore di id per i record nuovi; l'app usa `Date.now()` come oggi. */
  newId: () => string;
}

export interface ProposalPlan {
  puts: Array<{ store: StoreName; record: SyncRecord }>;
  result: { recordId: string; numero?: string };
}

/**
 * Progressivo `max + 1` tra le fatture dell'anno della data della fattura,
 * con due cifre minime: in un anno nuovo riparte da 1 (decisione di Davide,
 * 14/9/2026). Il modale conta sull'anno corrente; qui conta l'anno giusto.
 */
export function nextInvoiceNumber(fatture: Fattura[], anno: number): string {
  let max = 0;
  for (const f of fatture) {
    if (Number(f.data.slice(0, 4)) !== anno) continue;
    const n = parseInt(f.numero || '0', 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1).padStart(2, '0');
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function clienteFromPayload(id: string, userId: string, p: ClientePayload): Cliente {
  return { id, userId, ...p };
}

function planFattura(p: FatturaPayload, ctx: PlanContext): ProposalPlan {
  const puts: ProposalPlan['puts'] = [];
  let clienteId: string;
  let clienteNome: string;
  if (p.nuovoCliente) {
    const { denominazione, partitaIva, ...rest } = p.nuovoCliente;
    const cliente: Cliente = {
      id: ctx.newId(),
      userId: ctx.userId,
      nome: denominazione,
      ...(partitaIva !== undefined ? { piva: partitaIva } : {}),
      ...rest,
      nazione: rest.nazione ?? 'IT',
    };
    puts.push({ store: 'clienti', record: cliente });
    clienteId = cliente.id;
    clienteNome = cliente.nome;
  } else {
    const cliente = ctx.clienti.find((c) => c.id === p.clienteId);
    if (!cliente) throw new ProposalValidationError('VALIDATION', [{ field: 'clienteId', reason: 'cliente inesistente per questo profilo' }]);
    clienteId = cliente.id;
    clienteNome = cliente.nome;
  }

  const preview = fatturaPreview(p);
  const isForeign = p.valuta !== 'EUR';
  const valuta = valuteDisponibili(ctx.config).find((v) => v.codice === p.valuta) ?? { codice: p.valuta, simbolo: p.valuta };
  const numero = nextInvoiceNumber(ctx.fatture, Number(p.data.slice(0, 4)));
  // Stessa forma del modale NuovaFatturaModal: importo sempre in EUR,
  // importoValuta e tassoCambio solo per una valuta estera, dataIncasso
  // uguale alla data se non indicata.
  const fattura: Fattura = {
    id: ctx.newId(),
    userId: ctx.userId,
    numero,
    importo: isForeign ? round2(preview.totaleEUR) : preview.totaleImponibile,
    ...(isForeign ? { importoValuta: preview.totaleImponibile } : {}),
    data: p.data,
    dataIncasso: p.dataIncasso ?? p.data,
    clienteId,
    clienteNome,
    duplicateKey: `${numero}-${p.data}-${preview.totaleImponibile}`,
    valuta: valuta.codice,
    valutaSimbolo: valuta.simbolo,
    ...(isForeign && p.tassoCambio !== undefined ? { tassoCambio: p.tassoCambio } : {}),
  };
  puts.push({ store: 'fatture', record: fattura });
  return { puts, result: { recordId: fattura.id, numero } };
}

/** Rivalida e pianifica. Lancia `ProposalValidationError` se la proposta non regge più. */
export function planProposal(proposal: Proposal, ctx: PlanContext): ProposalPlan {
  if (proposal.userId !== ctx.userId) {
    throw new ProposalValidationError('VALIDATION', [{ field: 'userId', reason: 'la proposta appartiene a un altro profilo' }]);
  }
  switch (proposal.kind) {
    case 'workLog': {
      const p = validateProposalPayload('workLog', proposal.payload, ctx) as WorkLogPayload;
      const record: WorkLog = { id: ctx.newId(), userId: ctx.userId, ...p };
      return { puts: [{ store: 'workLogs', record }], result: { recordId: record.id } };
    }
    case 'cliente': {
      const p = validateProposalPayload('cliente', proposal.payload, ctx);
      const record = clienteFromPayload(ctx.newId(), ctx.userId, p);
      return { puts: [{ store: 'clienti', record }], result: { recordId: record.id } };
    }
    case 'incasso': {
      const p = validateProposalPayload('incasso', proposal.payload, ctx);
      const fattura = ctx.fatture.find((f) => f.id === p.fatturaId)!;
      const record: Fattura = { ...fattura, incassato: true, dataIncasso: p.dataIncasso };
      return { puts: [{ store: 'fatture', record }], result: { recordId: record.id } };
    }
    case 'scadenzaPagata': {
      const p = validateProposalPayload('scadenzaPagata', proposal.payload, ctx);
      const scadenza = ctx.scadenze.find((s) => s.id === p.scadenzaId)!;
      const record: Scadenza = { ...scadenza, pagato: true, dataPagamento: p.dataPagamento };
      return { puts: [{ store: 'scadenze', record }], result: { recordId: record.id } };
    }
    case 'fattura':
      return planFattura(validateProposalPayload('fattura', proposal.payload, ctx), ctx);
    default:
      throw new ProposalValidationError('VALIDATION', [{ field: 'kind', reason: `kind sconosciuto: ${String(proposal.kind)}` }]);
  }
}

export type ProposalDecision =
  | { status: 'applied'; result: { recordId: string; numero?: string } }
  | { status: 'rejected'; rejectReason: string | null };

/** Transizione da `pending` a `applied` o `rejected` (13.2): gli stati terminali non cambiano più. */
export function finishProposal(proposal: Proposal, decision: ProposalDecision, now: string): Proposal {
  if (!isPending(proposal, now)) throw new ProposalNotPendingError(proposal.id, proposal.status);
  return decision.status === 'applied'
    ? { ...proposal, status: 'applied', result: decision.result, updatedAt: now }
    : { ...proposal, status: 'rejected', rejectReason: decision.rejectReason, updatedAt: now };
}

function itDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Titolo leggibile di una proposta, per la lista nell'app. */
export function proposalTitle(proposal: Proposal, resolveCliente: (id: string) => string, fatture: Fattura[] = [], scadenze: Scadenza[] = []): string {
  const p = proposal.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  switch (proposal.kind) {
    case 'workLog': {
      const q = typeof p.quantita === 'number' ? p.quantita : 0;
      const ore = p.tipo === 'ore';
      return `${ore ? 'Ore' : 'Giornata'} per ${resolveCliente(str('clienteId'))} il ${itDate(str('data'))}: ${q} ${ore ? 'ore' : q === 1 ? 'giornata' : 'giornate'}`;
    }
    case 'cliente':
      return `Nuovo cliente ${str('nome')}`;
    case 'incasso': {
      const f = fatture.find((x) => x.id === str('fatturaId'));
      return `Incasso della fattura ${f?.numero ?? str('fatturaId')} il ${itDate(str('dataIncasso'))}`;
    }
    case 'scadenzaPagata': {
      const s = scadenze.find((x) => x.id === str('scadenzaId'));
      return `Scadenza ${s?.label ?? str('scadenzaId')} pagata il ${itDate(str('dataPagamento'))}`;
    }
    case 'fattura': {
      const righe = Array.isArray(p.righe) ? (p.righe as Array<{ quantita: number; prezzoUnitario: number }>) : [];
      const totale = round2(righe.reduce((sum, r) => sum + (Number(r.quantita) || 0) * (Number(r.prezzoUnitario) || 0), 0));
      const chi = p.clienteId ? resolveCliente(str('clienteId')) : ((p.nuovoCliente as { denominazione?: string } | undefined)?.denominazione ?? '?');
      return `Fattura a ${chi} del ${itDate(str('data'))}: ${totale.toFixed(2)} ${str('valuta') || 'EUR'}`;
    }
    default:
      return `Proposta ${proposal.kind}`;
  }
}
