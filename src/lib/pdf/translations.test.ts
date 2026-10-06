import test from 'node:test';
import assert from 'node:assert/strict';

import { paymentMethodLabel } from './translations';

test('paymentMethodLabel turns SdI codes into readable labels per locale', () => {
  assert.equal(paymentMethodLabel('MP05', 'it'), 'Bonifico');
  assert.equal(paymentMethodLabel('MP05', 'en'), 'Bank transfer');
  assert.equal(paymentMethodLabel('MP05', 'de'), 'Banküberweisung');
  assert.equal(paymentMethodLabel('MP08', 'xx'), 'Carta di pagamento');
});

test('paymentMethodLabel keeps unknown or free-text values as they are', () => {
  assert.equal(paymentMethodLabel('MP99', 'en'), 'MP99');
  assert.equal(paymentMethodLabel('PayPal', 'en'), 'PayPal');
});
