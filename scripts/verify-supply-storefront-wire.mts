import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  supplyDetailSchema,
  supplyPageSchema,
  supplyEventsSchema,
} from '../apps/storefront/lib/supply-contract.ts';
import { sourcingEventsSchema } from '../apps/storefront/lib/sourcing-contract.ts';
import { offerDetailSchema } from '../apps/storefront/lib/offer-contract.ts';

const directory = process.argv[2];
if (!directory || process.argv.length !== 3)
  throw new Error(
    'Pass exactly the SHOP_SUPPLY_WIRE_DIR containing actual SourcingSupplySqlTests HTTP response captures.',
  );
const names = [
  'customer-page',
  'customer-detail',
  'customer-events',
  'parent-events',
  'accepted-offer',
] as const;
const captured = await Promise.all(
  names.map(async (name) => {
    const bytes = await readFile(path.join(directory, name + '.json'));
    assert.ok(
      bytes.byteLength > 0 && bytes.byteLength <= 524288,
      `${name}: captured response exceeds the supported byte bound.`,
    );
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  }),
);
// Decode each original serialized body directly. Do not fill nulls, rename
// fields or rebuild a fixture-shaped response before the production schemas.
const page = supplyPageSchema.parse(captured[0]);
const detail = supplyDetailSchema.parse(captured[1]);
const events = supplyEventsSchema.parse(captured[2]);
const parentEvents = sourcingEventsSchema.parse(captured[3]);
const accepted = offerDetailSchema.parse(captured[4]);

const privateKeys = new Set([
  'ownerId',
  'actorId',
  'sourceKind',
  'sourceKey',
  'sourceNameFa',
  'sourceNameEn',
  'reference',
  'internalNote',
  'protectedNote',
  'totalRial',
  'unitPriceRial',
  'costRial',
  'serial',
  'imei1',
  'imei2',
  'stock',
  'sourceReceiptKey',
  'sourceReceiptLineKey',
]);
function publicOnly(value: unknown, location: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => publicOnly(item, `${location}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      assert.equal(
        privateKeys.has(key),
        false,
        `${location}.${key}: private field reached a customer supply response.`,
      );
      publicOnly(item, `${location}.${key}`);
    }
  if (typeof value === 'string') {
    assert.equal(
      value.includes('PRIVATE-SUPPLY'),
      false,
      `${location}: private supply-note marker leaked.`,
    );
    assert.equal(
      value.includes('PRIVATE-SOURCE'),
      false,
      `${location}: private source marker leaked.`,
    );
  }
}
captured.slice(0, 4).forEach((value, index) => publicOnly(value, names[index]));

assert.equal(page.startCandidate, null);
assert.equal(page.requestId, detail.requestId);
assert.equal(page.requestReference, detail.requestReference);
assert.equal(page.requestVersion, detail.requestVersion);
assert.deepEqual(
  page.items.find((item) => item.id === detail.task.id),
  detail.task,
);
for (const response of [page, detail]) {
  assert.equal(response.reservedForRequest, false);
  assert.equal(response.canCheckout, false);
  assert.equal(response.canPay, false);
}
assert.equal(detail.task.receiptProgress, 'Complete');
assert.equal(detail.task.effectiveState, 'Received');
assert.equal(detail.task.isOpen, true);
assert.equal(detail.task.remainingQuantity, 0);
assert.ok(events.items.length >= 6);
assert.equal(events.items[0].stateBefore, null);
assert.equal(events.items[0].stateAfter, 'PendingSupply');
assert.equal(events.items.at(-1)?.receiptProgress, 'Complete');
assert.ok(events.items.some((item) => item.reasonCode === 'goods_received'));

// Supply progress must not extend the old request or Offer state enums. The
// parent records real state transitions only; the child owns all progress.
assert.deepEqual(
  parentEvents.items.map((item) => item.stateAfter),
  ['Submitted', 'Reviewing'],
);
assert.ok(
  parentEvents.items.every(
    (item) => item.stateBefore === null || item.stateBefore !== item.stateAfter,
  ),
);
assert.equal(accepted.requestId, detail.requestId);
assert.equal(accepted.requestReference, detail.requestReference);
assert.equal(accepted.requestVersion, detail.requestVersion);
assert.equal(accepted.offer.summary.id, detail.task.offerId);
assert.equal(accepted.offer.acceptanceId, detail.task.acceptanceId);
assert.equal(accepted.offer.summary.state, 'Accepted');
assert.equal(accepted.offer.summary.purchaseUntil, detail.task.purchaseUntil);
assert.equal(accepted.consentOnly, true);
assert.equal(accepted.canPay, false);
assert.equal(accepted.canAccept, false);
assert.equal(accepted.canDecline, false);
assert.equal(accepted.canWithdraw, false);
assert.equal(accepted.canCancelRequest, false);
for (const line of detail.lines) {
  const offered = accepted.offer.lines.find((item) => item.lineId === line.offerLineId);
  assert.ok(offered);
  assert.equal(offered.sku.variantId, line.variantId);
  assert.equal(offered.quantity, line.requiredQuantity);
}
assert.equal(accepted.offer.lines.length, detail.lines.length);

// The SQL scenario explicitly prices two units beyond JS safe-integer
// precision. Inspect strings and BigInt; never pass the amounts through Number.
assert.equal(accepted.offer.lines[0].unitPriceRial, '9007199254740993');
assert.equal(accepted.offer.summary.totalRial, '18014398509481986');
assert.ok(BigInt(accepted.offer.lines[0].unitPriceRial) > BigInt(Number.MAX_SAFE_INTEGER));
assert.equal(
  accepted.offer.lines.reduce(
    (sum, line) => sum + BigInt(line.unitPriceRial) * BigInt(line.quantity),
    0n,
  ),
  BigInt(accepted.offer.summary.totalRial),
);

console.log(
  JSON.stringify({
    passed: names.length,
    actualSqlHttpCaptures: true,
    customerPrivacy: true,
    sameRequestTask: true,
    startCandidateNull: true,
    receivedStillUnreserved: true,
    parentAndOfferSchema1Preserved: true,
    exactLargeRialStrings: true,
    scope:
      'Production schema decoding of original SQL HTTP captures; browser and rendering acceptance are separate.',
  }),
);
