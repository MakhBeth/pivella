import { useState } from 'react';
import { Upload, FileText, Trash2, Edit, FileArchive, FilePlus, Landmark, ChevronDown } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import { Currency } from '../ui/Currency';
import type { Fattura } from '../../types';

interface FattureProps {
  setShowModal: (modal: string | null) => void;
  setEditingFattura: (fattura: Fattura) => void;
}

export function FatturePage({ setShowModal, setEditingFattura }: FattureProps) {
  const { clienti, fatture, removeFattura } = useApp();
  const [filtroAnnoFatture, setFiltroAnnoFatture] = useState<string>(String(new Date().getFullYear()));
  const [ordinamentoFatture, setOrdinamentoFatture] = useState<{ campo: string; direzione: string }>({ campo: 'dataIncasso', direzione: 'desc' });

  // Anni disponibili nelle fatture (sempre incluso l'anno corrente, default del filtro)
  const anniDisponibili = [...new Set([
    new Date().getFullYear(),
    ...fatture.map(f => {
      const dataRiferimento = f.dataIncasso || f.data;
      return new Date(dataRiferimento).getFullYear();
    })
  ])].sort((a, b) => b - a);

  // Filtro fatture per anno
  const fattureFiltrate = filtroAnnoFatture === 'tutte'
    ? fatture
    : fatture.filter(f => {
        const dataRiferimento = f.dataIncasso || f.data;
        return new Date(dataRiferimento).getFullYear() === parseInt(filtroAnnoFatture);
      });

  // Funzione ordinamento
  const handleSort = (campo: string) => {
    setOrdinamentoFatture(prev => ({
      campo,
      direzione: prev.campo === campo && prev.direzione === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Fatture ordinate
  const fattureOrdinate = [...fattureFiltrate].sort((a, b) => {
    const { campo, direzione } = ordinamentoFatture;
    let valoreA, valoreB;

    switch(campo) {
      case 'numero':
        valoreA = a.numero || '';
        valoreB = b.numero || '';
        return direzione === 'asc' ? valoreA.localeCompare(valoreB) : valoreB.localeCompare(valoreA);
      case 'data':
        valoreA = new Date(a.data).getTime();
        valoreB = new Date(b.data).getTime();
        return direzione === 'asc' ? valoreA - valoreB : valoreB - valoreA;
      case 'dataIncasso':
        valoreA = new Date(a.dataIncasso || a.data).getTime();
        valoreB = new Date(b.dataIncasso || b.data).getTime();
        return direzione === 'asc' ? valoreA - valoreB : valoreB - valoreA;
      case 'clienteNome':
        valoreA = a.clienteNome || '';
        valoreB = b.clienteNome || '';
        return direzione === 'asc' ? valoreA.localeCompare(valoreB) : valoreB.localeCompare(valoreA);
      case 'importo':
        return direzione === 'asc' ? a.importo - b.importo : b.importo - a.importo;
      default:
        return 0;
    }
  });

  // Calculate client summaries for current year
  const annoCorrente = new Date().getFullYear();
  const fattureAnnoCorrente = fatture.filter(f => {
    if (f.incassato === false) return false;
    const dataRiferimento = f.dataIncasso || f.data;
    return new Date(dataRiferimento).getFullYear() === annoCorrente;
  });

  const fatturatoPerCliente = clienti.map(cliente => {
    const fattureCliente = fattureAnnoCorrente.filter(f => f.clienteId === cliente.id);
    return { ...cliente, totale: fattureCliente.reduce((sum, f) => sum + f.importo, 0), count: fattureCliente.length };
  }).sort((a, b) => b.totale - a.totale);

  return (
    <>
      <div className="page-header" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 className="page-title">Fatture</h1>
            <p className="page-subtitle">Gestisci le tue fatture elettroniche</p>
          </div>
          <div style={{ position: 'relative' }}>
            <select
              className="input-field"
              value={filtroAnnoFatture}
              onChange={(e) => setFiltroAnnoFatture(e.target.value)}
              style={{
                width: 'auto',
                padding: '10px 36px 10px 14px',
                fontWeight: 500,
                appearance: 'none',
                cursor: 'pointer',
                minWidth: 160
              }}
              aria-label="Filtra fatture"
            >
              <option value="tutte">Tutte le fatture</option>
              {anniDisponibili.map(anno => (
                <option key={anno} value={anno}>Anno {anno}</option>
              ))}
            </select>
            <ChevronDown
              size={18}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                color: 'var(--text-secondary)'
              }}
              aria-hidden="true"
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-success" onClick={() => setShowModal('nuova-fattura')}>
              <FilePlus size={18} aria-hidden="true" /> Nuova Fattura
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal('upload-fattura')}>
              <Upload size={18} aria-hidden="true" /> Carica XML
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: 'auto' }}>
            <div className="icon-btn-labeled">
              <button
                className="btn btn-primary tooltip"
                onClick={() => setShowModal('batch-upload-fattura')}
                data-tooltip="Batch Import"
                aria-label="Batch Import"
                style={{ padding: '10px' }}
              >
                <FileText size={18} aria-hidden="true" />
              </button>
              <span className="icon-btn-label">Batch</span>
            </div>
            <div className="icon-btn-labeled">
              <button
                className="btn btn-primary tooltip"
                onClick={() => setShowModal('upload-zip')}
                data-tooltip="Carica ZIP"
                aria-label="Carica ZIP"
                style={{ padding: '10px' }}
              >
                <FileArchive size={18} aria-hidden="true" />
              </button>
              <span className="icon-btn-label">ZIP</span>
            </div>
            <div className="icon-btn-labeled">
              <a
                href="https://ivaservizi.agenziaentrate.gov.it/portale/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary tooltip"
                data-tooltip="Portale ADE"
                aria-label="Portale Agenzia delle Entrate"
                style={{ textDecoration: 'none', padding: '10px' }}
              >
                <Landmark size={18} aria-hidden="true" />
              </a>
              <span className="icon-btn-label">ADE</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        {fatture.length > 0 ? (
          <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" aria-sort={ordinamentoFatture.campo === 'numero' ? (ordinamentoFatture.direzione === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" onClick={() => handleSort('numero')}>
                    Numero {ordinamentoFatture.campo === 'numero' && (ordinamentoFatture.direzione === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th scope="col" aria-sort={ordinamentoFatture.campo === 'data' ? (ordinamentoFatture.direzione === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" onClick={() => handleSort('data')}>
                    Data Emissione {ordinamentoFatture.campo === 'data' && (ordinamentoFatture.direzione === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th scope="col" aria-sort={ordinamentoFatture.campo === 'dataIncasso' ? (ordinamentoFatture.direzione === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" onClick={() => handleSort('dataIncasso')}>
                    Data Incasso {ordinamentoFatture.campo === 'dataIncasso' && (ordinamentoFatture.direzione === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th scope="col" aria-sort={ordinamentoFatture.campo === 'clienteNome' ? (ordinamentoFatture.direzione === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" onClick={() => handleSort('clienteNome')}>
                    Cliente {ordinamentoFatture.campo === 'clienteNome' && (ordinamentoFatture.direzione === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th scope="col" style={{ textAlign: 'right' }} aria-sort={ordinamentoFatture.campo === 'importo' ? (ordinamentoFatture.direzione === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" onClick={() => handleSort('importo')} style={{ justifyContent: 'flex-end' }}>
                    Importo {ordinamentoFatture.campo === 'importo' && (ordinamentoFatture.direzione === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {fattureOrdinate.map(f => {
                const dataIncassoDate = new Date(f.dataIncasso || f.data);
                const dataEmissioneDate = new Date(f.data);
                const isDiversa = f.dataIncasso && f.dataIncasso !== f.data;

                const isNonIncassata = f.incassato === false;

                return (
                  <tr key={f.id} style={isNonIncassata ? { opacity: 0.7 } : undefined}>
                    <td style={{ fontFamily: 'Space Mono' }}>{f.numero || '-'}</td>
                    <td>{dataEmissioneDate.toLocaleDateString('it-IT')}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isNonIncassata
                          ? <span style={{ fontSize: '0.75rem', color: 'var(--accent-red)', fontWeight: 600 }}>da incassare</span>
                          : <>
                              {dataIncassoDate.toLocaleDateString('it-IT')}
                              {isDiversa && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--accent-orange)', fontWeight: 500 }}>modificata</span>
                              )}
                            </>
                        }
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 8px', marginLeft: 'auto' }}
                          onClick={() => { setEditingFattura({ ...f }); setShowModal('edit-data-incasso'); }}
                          aria-label="Modifica data incasso"
                        >
                          <Edit size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    <td>{f.clienteNome || clienti.find(c => c.id === f.clienteId)?.nome || '-'}</td>
                    <td style={{ fontWeight: 600, textAlign: 'right' }}>
                      {f.importoValuta && f.valuta && f.valuta !== 'EUR' ? (
                        <div>
                          <Currency amount={f.importoValuta} symbol={f.valutaSimbolo || '€'} tabular />
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                            <Currency amount={f.importo} symbol="€" tabular />
                          </div>
                        </div>
                      ) : (
                        <Currency amount={f.importo} symbol={f.valutaSimbolo || '€'} tabular />
                      )}
                    </td>
                    <td><button className="btn btn-danger" onClick={() => removeFattura(f.id)} aria-label="Elimina fattura"><Trash2 size={16} aria-hidden="true" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="empty-state"><FileText size={48} aria-hidden="true" /><p>Nessuna fattura</p></div>
        )}
      </div>

      {fatturatoPerCliente.filter(c => c.totale > 0).length > 0 && (
        <div className="card">
          <h2 className="card-title">Riepilogo per Cliente</h2>
          <div className="grid-3">
            {fatturatoPerCliente.filter(c => c.totale > 0).map(c => (
              <div key={c.id} style={{ padding: 16, background: 'var(--bg-secondary)', borderRadius: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{c.nome}</div>
                <div style={{ fontSize: '1.3rem', color: 'var(--accent-green)' }}><Currency amount={c.totale} symbol="€" /></div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{c.count} fatture</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
