import assert from 'node:assert/strict';
import test from 'node:test';
import {
  paymentPageSchema,
  paymentReadItemSchema,
  readCustomerPaymentPage,
  readPaymentAttempt,
} from './payment-contract.ts';
import {
  paymentItem,
  paymentPage,
  paymentOrderId,
  paymentAttemptId,
  paymentChanged,
} from './payment.test-fixtures.ts';
test('payment history preserves rial above JavaScript safe integer as strings and binds the exact order and attempt', () => {
  const page = paymentPage();
  assert.deepEqual(readCustomerPaymentPage(page, paymentOrderId), page);
  assert.equal(BigInt(page.items[0].amountRial), 9007199254741000n);
  assert.throws(() => readCustomerPaymentPage(page, 'f'.repeat(32)));
  const detail = { schemaVersion: 1, attempt: paymentItem() };
  assert.deepEqual(readPaymentAttempt(detail, paymentAttemptId), detail);
  assert.throws(() => readPaymentAttempt(detail, 'f'.repeat(32)));
  for (const bad of [9007199254741000, '01', '0', '9223372036854775808', '1.5'])
    assert.equal(
      paymentReadItemSchema.safeParse({ ...paymentItem(), amountRial: bad }).success,
      false,
    );
});
test('verified state requires complete matching applied evidence and private gateway fields are forbidden', () => {
  const row = paymentItem();
  for (const bad of [
    { ...row, verifiedAmountRial: null },
    { ...row, verifiedAmountRial: '1' },
    { ...row, verificationDisposition: 'requires_review' },
    { ...row, verifiedAt: null },
    { ...row, verifiedAt: paymentChanged.replace('1234567', '1234568') },
    { ...row, authority: 'secret' },
    { ...row, referenceHash: 'A'.repeat(64) },
    { ...row, ownerId: 'other' },
  ])
    assert.equal(paymentReadItemSchema.safeParse(bad).success, false);
  const review = {
    ...row,
    state: 'review',
    verifiedAmountRial: '9007199254741001',
    verificationDisposition: 'requires_review',
    verificationReason: 'payment_amount_or_method_mismatch',
  };
  assert.equal(paymentReadItemSchema.safeParse(review).success, true);
});
test('payment page enforces filters, unique records, immutable seek order and complete nonfinal pages', () => {
  const page = paymentPage();
  for (const bad of [
    { ...page, filter: { state: 'pending', orderId: paymentOrderId } },
    { ...page, items: [paymentItem(), paymentItem()] },
    { ...page, nextCursor: 'next' },
    { ...page, items: [paymentItem(), { ...paymentItem(), id: 'c'.repeat(32) }] },
    { ...page, items: [{ ...paymentItem(), orderId: 'f'.repeat(32) }] },
  ])
    assert.equal(paymentPageSchema.safeParse(bad).success, false);
  assert.equal(paymentPageSchema.safeParse({ ...page, items: [], nextCursor: null }).success, true);
});
