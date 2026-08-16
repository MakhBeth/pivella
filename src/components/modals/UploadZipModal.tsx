import { useState, useCallback } from 'react';
import { X, FileArchive, Loader } from '../shared/icons';
import { useDialog } from '../../hooks/useDialog';
import { useFileDrop } from '../../hooks/useFileDrop';

interface UploadZipModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void> | void;
}

export function UploadZipModal({ isOpen, onClose, onUpload }: UploadZipModalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const { dialogRef, handleClick, handleMouseDown } = useDialog(isOpen, onClose);

  const processFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      await onUpload(file);
    } finally {
      setIsUploading(false);
    }
  }, [onUpload]);

  const handleFiles = useCallback((files: FileList) => {
    const file = files[0];
    if (file) processFile(file);
  }, [processFile]);

  const { isDragging, dragProps } = useFileDrop(handleFiles);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={handleClick} onMouseDown={handleMouseDown} aria-labelledby="upload-zip-title">
        <div className="modal-header">
          <h3 id="upload-zip-title" className="modal-title">Carica File ZIP</h3>
          <button className="close-btn" onClick={onClose} aria-label="Chiudi"><X size={20} aria-hidden="true" /></button>
        </div>
        {isUploading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader size={40} style={{ marginBottom: 16, color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontWeight: 500 }}>Importazione in corso...</p>
          </div>
        ) : (
          <label className={`upload-zone ${isDragging ? 'dragging' : ''}`} tabIndex={0} {...dragProps}>
            <input type="file" accept=".zip" onChange={handleChange} style={{ display: 'none' }} />
            <FileArchive size={40} style={{ marginBottom: 16, color: 'var(--accent-primary)' }} />
            <p style={{ fontWeight: 500 }}>{isDragging ? 'Rilascia qui' : 'Clicca o trascina ZIP'}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Il file ZIP verrà estratto e tutti gli XML saranno importati
            </p>
          </label>
        )}
    </dialog>
  );
}
