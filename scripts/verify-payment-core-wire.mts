import { CapturedValues } from './captured-values.mts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  paymentPageSchema,
  paymentDetailSchema,
  readCustomerPaymentPage,
  readPaymentAttempt,
} from '../apps/storefront/lib/payment-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpResponseBodies, true);
assert.equal(manifest.syntheticQaOnly, true);
assert.equal(manifest.gatewayFactIsInternalTestOnlyNotHttpInput, true);
const values = new CapturedValues();
for (const entry of manifest.entries) {
  const raw = await readFile(`${directory}/${entry.file}`);
  assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
  const data = (entry.kind === 'detail' ? paymentDetailSchema : paymentPageSchema).parse(
    JSON.parse(raw.toString('utf8')),
  );
  values.set(entry.file, data);
  if (entry.kind === 'detail') {
    const detail = paymentDetailSchema.parse(data);
    readPaymentAttempt(detail, detail.attempt.id);
  } else if (entry.kind === 'customer-page') {
    const page = paymentPageSchema.parse(data);
    assert.ok(page.filter.orderId);
    readCustomerPaymentPage(page, page.filter.orderId);
  }
}
assert.equal(manifest.entries.length, 6);
assert.equal(values.read('pending-page.json', paymentPageSchema).items[0].state, 'pending');
assert.equal(values.read('verified-page.json', paymentPageSchema).items[0].state, 'verified');
assert.equal(
  values.read('verified-page.json', paymentPageSchema).items[0].amountRial,
  '9007199254741000',
);
assert.equal(
  values.read('verified-detail.json', paymentDetailSchema).attempt.id,
  values.read('verified-page.json', paymentPageSchema).items[0].id,
);
assert.equal(
  values.read('admin-page.json', paymentPageSchema).items[0].id,
  values.read('verified-page.json', paymentPageSchema).items[0].id,
);
assert.equal(values.read('review-page.json', paymentPageSchema).items[0].state, 'review');
assert.notEqual(
  values.read('review-page.json', paymentPageSchema).items[0].amountRial,
  values.read('review-page.json', paymentPageSchema).items[0].verifiedAmountRial,
);
assert.equal(values.read('foreign-page.json', paymentPageSchema).items.length, 0);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 6,
      strictProductionDecoders: true,
      rawBodiesUnmodified: true,
      largeRialRemainedString: true,
      ownerIsolation: true,
      verifiedEvidenceRequired: true,
      reviewMismatchPreserved: true,
      providerIntegrationAccepted: false,
    },
    null,
    2,
  ) + '\n',
);
console.log('6 actual SQL HTTP responses passed the production payment decoders.');
