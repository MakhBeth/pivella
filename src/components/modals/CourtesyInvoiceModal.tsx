import { useState } from 'react';
import { X, Check, Plus, Trash2, Upload, FileText, Edit2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDialog } from '../../hooks/useDialog';
import { parseXmlToInvoice, validateInvoice } from '../../lib/pdf/xmlParser';
import { saveAs } from 'file-saver';
import type { Invoice, Company, Line, Installment, PDFOptions } from '../../lib/pdf/types';
import type { ValutaConfig } from '../../types';

interface CourtesyInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CourtesyInvoiceModal({ isOpen, onClose }: CourtesyInvoiceModalProps) {
  const { config, showToast } = useApp();
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  const valute: ValutaConfig[] = config.valute?.length ? config.valute : [{ codice: 'EUR', simbolo: '€' }];
  const currencyMap = Object.fromEntries(valute.map(v => [v.codice, v.simbolo]));

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'invoicer' | 'invoicee' | 'lines' | 'options'>('upload');

  // PDF Options (editable)
  const [pdfOptions, setPdfOptions] = useState<PDFOptions>({
    colors: {
      primary: config.courtesyInvoice?.primaryColor || '#6699cc',
      text: config.courtesyInvoice?.textColor || '#033243',
    },
    footer: config.courtesyInvoice?.includeFooter !== false,
    locale: config.courtesyInvoice?.locale || 'it',
    logoSrc: config.courtesyInvoice?.logoBase64,
  });

  const handleXmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseXmlToInvoice(text);

      // Validate
      const errors = validateInvoice(parsed);
      if (errors.length > 0) {
        showToast(errors[0], 'error');
        return;
      }

      setInvoice(parsed);
      setActiveTab('lines');
      showToast('XML caricato!', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore parsing XML';
      showToast(message, 'error');
    }
  };

  const updateInvoicer = (updates: Partial<Company>) => {
    if (!invoice) return;
    setInvoice({
      ...invoice,
      invoicer: { ...invoice.invoicer, ...updates },
    });
  };

  const updateInvoicee = (updates: Partial<Company>) => {
    if (!invoice) return;
    setInvoice({
      ...invoice,
      invoicee: { ...invoice.invoicee, ...updates },
    });
  };

  const updateInstallment = (index: number, updates: Partial<Installment>) => {
    if (!invoice) return;
    const newInstallments = [...invoice.installments];
    newInstallments[index] = { ...newInstallments[index], ...updates };
    setInvoice({ ...invoice, installments: newInstallments });
  };

  const updateLine = (instIndex: number, lineIndex: number, updates: Partial<Line>) => {
    if (!invoice) return;
    const newInstallments = [...invoice.installments];
    const newLines = [...newInstallments[instIndex].lines];
    newLines[lineIndex] = { ...newLines[lineIndex], ...updates };
    // Recalculate amount
    if (updates.quantity !== undefined || updates.singlePrice !== undefined) {
      const line = newLines[lineIndex];
      newLines[lineIndex].amount = line.quantity * line.singlePrice;
    }
    newInstallments[instIndex] = { ...newInstallments[instIndex], lines: newLines };
    setInvoice({ ...invoice, installments: newInstallments });
  };

  const addLine = (instIndex: number) => {
    if (!invoice) return;
    const newInstallments = [...invoice.installments];
    const lines = newInstallments[instIndex].lines;
    const newLine: Line = {
      number: lines.length + 1,
      description: '',
      quantity: 1,
      singlePrice: 0,
      amount: 0,
      tax: 0,
    };
    newInstallments[instIndex] = {
      ...newInstallments[instIndex],
      lines: [...lines, newLine],
    };
    setInvoice({ ...invoice, installments: newInstallments });
  };

  const removeLine = (instIndex: number, lineIndex: number) => {
    if (!invoice) return;
    const newInstallments = [...invoice.installments];
    const newLines = newInstallments[instIndex].lines
      .filter((_, i) => i !== lineIndex)
      .map((l, i) => ({ ...l, number: i + 1 }));
    newInstallments[instIndex] = { ...newInstallments[instIndex], lines: newLines };
    setInvoice({ ...invoice, installments: newInstallments });
  };

  const recalculateTotals = () => {
    if (!invoice) return;
    const newInstallments = invoice.installments.map((inst) => {
      const subtotal = inst.lines.reduce((sum, l) => sum + l.amount, 0);
      const taxAmount = inst.lines.reduce((sum, l) => sum + (l.amount * l.tax / 100), 0);
      return {
        ...inst,
        totalAmount: subtotal + taxAmount,
        taxSummary: {
          ...inst.taxSummary,
          paymentAmount: subtotal,
          taxAmount,
        },
      };
    });
    setInvoice({ ...invoice, installments: newInstallments });
  };

  const handleGenerate = async () => {
    if (!invoice) return;

    // Recalculate totals before generating
    recalculateTotals();

    setIsGenerating(true);
    try {
      // Dynamic import of heavy PDF libraries
      const [{ default: GeneratePDF }, { pdf }] = await Promise.all([
        import('../../lib/pdf/renderer'),
        import('@react-pdf/renderer'),
      ]);

      const pdfDoc = GeneratePDF(invoice, { ...pdfOptions, currencyMap });
      const blob = await pdf(pdfDoc).toBlob();

      const filename = `fattura-cortesia-${invoice.installments[0]?.number || 'new'}.pdf`;
      saveAs(blob, filename.replace(/\//g, '-'));

      showToast('PDF generato!', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore generazione PDF';
      showToast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setInvoice(null);
    setActiveTab('upload');
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onClose={onClose}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      aria-labelledby="courtesy-invoice-title"
      style={{ maxWidth: 950, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
        <div className="modal-header">
          <h3 id="courtesy-invoice-title" className="modal-title">Genera Fattura di Cortesia</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 20px', borderBottom: '1px solid var(--border)' }}>
          <TabButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')}>
            <Upload size={14} /> Carica XML
          </TabButton>
          {invoice && (
            <>
              <TabButton active={activeTab === 'invoicer'} onClick={() => setActiveTab('invoicer')}>
                <FileText size={14} /> Fornitore
              </TabButton>
              <TabButton active={activeTab === 'invoicee'} onClick={() => setActiveTab('invoicee')}>
                <FileText size={14} /> Cliente
              </TabButton>
              <TabButton active={activeTab === 'lines'} onClick={() => setActiveTab('lines')}>
                <Edit2 size={14} /> Righe
              </TabButton>
              <TabButton active={activeTab === 'options'} onClick={() => setActiveTab('options')}>
                Opzioni PDF
              </TabButton>
            </>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {activeTab === 'upload' && (
            <UploadTab
              onUpload={handleXmlUpload}
              hasInvoice={!!invoice}
            />
          )}

          {activeTab === 'invoicer' && invoice && (
            <CompanyEditor
              title="Dati Fornitore (Tu)"
              company={invoice.invoicer}
              onChange={updateInvoicer}
            />
          )}

          {activeTab === 'invoicee' && invoice && (
            <CompanyEditor
              title="Dati Cliente"
              company={invoice.invoicee}
              onChange={updateInvoicee}
            />
          )}

          {activeTab === 'lines' && invoice && (
            <LinesEditor
              installments={invoice.installments}
              valute={valute}
              onUpdateInstallment={updateInstallment}
              onUpdateLine={updateLine}
              onAddLine={addLine}
              onRemoveLine={removeLine}
            />
          )}

          {activeTab === 'options' && (
            <OptionsEditor
              options={pdfOptions}
              onChange={setPdfOptions}
            />
          )}
        </div>

        {/* Footer */}
        {invoice && (
          <div style={{ padding: 20, borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
            <button className="btn btn-secondary" onClick={handleReset} disabled={isGenerating}>
              Nuovo XML
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? 'Generando...' : <><Check size={18} /> Genera PDF</>}
            </button>
          </div>
        )}
    </dialog>
  );
}

// Tab Button Component
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 16px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        borderBottom: active ? '2px solid var(--accent-blue)' : '2px solid transparent',
        color: active ? 'var(--accent-blue)' : 'var(--text-muted)',
        fontWeight: active ? 600 : 400,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: '0.9rem',
      }}
    >
      {children}
    </button>
  );
}

// Upload Tab
function UploadTab({
  onUpload,
  hasInvoice,
}: {
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hasInvoice: boolean;
}) {
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <Upload size={48} style={{ color: 'var(--text-muted)', marginBottom: 20 }} />
      <h3 style={{ marginBottom: 12 }}>Carica Fattura Elettronica XML</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        Carica un file XML di FatturaPA per generare la fattura di cortesia PDF
      </p>
      <input
        type="file"
        accept=".xml"
        onChange={onUpload}
        style={{ display: 'none' }}
        id="xml-upload"
      />
      <label htmlFor="xml-upload" className="btn btn-primary" style={{ cursor: 'pointer' }}>
        <Upload size={18} /> Seleziona File XML
      </label>
      {hasInvoice && (
        <p style={{ marginTop: 20, color: 'var(--accent-green)' }}>
          Fattura caricata! Usa le tab sopra per modificare i dati.
        </p>
      )}
    </div>
  );
}

// Company Editor
function CompanyEditor({
  title,
  company,
  onChange,
}: {
  title: string;
  company: Company;
  onChange: (updates: Partial<Company>) => void;
}) {
  return (
    <div>
      <h4 style={{ marginBottom: 16 }}>{title}</h4>

      <div className="grid-2">
        <div className="input-group">
          <label className="input-label">Ragione Sociale</label>
          <input
            type="text"
            className="input-field"
            value={company.name || ''}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="input-group">
          <label className="input-label">P.IVA / Cod. Fiscale</label>
          <input
            type="text"
            className="input-field"
            value={company.vat || ''}
            onChange={(e) => onChange({ vat: e.target.value })}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="input-group">
          <label className="input-label">Indirizzo</label>
          <input
            type="text"
            className="input-field"
            value={company.office?.address || ''}
            onChange={(e) =>
              onChange({ office: { ...company.office, address: e.target.value } })
            }
          />
        </div>
        <div className="input-group">
          <label className="input-label">N. Civico</label>
          <input
            type="text"
            className="input-field"
            value={company.office?.number || ''}
            onChange={(e) =>
              onChange({ office: { ...company.office, number: e.target.value } })
            }
          />
        </div>
      </div>

      <div className="grid-3">
        <div className="input-group">
          <label className="input-label">CAP</label>
          <input
            type="text"
            className="input-field"
            value={company.office?.cap || ''}
            onChange={(e) => onChange({ office: { ...company.office, cap: e.target.value } })}
          />
        </div>
        <div className="input-group">
          <label className="input-label">Città</label>
          <input
            type="text"
            className="input-field"
            value={company.office?.city || ''}
            onChange={(e) =>
              onChange({ office: { ...company.office, city: e.target.value } })
            }
          />
        </div>
        <div className="input-group">
          <label className="input-label">Provincia</label>
          <input
            type="text"
            className="input-field"
            value={company.office?.district || ''}
            onChange={(e) =>
              onChange({ office: { ...company.office, district: e.target.value } })
            }
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="input-group">
          <label className="input-label">Telefono</label>
          <input
            type="text"
            className="input-field"
            value={company.contacts?.tel || ''}
            onChange={(e) =>
              onChange({ contacts: { ...company.contacts, tel: e.target.value } })
            }
          />
        </div>
        <div className="input-group">
          <label className="input-label">Email</label>
          <input
            type="email"
            className="input-field"
            value={company.contacts?.email || ''}
            onChange={(e) =>
              onChange({ contacts: { ...company.contacts, email: e.target.value } })
            }
          />
        </div>
      </div>
    </div>
  );
}

// Lines Editor
function LinesEditor({
  installments,
  valute,
  onUpdateInstallment,
  onUpdateLine,
  onAddLine,
  onRemoveLine,
}: {
  installments: Installment[];
  valute: ValutaConfig[];
  onUpdateInstallment: (index: number, updates: Partial<Installment>) => void;
  onUpdateLine: (instIndex: number, lineIndex: number, updates: Partial<Line>) => void;
  onAddLine: (instIndex: number) => void;
  onRemoveLine: (instIndex: number, lineIndex: number) => void;
}) {
  return (
    <div>
      {installments.map((inst, instIndex) => (
        <div key={instIndex} style={{ marginBottom: 24 }}>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="input-group">
              <label className="input-label">Numero Fattura</label>
              <input
                type="text"
                className="input-field"
                value={inst.number}
                onChange={(e) => onUpdateInstallment(instIndex, { number: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Data</label>
              <input
                type="date"
                className="input-field"
                value={inst.issueDate.toISOString().split('T')[0]}
                onChange={(e) =>
                  onUpdateInstallment(instIndex, { issueDate: new Date(e.target.value) })
                }
              />
            </div>
            <div className="input-group">
              <label className="input-label">Valuta</label>
              {valute.length > 1 ? (
                <select
                  className="input-field"
                  value={inst.currency}
                  onChange={(e) => onUpdateInstallment(instIndex, { currency: e.target.value })}
                >
                  {valute.map(v => (
                    <option key={v.codice} value={v.codice}>{v.simbolo} {v.codice}</option>
                  ))}
                  {!valute.some(v => v.codice === inst.currency) && (
                    <option value={inst.currency}>{inst.currency}</option>
                  )}
                </select>
              ) : (
                <input
                  type="text"
                  className="input-field"
                  value={inst.currency}
                  onChange={(e) => onUpdateInstallment(instIndex, { currency: e.target.value.toUpperCase() })}
                  placeholder="EUR"
                />
              )}
            </div>
          </div>

          <div className="input-group" style={{ marginBottom: 16 }}>
            <label className="input-label">Causale</label>
            <input
              type="text"
              className="input-field"
              value={inst.description || ''}
              onChange={(e) => onUpdateInstallment(instIndex, { description: e.target.value })}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <label className="input-label" style={{ margin: 0 }}>
              Righe ({inst.lines.length})
            </label>
            <button className="btn btn-primary btn-sm" onClick={() => onAddLine(instIndex)}>
              <Plus size={16} /> Aggiungi
            </button>
          </div>

          <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" style={{ width: '5%' }}>#</th>
                <th scope="col" style={{ width: '35%' }}>Descrizione</th>
                <th scope="col" style={{ width: '12%' }}>Qta</th>
                <th scope="col" style={{ width: '15%' }}>Prezzo</th>
                <th scope="col" style={{ width: '10%' }}>IVA %</th>
                <th scope="col" style={{ width: '15%' }}>Totale</th>
                <th scope="col" style={{ width: '8%' }}></th>
              </tr>
            </thead>
            <tbody>
              {inst.lines.map((line, lineIndex) => (
                <tr key={lineIndex}>
                  <td style={{ fontFamily: 'Space Mono', color: 'var(--text-muted)' }}>
                    {line.number}
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input-field"
                      value={line.description}
                      onChange={(e) =>
                        onUpdateLine(instIndex, lineIndex, { description: e.target.value })
                      }
                      style={{ margin: 0 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="input-field"
                      value={line.quantity}
                      onChange={(e) =>
                        onUpdateLine(instIndex, lineIndex, {
                          quantity: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={{ margin: 0, textAlign: 'right' }}
                      step="0.01"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="input-field"
                      value={line.singlePrice}
                      onChange={(e) =>
                        onUpdateLine(instIndex, lineIndex, {
                          singlePrice: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={{ margin: 0, textAlign: 'right' }}
                      step="0.01"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="input-field"
                      value={line.tax}
                      onChange={(e) =>
                        onUpdateLine(instIndex, lineIndex, {
                          tax: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={{ margin: 0, textAlign: 'right' }}
                      step="1"
                    />
                  </td>
                  <td style={{ fontFamily: 'Space Mono', textAlign: 'right' }}>
                    {line.amount.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => onRemoveLine(instIndex, lineIndex)}
                      style={{ padding: '4px 8px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Totals */}
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: 'var(--bg-secondary)',
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>Imponibile:</span>
              <span style={{ fontFamily: 'Space Mono' }}>
                {inst.taxSummary.paymentAmount.toLocaleString('it-IT', {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>IVA:</span>
              <span style={{ fontFamily: 'Space Mono' }}>
                {inst.taxSummary.taxAmount.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: 8,
                borderTop: '2px solid var(--border)',
                fontWeight: 700,
                fontSize: '1.1rem',
              }}
            >
              <span>Totale:</span>
              <span style={{ fontFamily: 'Space Mono', color: 'var(--accent-green)' }}>
                {inst.totalAmount.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Options Editor
function OptionsEditor({
  options,
  onChange,
}: {
  options: PDFOptions;
  onChange: (options: PDFOptions) => void;
}) {
  return (
    <div>
      <h4 style={{ marginBottom: 16 }}>Opzioni PDF</h4>

      <div className="grid-2">
        <div className="input-group">
          <label className="input-label">Colore Primario</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={options.colors?.primary || '#6699cc'}
              onChange={(e) =>
                onChange({
                  ...options,
                  colors: { ...options.colors, primary: e.target.value },
                })
              }
              style={{ width: 50, height: 40, padding: 0, border: 'none', cursor: 'pointer' }}
            />
            <input
              type="text"
              className="input-field"
              value={options.colors?.primary || '#6699cc'}
              onChange={(e) =>
                onChange({
                  ...options,
                  colors: { ...options.colors, primary: e.target.value },
                })
              }
              style={{ flex: 1 }}
            />
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Colore Testo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={options.colors?.text || '#033243'}
              onChange={(e) =>
                onChange({
                  ...options,
                  colors: { ...options.colors, text: e.target.value },
                })
              }
              style={{ width: 50, height: 40, padding: 0, border: 'none', cursor: 'pointer' }}
            />
            <input
              type="text"
              className="input-field"
              value={options.colors?.text || '#033243'}
              onChange={(e) =>
                onChange({
                  ...options,
                  colors: { ...options.colors, text: e.target.value },
                })
              }
              style={{ flex: 1 }}
            />
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="input-group">
          <label className="input-label">Lingua</label>
          <select
            className="input-field"
            value={options.locale || 'it'}
            onChange={(e) => onChange({ ...options, locale: e.target.value })}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Mostra Footer</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={options.footer !== false}
              onChange={(e) => onChange({ ...options, footer: e.target.checked })}
              style={{ width: 20, height: 20 }}
            />
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              "Generato con Pivella"
            </span>
          </div>
        </div>
      </div>

      {options.logoSrc && (
        <div className="input-group" style={{ marginTop: 16 }}>
          <label className="input-label">Logo (dalle Impostazioni)</label>
          <img
            src={options.logoSrc}
            alt="Logo"
            style={{
              width: 80,
              height: 80,
              objectFit: 'contain',
              background: '#f0f0f0',
              borderRadius: 8,
            }}
          />
        </div>
      )}
    </div>
  );
}
