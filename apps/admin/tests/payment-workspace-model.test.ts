import assert from 'node:assert/strict';
import test from 'node:test';
import {
  paymentOrderFilter,
  paymentRialDifference,
} from '../src/features/finance/payment-workspace-model.ts';

test('reconciliation preserves a one-rial delta beyond safe integer precision', () => {
  assert.equal(
    paymentRialDifference({
      amountRial: '9007199254740993',
      verifiedAmountRial: '9007199254740994',
    }),
    1n,
  );
  assert.equal(
    paymentRialDifference({
      amountRial: '9223372036854775807',
      verifiedAmountRial: '9223372036854775806',
    }),
    -1n,
  );
  assert.equal(
    paymentRialDifference({ amountRial: '9007199254740993', verifiedAmountRial: null }),
    null,
  );
});

test('a pasted Persian, uppercase, hyphenated order ID resolves only to an exact canonical ID', () => {
  assert.equal(
    paymentOrderFilter('  A۱B۲C۳D۴-۵۶۷۸-۹۰AB-CDEF-۱۲۳۴۵۶۷۸۹۰AB  '),
    'a1b2c3d4567890abcdef1234567890ab',
  );
  assert.equal(paymentOrderFilter('  '), null);
  for (const invalid of ['a1b2c3d4', '0'.repeat(32), 'a-'.repeat(32)]) {
    assert.throws(() => paymentOrderFilter(invalid));
  }
});
