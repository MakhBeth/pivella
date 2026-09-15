import type { Config } from '../../types';
import { getCassaWarning } from '../../lib/utils/forfettario';

export function CassaWarning({ config, anno }: { config: Config; anno: number }) {
  const warning = getCassaWarning(config, anno);
  return warning ? <p role="status" style={{ color: 'var(--accent-orange)', margin: '16px 0' }}>{warning}</p> : null;
}
