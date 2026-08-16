import { Check, AlertTriangle } from './icons';
import type { Toast as ToastType } from '../../types';

interface ToastProps {
  toast: ToastType | null;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;

  return (
    <div
      className={`toast ${toast.type}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast.type === 'success' ? <Check size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
      <span>{toast.message}</span>
    </div>
  );
}
