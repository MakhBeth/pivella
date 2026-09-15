import type { ReactNode } from 'react';
import { ExternalLink } from './icons';

export function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title="Si apre in una nuova scheda"
      style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
      <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>{children}</span>
      <ExternalLink size={14} aria-hidden="true" style={{ marginLeft: 4, verticalAlign: '-2px' }} />
    </a>
  );
}
