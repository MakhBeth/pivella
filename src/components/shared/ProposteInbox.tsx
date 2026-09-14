import { useEffect, useRef, useState } from 'react';
import { Check, Sparkles, X } from './icons';
import { useApp } from '../../context/AppContext';
import type { Proposal } from '../../lib/sync/schema';
import { proposalTitle } from '../../lib/sync/applyProposal';
import { fatturaPreview, type FatturaPayload } from '../../lib/sync/validate';
import { MISC_CLIENT_ID, VACATION_CLIENT_ID } from '../../types';

export const PROPOSTE_ANCHOR = 'proposte';

// Il router è a hash (`#/impostazioni`), quindi un secondo `#proposte` non
// passa: il banner chiede lo scorrimento qui e il riquadro lo esegue appena montato.
let scrollRequested = false;

export function goToProposte(): void {
  scrollRequested = true;
  if (window.location.hash === '#/impostazioni') {
    document.getElementById(PROPOSTE_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scrollRequested = false;
  } else {
    window.location.hash = '#/impostazioni';
  }
}

const KIND_LABEL: Record<Proposal['kind'], string> = {
  workLog: 'Giornata',
  fattura: 'Fattura',
  cliente: 'Cliente',
  incasso: 'Incasso',
  scadenzaPagata: 'Scadenza pagata',
};

function Dettagli({ proposal }: { proposal: Proposal }) {
  if (proposal.kind !== 'fattura') return null;
  const p = proposal.payload as unknown as FatturaPayload;
  const preview = fatturaPreview({ righe: p.righe ?? [], valuta: p.valuta ?? 'EUR', tassoCambio: p.tassoCambio });
  const valuta = p.valuta ?? 'EUR';
  return (
    <div className="table-wrapper" style={{ marginTop: 8 }}>
      <table className="table">
        <thead>
          <tr><th scope="col">Descrizione</th><th scope="col">Quantità</th><th scope="col">Prezzo</th><th scope="col">Totale</th></tr>
        </thead>
        <tbody>
          {preview.righe.map((r, i) => (
            <tr key={i}>
              <td>{r.descrizione}</td>
              <td>{r.quantita}</td>
              <td style={{ fontFamily: 'Space Mono' }}>{r.prezzoUnitario.toFixed(2)} {valuta}</td>
              <td style={{ fontFamily: 'Space Mono' }}>{r.totale.toFixed(2)} {valuta}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} style={{ fontWeight: 600 }}>Totale</td>
            <td style={{ fontFamily: 'Space Mono', fontWeight: 600 }}>
              {preview.totaleImponibile.toFixed(2)} {valuta}{valuta !== 'EUR' ? ` (${preview.totaleEUR.toFixed(2)} EUR)` : ''}
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>Il numero della fattura viene assegnato alla conferma, progressivo per l'anno della fattura.</p>
    </div>
  );
}

/**
 * Proposte dell'assistente (server MCP) per il profilo attivo, in attesa di
 * conferma. Nulla viene scritto finché non si conferma qui: la conferma
 * rivalida la proposta e crea il record, il rifiuto la chiude.
 */
export function ProposteInbox() {
  const { pendingProposals, confirmProposal, rejectProposal, clienti, fatture, scadenze, isSyncing, showToast } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRequested && boxRef.current) {
      scrollRequested = false;
      boxRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [pendingProposals.length]);

  if (pendingProposals.length === 0) return null;

  const resolveCliente = (id: string) => {
    if (id === VACATION_CLIENT_ID) return 'Ferie';
    if (id === MISC_CLIENT_ID) return 'Varie';
    return clienti.find((c) => c.id === id)?.nome ?? id;
  };

  const decide = async (proposal: Proposal, apply: boolean) => {
    setBusyId(proposal.id);
    setErrors((prev) => ({ ...prev, [proposal.id]: '' }));
    try {
      const done = apply ? await confirmProposal(proposal.id) : await rejectProposal(proposal.id);
      if (apply) {
        const numero = done.result?.numero ? ` Numero ${done.result.numero}.` : '';
        showToast(`Proposta confermata.${numero}`);
      } else {
        showToast('Proposta rifiutata');
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, [proposal.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div id={PROPOSTE_ANCHOR} ref={boxRef} className="backup-info" style={{ marginTop: 0, marginBottom: 16, border: '1px solid var(--accent-blue)', scrollMarginTop: 16 }} aria-live="polite">
      <h2><Sparkles size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} aria-hidden="true" /> Proposte dell'assistente ({pendingProposals.length})</h2>
      <p>Arrivano dal server MCP di Pivella. Niente viene scritto finché non confermi: ogni proposta viene ricontrollata alla conferma.</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {pendingProposals.map((p) => {
          const busy = busyId === p.id;
          return (
            <li key={p.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <span className="badge badge-yellow">{KIND_LABEL[p.kind]}</span>
                <span style={{ fontWeight: 500, flex: 1, minWidth: 200 }}>{proposalTitle(p, resolveCliente, fatture, scadenze)}</span>
              </div>
              {p.motivazione && <p style={{ marginTop: 6 }}>Motivazione: {p.motivazione}</p>}
              <p style={{ marginTop: 4 }}>
                Proposta il {new Date(p.createdAt).toLocaleString('it-IT')}{p.createdBy.client ? ` da ${p.createdBy.client}` : ''}, scade il {new Date(p.expiresAt).toLocaleDateString('it-IT')}.
              </p>
              <Dettagli proposal={p} />
              {errors[p.id] && (
                <p role="alert" style={{ color: 'var(--accent-red)', marginTop: 6 }}>{errors[p.id]}</p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" onClick={() => void decide(p, true)} disabled={busy || isSyncing}>
                  <Check size={16} aria-hidden="true" /> {busy ? 'Un attimo...' : 'Conferma'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => void decide(p, false)} disabled={busy || isSyncing}>
                  <X size={16} aria-hidden="true" /> Rifiuta
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Infobox in cima all'app, su ogni pagina: quante proposte aspettano, con il
 * salto a Impostazioni dove si confermano. Sparisce quando non ce ne sono.
 */
export function ProposteBanner({ showLink = true }: { showLink?: boolean }) {
  const { pendingProposals } = useApp();
  if (pendingProposals.length === 0) return null;
  const n = pendingProposals.length;
  return (
    <div
      role="status"
      style={{ padding: '12px 16px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.35)', borderRadius: 12, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
    >
      <Sparkles size={18} aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 200 }}>
        {n === 1 ? "L'assistente ha una proposta in attesa di conferma." : `L'assistente ha ${n} proposte in attesa di conferma.`}
      </span>
      <button className="btn btn-secondary btn-sm" onClick={goToProposte}>
        {showLink ? 'Vedi le proposte' : 'Vai alle proposte'}
      </button>
    </div>
  );
}
