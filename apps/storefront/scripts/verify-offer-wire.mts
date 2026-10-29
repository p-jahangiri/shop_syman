import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  offerAdminDetailSchema,
  offerDetailSchema,
  offerEventsSchema,
  offerMutationSchema,
  offerPageSchema,
} from '../lib/offer-contract.ts';
import { sourcingEventsSchema } from '../lib/sourcing-contract.ts';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the actual SQL response capture directory.');
const cases = [
  ['admin-draft.json', offerAdminDetailSchema],
  ['admin-accepted.json', offerAdminDetailSchema],
  ['customer-published.json', offerDetailSchema],
  ['customer-accepted.json', offerDetailSchema],
  ['customer-page.json', offerPageSchema],
  ['customer-events.json', offerEventsSchema],
  ['request-events.json', sourcingEventsSchema],
  ...[
    'save.json',
    'publish.json',
    'accept.json',
    'accept-replay.json',
    'customer-receipt.json',
  ].map((file) => [file, offerMutationSchema]),
] as const;
const accepted = new Map<string, unknown>();
for (const [file, schema] of cases) {
  const raw = JSON.parse(await fs.readFile(path.join(directory, file as string), 'utf8'));
  accepted.set(file as string, schema.parse(raw));
}
const published = offerDetailSchema.parse(accepted.get('customer-published.json')),
  current = offerDetailSchema.parse(accepted.get('customer-accepted.json')),
  receipt = offerMutationSchema.parse(accepted.get('customer-receipt.json')),
  replay = offerMutationSchema.parse(accepted.get('accept-replay.json'));
assert.equal(published.canPay, false);
assert.equal(current.canPay, false);
assert.equal(current.canAccept, false);
assert.equal(current.canCancelRequest, false);
assert.equal(receipt.replayed, true);
assert.equal(replay.replayed, true);
assert.equal(receipt.offerId, published.offer.summary.id);
assert.equal(receipt.requestId, published.requestId);
assert.equal(receipt.acceptanceId, current.offer.acceptanceId);
assert.equal(receipt.operation, 'accept');
const attributes = current.offer.lines.flatMap((line) => [
  ...line.sku.model.attributes,
  ...line.sku.attributes,
]);
for (const kind of ['Text', 'Number', 'Bool', 'Select', 'MultiSelect'])
  assert.ok(
    attributes.some((attribute) => attribute.dataType === kind),
    kind,
  );
assert.ok(
  attributes.some((attribute) => attribute.dataType === 'Number' && Number(attribute.number) === 0),
);
assert.ok(
  attributes.some((attribute) => attribute.dataType === 'Bool' && attribute.bool === false),
);
assert.ok(attributes.some((attribute) => attribute.unitFa && attribute.unitEn));
assert.ok(current.offer.lines.some((line) => BigInt(line.unitPriceRial) > 9007199254740991n));
assert.equal(
  current.offer.summary.totalRial,
  current.offer.lines.reduce((sum, line) => sum + BigInt(line.lineTotalRial), 0n).toString(),
);
console.log(
  JSON.stringify(
    {
      passed: true,
      responseCount: cases.length,
      files: cases.map(([file]) => file),
      checks: [
        'Actual SQL lifecycle envelopes decoded without shape substitution',
        'Five typed attribute kinds preserve numeric zero, boolean false and FA/EN units',
        'Integer rial above JavaScript safe integer remains exact',
        'Draft staff/private capability split and accepted customer cancellation lock',
        'Historical accept receipt bound to both resources and current acceptance; canPay=false',
      ],
    },
    null,
    2,
  ),
);
