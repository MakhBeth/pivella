import test from 'node:test';
import assert from 'node:assert/strict';

import type { Scadenza } from '../../types';
import { accontiPagatiPerAnno } from './accontiPagati';

let seq = 0;
const scadenza = (overrides: Partial<Scadenza>): Scadenza => ({
  id: `s${++seq}`, userId: 'u1', visibleId: `v${seq}`, annoRiferimento: 2025, annoVersamento: 2026,
  date: '2026-06-30', tipo: 'acconto_irpef', label: 'Acconto', importo: 100, interessi: 0, totale: 100,
  pagato: true, dataPagamento: '2026-06-30', ...overrides,
});

// Piano 2025 (versato nel 2026): saldo 2025 e acconti 2026.
// Piano 2026 (versato nel 2027): saldo 2026 e acconti 2027.
const piani = [
  scadenza({ tipo: 'saldo_irpef', importo: 900 }),
  scadenza({ tipo: 'acconto_irpef', importo: 400, interessi: 4, totale: 404 }),
  scadenza({ tipo: 'acconto_irpef', importo: 600, date: '2026-11-30' }),
  scadenza({ tipo: 'acconto_inps', importo: 300 }),
  scadenza({ tipo: 'acconto_inps', importo: 250, pagato: false, dataPagamento: undefined }),
  scadenza({ annoRiferimento: 2026, annoVersamento: 2027, tipo: 'acconto_irpef', importo: 7000, date: '2027-06-30', dataPagamento: '2027-06-30' }),
  scadenza({ annoRiferimento: 2026, annoVersamento: 2027, tipo: 'acconto_inps', importo: 5000, date: '2027-06-30', dataPagamento: '2027-06-30' }),
];

test('the acconti of year N come from the plan paid in N, not from the plan of income year N', () => {
  // Saldo 2026: vanno scalati gli acconti 2026, che stanno nel piano con annoRiferimento 2025.
  assert.deepEqual(accontiPagatiPerAnno(piani, 2026), { irpefPaid: 1000, inpsPaid: 300 });
  assert.deepEqual(accontiPagatiPerAnno(piani, 2027), { irpefPaid: 7000, inpsPaid: 5000 });
});

test('saldi, unpaid acconti and interest are excluded', () => {
  const { irpefPaid, inpsPaid } = accontiPagatiPerAnno(piani, 2026);
  assert.equal(irpefPaid, 1000); // né il saldo da 900 né gli interessi da 4
  assert.equal(inpsPaid, 300); // non il secondo acconto non pagato
  assert.deepEqual(accontiPagatiPerAnno(piani, 2025), { irpefPaid: 0, inpsPaid: 0 });
});
