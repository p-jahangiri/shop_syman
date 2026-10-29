import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatToman, parseToman, percentBasisPoints, tomanInput } from './money.ts';
import { chequeQuote } from './commerce.ts';
import type { ChequePlan } from './types.ts';
test('rial/toman formatting preserves the final rial beyond JavaScript integer precision', () => {
  assert.equal(formatToman('9223372036854775807', 'en'), '922,337,203,685,477,580.7');
  assert.equal(formatToman('9223372036854775807', 'fa'), '۹۲۲٬۳۳۷٬۲۰۳٬۶۸۵٬۴۷۷٬۵۸۰٫۷');
  assert.equal(formatToman(1n, 'en'), '0.1');
  assert.equal(formatToman(-1n, 'en'), '-0.1');
  assert.equal(formatToman(10n, 'en'), '1');
});
test('editable toman values round trip every rial and enforce the Int64 input boundary', () => {
  for (const n of [0n, 1n, 9n, 10n, 11n, 900719925474099399n, 9223372036854775807n])
    assert.equal(parseToman(tomanInput(n)), n);
  for (const value of ['1e2', '1.11', '-1', 'NaN', '0.01', '922337203685477580.8'])
    assert.equal(parseToman(value), undefined);
});
test('decimal percentages become exact basis points and reject unsupported precision', () => {
  assert.equal(percentBasisPoints(0.29, 100), 29n);
  assert.equal(percentBasisPoints(12.34, 1000), 1234n);
  assert.equal(percentBasisPoints(1000, 1000), 100000n);
  for (const value of [-1, 100.01, NaN, Infinity, 12.345])
    assert.throws(() => percentBasisPoints(value, 100));
});
test('fractional rates and either rounding unit reconcile without losing odd rials', () => {
  for (const unit of ['1', '10'] as const)
    for (const amount of [0n, 1n, 9n, 11n, 1001n, 689000005n, 9223372036854775807n])
      for (const down of [0, 0.29, 30.25, 100])
        for (const markup of [0, 0.01, 12.34, 1000]) {
          const plan: ChequePlan = {
            id: 'exact',
            months: 12,
            intervalMonths: 3,
            markupPercent: markup,
            downPaymentPercent: down,
            roundingUnitRial: unit,
          };
          const q = chequeQuote(amount, plan);
          assert.equal(q.downPayment + q.installments.reduce((s, n) => s + n, 0n), q.total);
          assert.equal(q.total, amount + q.markup);
          assert.ok(q.downPayment <= amount);
          assert.ok(q.installments.every((n) => n >= 0n));
          assert.equal(q.installments.length, 4);
          assert.ok(q.installments.slice(0, -1).every((n) => n % BigInt(unit) === 0n));
        }
  const q = chequeQuote(1001n, {
    id: 'decimal',
    months: 6,
    intervalMonths: 2,
    downPaymentPercent: 30.25,
    markupPercent: 12.34,
    roundingUnitRial: '1',
  });
  assert.deepEqual(q, {
    downPayment: 303n,
    markup: 87n,
    installments: [261n, 261n, 263n],
    total: 1088n,
  });
});
