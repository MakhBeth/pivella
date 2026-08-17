import { X, Check, AlertTriangle } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import type { ImportSummary } from '../../types';

interface ImportSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: ImportSummary | null;
}

export function ImportSummaryModal({ isOpen, onClose, summary }: ImportSummaryModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  if (!isOpen || !summary) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="import-summary-title">
        <div className="modal-header">
          <h3 id="import-summary-title" className="modal-title">Riepilogo Importazione</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>

        <div className="grid-2" style={{ marginBottom: 20 }}>
          <div style={{ padding: 16, background: 'var(--bg-secondary)', borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>File Processati</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent-readable)' }}>{summary.total}</div>
          </div>

          <div style={{ padding: 16, background: 'var(--bg-secondary)', borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>Importate</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent-green)' }}>{summary.imported}</div>
          </div>

          <div style={{ padding: 16, background: 'var(--bg-secondary)', borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>Duplicati Saltati</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent-orange)' }}>{summary.duplicates}</div>
          </div>

          <div style={{ padding: 16, background: 'var(--bg-secondary)', borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>Errori</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent-red)' }}>{summary.failed}</div>
          </div>
        </div>

        {summary.failedFiles.length > 0 && (
          <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, marginBottom: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--accent-red)' }}>
              <AlertTriangle size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              File con errori:
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {summary.failedFiles.map((file, i) => (
                <div key={i} style={{ fontSize: '0.85rem', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{file.filename}</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{file.error}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>
          <Check size={18} /> Chiudi
        </button>
    </dialog>
  );
}
