/** Registro dei 17 tool nell'ordine del contratto (13.1). */
import { getConfig } from './getConfig';
import { getFattura } from './getFattura';
import { getGiornatePerCliente } from './getGiornatePerCliente';
import { getRiepilogoAnno } from './getRiepilogoAnno';
import { listClienti } from './listClienti';
import { listFatture } from './listFatture';
import { listScadenze } from './listScadenze';
import { listUsers } from './listUsers';
import { listWorkLogs } from './listWorkLogs';
import { getProposal } from './getProposal';
import { listProposals } from './listProposals';
import { proposeCliente } from './proposeCliente';
import { proposeFattura } from './proposeFattura';
import { proposeIncasso } from './proposeIncasso';
import { proposeScadenzaPagata } from './proposeScadenzaPagata';
import { proposeWorkLog } from './proposeWorkLog';
import { withdrawProposal } from './withdrawProposal';
import type { ToolDef } from './shared';

export { runTool, type ToolContext, type ToolDef, type ToolOutcome, type ToolError } from './shared';

export const TOOLS: ToolDef[] = [
  listUsers,
  getConfig,
  listClienti,
  listFatture,
  getFattura,
  listWorkLogs,
  listScadenze,
  getRiepilogoAnno,
  getGiornatePerCliente,
  listProposals,
  getProposal,
  proposeWorkLog,
  proposeFattura,
  proposeCliente,
  proposeIncasso,
  proposeScadenzaPagata,
  withdrawProposal,
] as unknown as ToolDef[];
