import { z } from 'zod';
import { DataSourceError, paginate } from '../datasource';
import { BANK_CSV_MAX_BYTES, bankFormatPayload, bankImportRows, bankTotals } from '../../../src/lib/sync/bankProposals';
import { validateProposalPayload } from '../../../src/lib/sync/validate';
import { checkRange, dateSchema, defineTool, euro, limitSchema, motivazioneSchema, offsetSchema, PROPOSAL_MESSAGE, snapshotOf, userIdSchema } from './shared';
import { proposeTool } from './propose';

const column = z.string().trim().min(1).max(200);
const formatInput = {
  name: z.string().trim().min(1).max(200),
  delimiter: z.enum([';', ',', '\t', '|']),
  encoding: z.enum(['utf-8', 'windows-1252']),
  headerRow: z.number().int().min(1).describe('Numero della riga contenente le intestazioni, a partire da 1'),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  decimalSeparator: z.enum([',', '.']),
  amountMode: z.enum(['signed', 'split']).describe('signed: importo con segno; split: colonne entrate/uscite con valori positivi'),
  columns: z.strictObject({ date: column, description: column, amount: column.optional(), credit: column.optional(), debit: column.optional(), valueDate: column.optional(), reference: column.optional() }).describe('Intestazioni esatte del CSV. reference deve essere l’ID univoco della banca, non una causale ripetibile.'),
};
const importInput = {
  userId: userIdSchema,
  formatId: z.string().min(1).max(200).describe('ID di un formato già salvato, da list_bank_formats'),
  account: z.string().trim().min(1).max(200).describe('Nome o IBAN del conto: usa sempre lo stesso valore per riconoscere i duplicati'),
  sourceFile: z.string().trim().min(1).max(255).describe('Nome del documento di origine, senza leggere file sul server'),
  csv: z.string().min(1).max(BANK_CSV_MAX_BYTES).describe('Contenuto CSV già decodificato secondo la codifica del formato. Massimo 1 MB e 1000 movimenti per proposta.'),
};

export const listBankFormats = defineTool({
  name: 'list_bank_formats', title: 'Formati CSV bancari',
  description: 'Elenca i formati CSV del profilo, incluse le mappature dei campi. Usa l’ID scelto con preview_bank_import o propose_bank_import.',
  input: { userId: userIdSchema, limit: limitSchema, offset: offsetSchema }, readOnly: true,
  async handler(ctx, { userId, limit, offset }) {
    const snap = await snapshotOf(ctx, userId);
    const sorted = [...snap.bankFormats].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const { items, total, hasMore } = paginate(sorted, limit, offset);
    return { structured: { formats: items, total, hasMore }, text: `${total} formati CSV bancari.` };
  },
});

export const listBankTransactions = defineTool({
  name: 'list_bank_transactions', title: 'Movimenti bancari e flusso netto',
  description: 'Movimenti bancari importati, filtrabili per conto, date e direzione. Totali in EUR su tutto il filtro, indipendenti dalla pagina: entrate, uscite positive e netto. Il netto non è il saldo del conto e i movimenti non equivalgono agli incassi fiscali delle fatture.',
  input: { userId: userIdSchema, account: z.string().trim().min(1).optional(), da: dateSchema.optional(), a: dateSchema.optional(), direction: z.enum(['in', 'out']).optional(), limit: limitSchema, offset: offsetSchema },
  readOnly: true,
  async handler(ctx, { userId, account, da, a, direction, limit, offset }) {
    if (da && a) checkRange(da, a);
    const snap = await snapshotOf(ctx, userId);
    const filtered = snap.bankTransactions.filter(t =>
      (!account || t.account.toLocaleLowerCase('it') === account.toLocaleLowerCase('it')) &&
      (!da || t.date >= da) && (!a || t.date <= a) &&
      (!direction || (direction === 'in' ? t.amountCents > 0 : t.amountCents < 0)),
    ).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const totali = bankTotals(filtered);
    const { items, total, hasMore } = paginate(filtered.map(t => ({ ...t, importo: t.amountCents / 100, valuta: 'EUR' })), limit, offset);
    return { structured: { transactions: items, total, hasMore, totali }, text: `${total} movimenti: entrate ${euro(totali.entrate)}, uscite ${euro(totali.uscite)}, flusso netto ${euro(totali.netto)}.` };
  },
});

async function importPreview(ctx: Parameters<typeof snapshotOf>[0], args: z.infer<z.ZodObject<typeof importInput>>) {
  const snap = await snapshotOf(ctx, args.userId);
  const format = snap.bankFormats.find(f => f.id === args.formatId);
  if (!format) throw new DataSourceError('NOT_FOUND', 'Formato bancario inesistente per questo profilo.');
  const payload = validateProposalPayload('bankImport', {
    formatId: args.formatId, format: bankFormatPayload(format), account: args.account, sourceFile: args.sourceFile, csv: args.csv,
  }, { ...snap, today: ctx.now().toISOString().slice(0, 10) });
  const rows = bankImportRows(payload, args.userId);
  const keys = new Set(snap.bankTransactions.map(t => t.importKey));
  const fresh = rows.filter(t => !keys.has(t.importKey));
  return { payload, rows, fresh, keys };
}

export const previewBankImport = defineTool({
  name: 'preview_bank_import', title: 'Anteprima importazione bancaria',
  description: 'Valida un CSV usando un formato salvato e mostra righe, duplicati e totali dei nuovi movimenti. Non salva nulla. Gli errori di una riga bloccano l’intero import. Senza ID bancario univoco, operazioni identiche in estratti parziali possono risultare già importate.',
  input: { ...importInput, limit: limitSchema, offset: offsetSchema }, readOnly: true,
  async handler(ctx, args) {
    const { rows, fresh, keys } = await importPreview(ctx, args);
    const { items, total, hasMore } = paginate(rows.map(row => ({ ...row, importo: row.amountCents / 100, duplicate: keys.has(row.importKey) })), args.limit, args.offset);
    return { structured: { rows: items, total, hasMore, newCount: fresh.length, duplicateCount: rows.length - fresh.length, totaliNuovi: bankTotals(fresh) }, text: `${rows.length} movimenti validi: ${fresh.length} nuovi, ${rows.length - fresh.length} già importati. Nessun dato salvato.` };
  },
});

export const proposeBankFormat = proposeTool({
  name: 'propose_bank_format', title: 'Proponi un formato CSV bancario', kind: 'bankFormat',
  description: 'Propone un nuovo formato CSV riutilizzabile per movimenti in EUR. Non modifica formati esistenti. Dopo la conferma nell’app, recupera l’ID con list_bank_formats prima di proporre un’importazione.',
  payload: formatInput, summary: p => `Nuovo formato CSV ${p.name}`,
});

export const proposeBankImport = defineTool({
  name: 'propose_bank_import', title: 'Proponi importazione bancaria',
  description: 'Valida il CSV e propone di importarlo usando un formato salvato. Crea soltanto una proposta: l’utente deve confermarla in Pivella. Il formato viene ricontrollato e i duplicati vengono ricalcolati alla conferma. Non modifica gli incassi delle fatture. Limiti: 1 MB e 1000 movimenti.',
  input: { ...importInput, motivazione: motivazioneSchema }, readOnly: false,
  async handler(ctx, args) {
    const { payload, rows, fresh } = await importPreview(ctx, args);
    if (!fresh.length) throw new DataSourceError('VALIDATION', 'Tutti i movimenti sono già importati; nessuna proposta creata.');
    const proposal = await ctx.ds.addProposal(ctx.principal, { userId: args.userId, kind: 'bankImport', payload: { ...payload }, motivazione: args.motivazione, client: ctx.client });
    return { structured: { proposal, messaggio: PROPOSAL_MESSAGE, newCount: fresh.length, duplicateCount: rows.length - fresh.length, totaliNuovi: bankTotals(fresh) }, text: `${fresh.length} movimenti da importare sul conto ${args.account}. ${PROPOSAL_MESSAGE} (proposta ${proposal.id})` };
  },
});
