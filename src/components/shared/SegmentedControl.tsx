import type { ReactNode } from 'react';
import './segmented-control.css';

type Option<T extends string> = { value: T; label: ReactNode; icon?: ReactNode };

/** Shares the theme selector's styling, including design-theme overrides. */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return <div className="theme-switch segmented-control" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" className={`theme-switch-btn ${value === option.value ? 'active' : ''}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      {option.icon && <span className="segmented-control-icon" aria-hidden="true">{option.icon}</span>}
      <span>{option.label}</span>
    </button>)}
  </div>;
}
