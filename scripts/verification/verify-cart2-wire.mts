import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cartSnapshotV2Schema } from '../../apps/storefront/lib/checkout/cart-v2-contract.ts';
import {
  cartConversionCandidateSchema,
  cartConversionMutationSchema,
  cartOfferRemovalMutationSchema,
} from '../../apps/storefront/lib/checkout/cart-conversion-contract.ts';

const directory = process.argv[2];
if (!directory || process.argv.length !== 3)
  throw Error(
    'Pass the SHOP_CART2_WIRE_DIR from actual SourcingConversionHttpSqlTests HTTP captures.',
  );
const names = [
  'candidate-before-allocation',
  'candidate-allocated',
  'candidate-for-conversion',
  'conversion-mutation',
  'conversion-replay',
  'conversion-command',
  'cart2-en',
  'cart2-fa',
  'removal-command',
  'cart2-removed',
] as const;
const bodies = await Promise.all(
  names.map(async (name) => {
    const bytes = await readFile(path.join(directory, name + '.json'));
    assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 2 * 1024 * 1024);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  }),
);
// Decode original serialized responses directly. No field, null, date or money
// normalization is allowed before the production client decoders.
const empty = cartConversionCandidateSchema.parse(bodies[0]);
const held = cartConversionCandidateSchema.parse(bodies[1]);
const candidate = cartConversionCandidateSchema.parse(bodies[2]);
const fresh = cartConversionMutationSchema.parse(bodies[3]);
const replay = cartConversionMutationSchema.parse(bodies[4]);
const receipt = cartConversionMutationSchema.parse(bodies[5]);
const en = cartSnapshotV2Schema.parse(bodies[6]);
const fa = cartSnapshotV2Schema.parse(bodies[7]);
const removed = cartOfferRemovalMutationSchema.parse(bodies[8]);
const after = cartSnapshotV2Schema.parse(bodies[9]);
assert.equal(empty.agreement, null);
assert.equal(empty.allocation, null);
assert.equal(empty.conversion, null);
assert.equal(empty.canConvert, false);
assert.equal(held.requestId, empty.requestId);
assert.equal(held.canConvert, true);
assert.equal(candidate.requestId, fresh.requestId);
assert.equal(candidate.acceptanceId, fresh.acceptanceId);
assert.equal(candidate.agreement?.id, fresh.agreementId);
assert.equal(candidate.allocation?.allocationId, fresh.allocationId);
assert.equal(fresh.replayed, false);
assert.equal(replay.replayed, true);
assert.equal(receipt.replayed, true);
for (const historical of [replay, receipt])
  assert.deepEqual({ ...historical, replayed: false }, fresh);
assert.equal(en.locale, 'en');
assert.equal(fa.locale, 'fa');
assert.equal(en.version, fresh.cartVersion);
assert.equal(fa.version, en.version);
assert.equal(en.ordinaryLines.length, 1);
assert.equal(en.offerLines.length, 1);
assert.equal(en.inquiry.lines.length, 1);
assert.equal(en.ordinaryLines[0].variantId, en.offerLines[0].variantId);
assert.equal(en.ordinaryLines[0].unitPriceRial, '123');
assert.equal(en.offerLines[0].unitPriceRial, '9007199254740993');
assert.equal(en.offerSubtotalRial, '18014398509481986');
assert.equal(en.buySubtotalRial, '18014398509482109');
assert.equal(en.offerLines[0].lineId, fresh.lines[0].lineId);
assert.equal(fa.offerLines[0].lineId, en.offerLines[0].lineId);
assert.equal(en.canCheckout, false);
assert.equal(en.canPay, false);
assert.equal(removed.agreementId, fresh.agreementId);
assert.deepEqual(
  removed.lineIds,
  fresh.lines.map((line) => line.lineId),
);
assert.equal(removed.replayed, true);
assert.equal(after.version, removed.cartVersion);
assert.equal(after.offerLines.length, 0);
assert.equal(after.ordinaryLines.length, 1);
assert.equal(after.inquiry.lines.length, 1);
assert.equal(after.canCheckout, true);
function privacy(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(privacy);
    return;
  }
  if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      assert.ok(
        ![
          'ownerId',
          'actorId',
          'unitIds',
          'unitId',
          'serial',
          'imei1',
          'imei2',
          'protectedNote',
          'internalNote',
        ].includes(key),
        `Private key ${key} reached Cart2/conversion.`,
      );
      privacy(item);
    }
}
bodies.forEach(privacy);
const report = {
  passed: names.length,
  actualSqlHttpResponseBodies: true,
  strictProductionDecoders: true,
  threeSeparateLanes: true,
  largeRialStrings: true,
  historicalReceipts: true,
  originalRequestBodiesCaptured: false,
  browserAccepted: false,
  mainPromoted: false,
  scope:
    'SQL HTTP response contract acceptance only; rendering, recovery and release need independent evidence.',
};
await writeFile(
  path.join(directory, 'cart2-wire-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(report) + '\n');
