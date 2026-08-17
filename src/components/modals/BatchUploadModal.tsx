import { useState, useCallback } from 'react';
import { X, FileText, Loader } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import { useFileDrop } from '../../hooks/useFileDrop';

interface BatchUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (files: FileList) => Promise<void> | void;
}

export function BatchUploadModal({ isOpen, onClose, onUpload }: BatchUploadModalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  const processFiles = useCallback(async (files: FileList) => {
    setIsUploading(true);
    try {
      await onUpload(files);
    } finally {
      setIsUploading(false);
    }
  }, [onUpload]);

  const { isDragging, dragProps } = useFileDrop(processFiles);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="batch-upload-title">
        <div className="modal-header">
          <h3 id="batch-upload-title" className="modal-title">Importa File XML Multipli</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        {isUploading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader size={40} style={{ marginBottom: 16, color: 'var(--accent-readable)', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontWeight: 500 }}>Importazione in corso...</p>
          </div>
        ) : (
          <label className={`upload-zone ${isDragging ? 'dragging' : ''}`} tabIndex={0} {...dragProps}>
            <input type="file" accept=".xml" multiple onChange={handleChange} style={{ display: 'none' }} />
            <FileText size={40} style={{ marginBottom: 16, color: 'var(--accent-readable)' }} />
            <p style={{ fontWeight: 500 }}>{isDragging ? 'Rilascia qui' : 'Clicca o trascina XML'}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Puoi selezionare più file XML contemporaneamente
            </p>
          </label>
        )}
    </dialog>
  );
}
