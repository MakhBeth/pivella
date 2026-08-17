import { useCallback } from 'react';
import { X, Upload, AlertTriangle } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import { useFileDrop } from '../../hooks/useFileDrop';

interface ImportBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (file: File) => void;
}

export function ImportBackupModal({ isOpen, onClose, onImport }: ImportBackupModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  const handleFiles = useCallback((files: FileList) => {
    const file = files[0];
    if (file) onImport(file);
  }, [onImport]);

  const { isDragging, dragProps } = useFileDrop(handleFiles);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImport(file);
  };

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="import-backup-title">
        <div className="modal-header">
          <h3 id="import-backup-title" className="modal-title">Importa Backup</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, marginBottom: 20, border: '1px solid var(--accent-red)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--accent-red)' }}>
            <AlertTriangle size={20} /><strong>Attenzione</strong>
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>L'import sovrascrive tutti i dati esistenti!</p>
        </div>
        <label className={`upload-zone ${isDragging ? 'dragging' : ''}`} tabIndex={0} {...dragProps}>
          <input type="file" accept=".json" onChange={handleChange} style={{ display: 'none' }} />
          <Upload size={40} style={{ marginBottom: 16, color: 'var(--accent-readable)' }} />
          <p style={{ fontWeight: 500 }}>{isDragging ? 'Rilascia qui' : 'Seleziona o trascina JSON'}</p>
        </label>
    </dialog>
  );
}
