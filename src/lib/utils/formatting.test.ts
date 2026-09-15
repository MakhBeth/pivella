import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptionalContribution } from './formatting';

test('deduction input distinguishes empty, zero and valid localized amounts', () => {
  assert.deepEqual(parseOptionalContribution('  '), { amount: undefined, invalid: false });
  for (const [text, amount] of [['0', 0], ['1.000,50', 1000.5], ['1000.50', 1000.5], ['1.000', 1000], ['200,25', 200.25]] as const) {
    assert.deepEqual(parseOptionalContribution(text), { amount, invalid: false });
  }
});

test('invalid deductions never silently become zero or partial amounts', () => {
  for (const text of ['abc', '100abc', '-10', '1,2,3', '1.2.3', '.', 'Infinity', '1e3']) {
    assert.deepEqual(parseOptionalContribution(text), { amount: undefined, invalid: true }, text);
  }
});
