import { useState, useRef, useMemo } from 'react';
import { Upload, Download, FileText, ChevronDown, ChevronUp, Plus, Trash2, X, AlertTriangle } from '../shared/icons';
import { useApp } from '../../context/AppContext';
import { parseXmlToInvoice } from '../../lib/pdf/xmlParser';
import { saveAs } from 'file-saver';
import type { Invoice, PDFOptions, Line } from '../../lib/pdf/types';
import type { ValutaConfig } from '../../types';

// WCAG contrast ratio utilities
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return 0;

  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function adjustColorForContrast(color: string, background: string, minRatio: number = 4.5): string {
  const rgb = hexToRgb(color);
  const bgRgb = hexToRgb(background);
  if (!rgb || !bgRgb) return color;

  const bgLum = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
  let { r, g, b } = rgb;

  // Determine if we need to darken or lighten
  const shouldDarken = bgLum > 0.5;

  for (let i = 0; i < 100; i++) {
    const ratio = getContrastRatio(
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      background
    );
    if (ratio >= minRatio) break;

    if (shouldDarken) {
      r = Math.max(0, r - 5);
      g = Math.max(0, g - 5);
      b = Math.max(0, b - 5);
    } else {
      r = Math.min(255, r + 5);
      g = Math.min(255, g + 5);
      b = Math.min(255, b + 5);
    }
  }

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const MIN_CONTRAST_RATIO = 4.5; // WCAG AA for normal text

export function FatturaCortesia() {
  const { config, setConfig, showToast } = useApp();
  const valute: ValutaConfig[] = config.valute?.length ? config.valute : [{ codice: 'EUR', simbolo: '€' }];
  const currencyMap = Object.fromEntries(valute.map(v => [v.codice, v.simbolo]));
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PDF Settings (from config)
  const [primaryColor, setPrimaryColor] = useState(config.courtesyInvoice?.primaryColor || '#6699cc');
  const [textColor, setTextColor] = useState(config.courtesyInvoice?.textColor || '#033243');

  // Contrast validation against white background
  const primaryContrast = useMemo(() => getContrastRatio(primaryColor, '#ffffff'), [primaryColor]);
  const textContrast = useMemo(() => getContrastRatio(textColor, '#ffffff'), [textColor]);
  const isPrimaryContrastOk = primaryContrast >= MIN_CONTRAST_RATIO;
  const isTextContrastOk = textContrast >= MIN_CONTRAST_RATIO;
  const [showFooter, setShowFooter] = useState(config.courtesyInvoice?.includeFooter !== false);
  const [footerText, setFooterText] = useState(config.courtesyInvoice?.footerText || '');
  const [footerLink, setFooterLink] = useState(config.courtesyInvoice?.footerLink || '');
  const [locale, setLocale] = useState(config.courtesyInvoice?.locale || 'it');
  const [logoBase64, setLogoBase64] = useState<string | undefined>(config.courtesyInvoice?.logoBase64);

  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedInvoice, setParsedInvoice] = useState<Invoice | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleSaveSettings = () => {
    setConfig({
      ...config,
      courtesyInvoice: {
        companyName: config.courtesyInvoice?.companyName || '',
        vatNumber: config.courtesyInvoice?.vatNumber || '',
        country: config.courtesyInvoice?.country || 'IT',
        defaultServices: config.courtesyInvoice?.defaultServices || [],
        ...config.courtesyInvoice,
        primaryColor,
        textColor,
        includeFooter: showFooter,
        footerText: footerText || undefined,
        footerLink: footerLink || undefined,
        locale,
        logoBase64,
      }
    });
    showToast('Impostazioni salvate!', 'success');
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500 * 1024) {
      showToast('Immagine troppo grande (max 500KB)', 'error');
      return;
    }

    if (!file.type.match(/^image\/(png|jpeg|jpg)$/)) {
      showToast('Formato non supportato (solo PNG/JPG)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setLogoBase64(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoBase64(undefined);
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      showToast('Seleziona un file XML', 'error');
      return;
    }

    setSelectedFile(file);

    try {
      const text = await file.text();
      const invoice = parseXmlToInvoice(text);
      setParsedInvoice(invoice);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore parsing XML';
      showToast(message, 'error');
      setParsedInvoice(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleGenerate = async () => {
    if (!parsedInvoice) {
      showToast('Seleziona prima un file XML', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      // Dynamic import of heavy PDF libraries
      const [{ default: GeneratePDF }, { pdf }] = await Promise.all([
        import('../../lib/pdf/renderer'),
        import('@react-pdf/renderer'),
      ]);

      const options: PDFOptions = {
        colors: {
          primary: primaryColor,
          text: textColor,
        },
        footer: showFooter,
        footerText: footerText || undefined,
        footerLink: footerLink || undefined,
        locale,
        logoSrc: logoBase64,
        currencyMap,
      };

      const pdfDoc = GeneratePDF(parsedInvoice, options);
      const blob = await pdf(pdfDoc).toBlob();

      const filename = `fattura-cortesia-${parsedInvoice.installments[0]?.number || 'new'}.pdf`;
      saveAs(blob, filename.replace(/\//g, '-'));

      showToast('PDF generato!', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore generazione PDF';
      showToast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Fattura di Cortesia</h1>
        <p className="page-subtitle">Genera PDF da fattura elettronica XML</p>
      </div>

      {/* IMPOSTAZIONI PDF */}
      <div className="card">
        <h2 className="card-title" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', letterSpacing: '0.5px' }}>
          IMPOSTAZIONI PDF
        </h2>

        {/* Logo */}
        <div className="input-group">
          <label className="input-label">Logo (PNG/JPG, max 500KB)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoBase64 ? (
              <>
                <img
                  src={logoBase64}
                  alt="Logo"
                  style={{
                    width: 60,
                    height: 60,
                    objectFit: 'contain',
                    borderRadius: 8,
                    background: 'var(--bg-secondary)',
                  }}
                />
                <button className="btn btn-danger btn-sm" onClick={removeLogo} aria-label="Rimuovi logo">
                  <X size={14} aria-hidden="true" /> Rimuovi
                </button>
              </>
            ) : (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                <Upload size={18} aria-hidden="true" />
                <span>Carica logo</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleLogoUpload}
                  style={{ display: 'none' }}
                />
              </label>
            )}
          </div>
        </div>

        {/* Colors */}
        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="input-group">
            <label className="input-label">Colore Primario</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                aria-label="Seleziona colore primario"
                style={{ width: 50, height: 40, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 4 }}
              />
              <input
                type="text"
                className="input-field"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                aria-label="Codice esadecimale colore primario"
                style={{ flex: 1 }}
              />
            </div>
            {!isPrimaryContrastOk && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <AlertTriangle size={16} aria-hidden="true" style={{ color: 'var(--accent-orange)', flexShrink: 0 }} />
                <span style={{ color: 'var(--accent-orange)' }}>Contrasto {primaryContrast.toFixed(1)}:1 (min 4.5:1)</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto', padding: '4px 8px', background: 'var(--accent-orange)', color: '#000', fontSize: '0.75rem' }}
                  onClick={() => setPrimaryColor(adjustColorForContrast(primaryColor, '#ffffff'))}
                >
                  Correggi
                </button>
              </div>
            )}
          </div>
          <div className="input-group">
            <label className="input-label">Colore Testo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                aria-label="Seleziona colore testo"
                style={{ width: 50, height: 40, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 4 }}
              />
              <input
                type="text"
                className="input-field"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                aria-label="Codice esadecimale colore testo"
                style={{ flex: 1 }}
              />
            </div>
            {!isTextContrastOk && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <AlertTriangle size={16} aria-hidden="true" style={{ color: 'var(--accent-orange)', flexShrink: 0 }} />
                <span style={{ color: 'var(--accent-orange)' }}>Contrasto {textContrast.toFixed(1)}:1 (min 4.5:1)</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto', padding: '4px 8px', background: 'var(--accent-orange)', color: '#000', fontSize: '0.75rem' }}
                  onClick={() => setTextColor(adjustColorForContrast(textColor, '#ffffff'))}
                >
                  Correggi
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="input-group" style={{ marginTop: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showFooter}
              onChange={(e) => setShowFooter(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--accent-green)' }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>Mostra footer nel PDF</span>
          </label>
        </div>

        {showFooter && (
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div className="input-group">
              <label className="input-label">Nome nel footer</label>
              <input
                type="text"
                className="input-field"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="Pivella"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Link nel footer</label>
              <input
                type="url"
                className="input-field"
                value={footerLink}
                onChange={(e) => setFooterLink(e.target.value)}
                placeholder="https://github.com/MakhBeth/pivella"
              />
            </div>
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSaveSettings}
          style={{ marginTop: 20 }}
        >
          Salva Impostazioni
        </button>
      </div>

      {/* GENERA PDF */}
      <div className="card">
        <h2 className="card-title" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', letterSpacing: '0.5px' }}>
          GENERA PDF
        </h2>

        <div className="input-group">
          <label className="input-label">Seleziona file XML FatturaPA</label>

          {/* Drop zone */}
          <div
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onClick={handleDropZoneClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload size={40} style={{ marginBottom: 16, color: 'var(--accent-primary)' }} />
            {selectedFile ? (
              <p style={{ fontWeight: 500, fontFamily: 'Space Mono' }}>
                {selectedFile.name}
              </p>
            ) : (
              <>
                <p style={{ fontWeight: 500 }}>
                  {isDragging ? 'Rilascia il file qui' : 'Trascina un file XML o clicca per selezionare'}
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>Formato: FatturaPA XML</p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xml"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        <div className="input-group" style={{ marginTop: 16 }}>
          <label className="input-label">Lingua del PDF</label>
          <select
            className="input-field"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>

        {/* MODIFICA DATI FATTURA - collapsible */}
        {selectedFile && parsedInvoice && (
          <details style={{ marginTop: 20 }}>
            <summary
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <FileText size={18} aria-hidden="true" />
              Modifica dati fattura
              <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'Space Mono' }}>
                {selectedFile.name}
              </span>
            </summary>
            <div style={{ marginTop: 16 }}>
              <InvoiceEditorContent
                invoice={parsedInvoice}
                onInvoiceChange={setParsedInvoice}
                valute={valute}
              />
            </div>
          </details>
        )}

        <button
          className="btn btn-success"
          onClick={handleGenerate}
          disabled={!parsedInvoice || isGenerating}
          style={{ marginTop: 20, width: '100%' }}
        >
          {isGenerating ? (
            'Generando...'
          ) : (
            <>
              <Download size={18} aria-hidden="true" /> Genera PDF
            </>
          )}
        </button>
      </div>
    </>
  );
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  children,
  defaultOpen = false
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const sectionId = `section-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={sectionId}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 0',
          cursor: 'pointer',
          borderBottom: '1px solid var(--border)',
          background: 'transparent',
          border: 'none',
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: 'var(--border)',
          width: '100%',
          textAlign: 'left',
          font: 'inherit',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        {isOpen ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
      </button>
      {isOpen && <div id={sectionId} style={{ paddingTop: 16 }}>{children}</div>}
    </div>
  );
}

// Invoice Editor Content Component (no card wrapper)
function InvoiceEditorContent({
  invoice,
  onInvoiceChange,
  valute,
}: {
  invoice: Invoice;
  onInvoiceChange: (invoice: Invoice) => void;
  valute: ValutaConfig[];
}) {
  const inst = invoice.installments[0];

  const updateInvoicer = (updates: Partial<typeof invoice.invoicer>) => {
    onInvoiceChange({
      ...invoice,
      invoicer: { ...invoice.invoicer, ...updates },
    });
  };

  const updateInvoicerOffice = (updates: Partial<NonNullable<typeof invoice.invoicer.office>>) => {
    onInvoiceChange({
      ...invoice,
      invoicer: {
        ...invoice.invoicer,
        office: { ...invoice.invoicer.office, ...updates },
      },
    });
  };

  const updateInvoicerContacts = (updates: Partial<NonNullable<typeof invoice.invoicer.contacts>>) => {
    onInvoiceChange({
      ...invoice,
      invoicer: {
        ...invoice.invoicer,
        contacts: { ...invoice.invoicer.contacts, ...updates },
      },
    });
  };

  const updateInvoicee = (updates: Partial<typeof invoice.invoicee>) => {
    onInvoiceChange({
      ...invoice,
      invoicee: { ...invoice.invoicee, ...updates },
    });
  };

  const updateInvoiceeOffice = (updates: Partial<NonNullable<typeof invoice.invoicee.office>>) => {
    onInvoiceChange({
      ...invoice,
      invoicee: {
        ...invoice.invoicee,
        office: { ...invoice.invoicee.office, ...updates },
      },
    });
  };

  const updateInstallment = (updates: Partial<typeof inst>) => {
    onInvoiceChange({
      ...invoice,
      installments: [{ ...inst, ...updates }],
    });
  };

  const updateLine = (index: number, updates: Partial<Line>) => {
    const newLines = [...inst.lines];
    newLines[index] = { ...newLines[index], ...updates };

    // Recalculate amount if quantity or price changed
    if ('quantity' in updates || 'singlePrice' in updates) {
      newLines[index].amount = newLines[index].quantity * newLines[index].singlePrice;
    }

    updateInstallment({ lines: newLines });
  };

  const addLine = () => {
    const newLine: Line = {
      number: inst.lines.length + 1,
      description: '',
      quantity: 1,
      singlePrice: 0,
      amount: 0,
      tax: inst.taxSummary?.taxPercentage || 0,
    };
    updateInstallment({ lines: [...inst.lines, newLine] });
  };

  const removeLine = (index: number) => {
    const newLines = inst.lines.filter((_, i) => i !== index);
    // Renumber lines
    newLines.forEach((line, i) => { line.number = i + 1; });
    updateInstallment({ lines: newLines });
  };

  const updatePayment = (updates: Partial<NonNullable<typeof inst.payment>>) => {
    updateInstallment({
      payment: { ...inst.payment, amount: inst.payment?.amount || 0, ...updates },
    });
  };

  const formatDate = (date: Date | undefined): string => {
    if (!date) return '';
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  };

  return (
    <>
      {/* FORNITORE */}
      <CollapsibleSection title="Fornitore (Cedente/Prestatore)" defaultOpen={false}>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Ragione Sociale</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.name || ''}
              onChange={(e) => updateInvoicer({ name: e.target.value })}
            />
          </div>
          <div className="input-group">
            <label className="input-label">P.IVA / CF</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.vat || ''}
              onChange={(e) => updateInvoicer({ vat: e.target.value })}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Indirizzo</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.office?.address || ''}
              onChange={(e) => updateInvoicerOffice({ address: e.target.value })}
              autoComplete="street-address"
            />
          </div>
          <div className="input-group">
            <label className="input-label">N. Civico</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.office?.number || ''}
              onChange={(e) => updateInvoicerOffice({ number: e.target.value })}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">CAP</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.office?.cap || ''}
              onChange={(e) => updateInvoicerOffice({ cap: e.target.value })}
              autoComplete="postal-code"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Città</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.office?.city || ''}
              onChange={(e) => updateInvoicerOffice({ city: e.target.value })}
              autoComplete="address-level2"
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Provincia</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.office?.district || ''}
              onChange={(e) => updateInvoicerOffice({ district: e.target.value })}
              maxLength={2}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Nazione</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.office?.country || ''}
              onChange={(e) => updateInvoicerOffice({ country: e.target.value })}
              maxLength={2}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Telefono</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicer.contacts?.tel || ''}
              onChange={(e) => updateInvoicerContacts({ tel: e.target.value })}
              autoComplete="tel"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Email</label>
            <input
              type="email"
              className="input-field"
              value={invoice.invoicer.contacts?.email || ''}
              onChange={(e) => updateInvoicerContacts({ email: e.target.value })}
              autoComplete="email"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* CLIENTE */}
      <CollapsibleSection title="Cliente (Cessionario/Committente)" defaultOpen={false}>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Ragione Sociale</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.name || ''}
              onChange={(e) => updateInvoicee({ name: e.target.value })}
            />
          </div>
          <div className="input-group">
            <label className="input-label">P.IVA / CF</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.vat || ''}
              onChange={(e) => updateInvoicee({ vat: e.target.value })}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Indirizzo</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.office?.address || ''}
              onChange={(e) => updateInvoiceeOffice({ address: e.target.value })}
              autoComplete="street-address"
            />
          </div>
          <div className="input-group">
            <label className="input-label">N. Civico</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.office?.number || ''}
              onChange={(e) => updateInvoiceeOffice({ number: e.target.value })}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">CAP</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.office?.cap || ''}
              onChange={(e) => updateInvoiceeOffice({ cap: e.target.value })}
              autoComplete="postal-code"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Città</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.office?.city || ''}
              onChange={(e) => updateInvoiceeOffice({ city: e.target.value })}
              autoComplete="address-level2"
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Provincia</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.office?.district || ''}
              onChange={(e) => updateInvoiceeOffice({ district: e.target.value })}
              maxLength={2}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Nazione</label>
            <input
              type="text"
              className="input-field"
              value={invoice.invoicee.office?.country || ''}
              onChange={(e) => updateInvoiceeOffice({ country: e.target.value })}
              maxLength={2}
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* DATI FATTURA */}
      <CollapsibleSection title="Dati Fattura" defaultOpen={true}>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Numero Fattura</label>
            <input
              type="text"
              className="input-field"
              value={inst.number || ''}
              onChange={(e) => updateInstallment({ number: e.target.value })}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Data Emissione</label>
            <input
              type="date"
              className="input-field"
              value={formatDate(inst.issueDate)}
              onChange={(e) => updateInstallment({ issueDate: new Date(e.target.value) })}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Valuta</label>
            {valute.length > 1 ? (
              <select
                className="input-field"
                value={inst.currency}
                onChange={(e) => updateInstallment({ currency: e.target.value })}
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
                value={inst.currency || 'EUR'}
                onChange={(e) => updateInstallment({ currency: e.target.value })}
                maxLength={3}
              />
            )}
          </div>
          <div className="input-group">
            <label className="input-label">Bollo (se presente)</label>
            <input
              type="number"
              className="input-field"
              value={inst.stampDuty || ''}
              onChange={(e) => updateInstallment({ stampDuty: e.target.value ? parseFloat(e.target.value) : undefined })}
              step="0.01"
            />
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Causale / Descrizione</label>
          <textarea
            className="input-field"
            value={inst.description || ''}
            onChange={(e) => updateInstallment({ description: e.target.value })}
            rows={2}
            style={{ resize: 'vertical' }}
          />
        </div>
      </CollapsibleSection>

      {/* RIGHE FATTURA */}
      <CollapsibleSection title={`Righe Fattura (${inst.lines.length})`} defaultOpen={true}>
        {inst.lines.map((line, index) => (
          <div
            key={index}
            style={{
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Riga {line.number}</span>
              {inst.lines.length > 1 && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => removeLine(index)}
                  style={{ padding: '4px 8px' }}
                  aria-label={`Elimina riga ${line.number}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="input-group">
              <label className="input-label">Descrizione</label>
              <textarea
                className="input-field"
                value={line.description}
                onChange={(e) => updateLine(index, { description: e.target.value })}
                rows={2}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <div className="input-group">
                <label className="input-label">Quantità</label>
                <input
                  type="number"
                  className="input-field"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: parseFloat(e.target.value) || 0 })}
                  step="0.01"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Prezzo Unitario</label>
                <input
                  type="number"
                  className="input-field"
                  value={line.singlePrice}
                  onChange={(e) => updateLine(index, { singlePrice: parseFloat(e.target.value) || 0 })}
                  step="0.01"
                />
              </div>
            </div>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <div className="input-group">
                <label className="input-label">IVA %</label>
                <input
                  type="number"
                  className="input-field"
                  value={line.tax}
                  onChange={(e) => updateLine(index, { tax: parseFloat(e.target.value) || 0 })}
                  step="0.01"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Importo Riga</label>
                <input
                  type="number"
                  className="input-field"
                  value={line.amount.toFixed(2)}
                  readOnly
                  style={{ background: 'var(--bg-tertiary)', cursor: 'not-allowed' }}
                />
              </div>
            </div>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={addLine} style={{ marginTop: 8 }}>
          <Plus size={18} aria-hidden="true" /> Aggiungi Riga
        </button>
      </CollapsibleSection>

      {/* PAGAMENTO */}
      <CollapsibleSection title="Dati Pagamento" defaultOpen={false}>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">Importo Totale</label>
            <input
              type="number"
              className="input-field"
              value={inst.totalAmount}
              onChange={(e) => updateInstallment({ totalAmount: parseFloat(e.target.value) || 0 })}
              step="0.01"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Data Scadenza</label>
            <input
              type="date"
              className="input-field"
              value={formatDate(inst.payment?.regularPaymentDate)}
              onChange={(e) => updatePayment({ regularPaymentDate: e.target.value ? new Date(e.target.value) : undefined })}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label">IBAN</label>
            <input
              type="text"
              className="input-field"
              value={inst.payment?.iban || ''}
              onChange={(e) => updatePayment({ iban: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Banca</label>
            <input
              type="text"
              className="input-field"
              value={inst.payment?.bank || ''}
              onChange={(e) => updatePayment({ bank: e.target.value })}
            />
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
