import { useCallback } from 'react';
import { X, Upload } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import { useFileDrop } from '../../hooks/useFileDrop';

interface UploadFatturaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
}

export function UploadFatturaModal({ isOpen, onClose, onUpload }: UploadFatturaModalProps) {
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  const handleFiles = useCallback((files: FileList) => {
    const file = files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const { isDragging, dragProps } = useFileDrop(handleFiles);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  };

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="upload-fattura-title">
        <div className="modal-header">
          <h3 id="upload-fattura-title" className="modal-title">Carica Fattura XML</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        <label className={`upload-zone ${isDragging ? 'dragging' : ''}`} tabIndex={0} {...dragProps}>
          <input type="file" accept=".xml" onChange={handleChange} style={{ display: 'none' }} />
          <Upload size={40} style={{ marginBottom: 16, color: 'var(--accent-primary)' }} />
          <p style={{ fontWeight: 500 }}>{isDragging ? 'Rilascia qui' : 'Clicca o trascina XML'}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>Formato: FatturaPA XML</p>
        </label>
    </dialog>
  );
}
