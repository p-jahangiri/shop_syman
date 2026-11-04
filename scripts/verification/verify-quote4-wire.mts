import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { quoteSnapshotV4Schema } from '../../apps/storefront/lib/checkout/quote-v4-contract.ts';

if (process.argv.length > 3)
  throw Error('Pass only the actual SQL HTTP capture directory, or set SHOP_QUOTE4_WIRE_DIR.');
const supplied = process.argv[2] ?? process.env.SHOP_QUOTE4_WIRE_DIR;
if (!supplied)
  throw Error(
    'Set SHOP_QUOTE4_WIRE_DIR to the actual CheckoutQuoteV4HttpSqlTests response directory.',
  );
const directory = path.resolve(supplied);
const names = [
  'quote4-mixed-preview-en',
  'quote4-mixed-saved-en',
  'quote4-mixed-saved-fa',
  'quote4-accepted-only',
  'quote4-replay',
  'quote4-three-prices-same-sku',
  'quote4-expiry-original',
  'quote4-expired-replay',
] as const;
const captured = await Promise.all(
  names.map(async (name) => {
    const bytes = await readFile(path.join(directory, name + '.json'));
    assert.ok(
      bytes.byteLength > 0 && bytes.byteLength <= 524288,
      `${name}: original HTTP body exceeds the supported UTF-8 byte bound.`,
    );
    const raw = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) as unknown;
    // Pass the original serialized response to the production decoder before
    // doing any comparison. Never normalize nulls, dates, ids, fields or amounts.
    const quote = quoteSnapshotV4Schema.parse(raw);
    return {
      name,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      quote,
    };
  }),
);
const [preview, en, fa, only, replay, three, expiry, expired] = captured.map((item) => item.quote);
for (const q of captured.map((item) => item.quote)) {
  assert.equal(q.canPlaceOrder, false);
  assert.equal(q.canPay, false);
  assert.equal(q.temporaryOrder.canCreate, false);
  assert.ok(q.blockers.includes('accepted_offer_order_unavailable'));
  assert.ok(q.temporaryOrder.blockers.includes('accepted_offer_order_unavailable'));
  assert.equal(q.shippingRial, null);
  assert.equal(q.taxRial, null);
  assert.equal(q.payableTotalRial, null);
  assert.ok(q.lines.some((line) => BigInt(line.unitPriceRial) > BigInt(Number.MAX_SAFE_INTEGER)));
}
assert.equal(preview.locale, 'en');
assert.equal(preview.quoteId, null);
assert.equal(preview.selectedMethod, null);
assert.ok(preview.expiresAt);
assert.equal(en.locale, 'en');
assert.ok(en.quoteId);
assert.equal(en.selectedMethod?.id, 'online');
assert.equal(fa.locale, 'fa');
assert.ok(fa.quoteId);
assert.equal(en.cartVersion, fa.cartVersion);
assert.equal(preview.cartVersion, en.cartVersion);
assert.deepEqual(preview.lines, en.lines);
assert.equal(preview.itemsSubtotalRial, en.itemsSubtotalRial);
assert.equal(en.lines.length, 2);
assert.equal(en.itemsSubtotalRial, '18014398509482109');
assert.equal(en.lines.filter((line) => line.lineKind === 'ordinary').length, 1);
assert.equal(en.lines.filter((line) => line.lineKind === 'acceptedOffer').length, 1);
assert.equal(new Set(en.lines.map((line) => line.variantId)).size, 1);
for (const line of en.lines) {
  const translated = fa.lines.find((other) => other.lineId === line.lineId);
  assert.ok(translated);
  for (const key of [
    'lineId',
    'lineKind',
    'variantId',
    'quantity',
    'unitPriceRial',
    'lineTotalRial',
    'priceVersion',
    'accepted',
  ] as const)
    assert.deepEqual(translated[key], line[key]);
}
assert.ok(
  en.lines.some(
    (line) => line.name !== fa.lines.find((other) => other.lineId === line.lineId)!.name,
  ),
);
assert.equal(only.lines.length, 1);
assert.equal(only.lines[0].lineKind, 'acceptedOffer');
assert.equal(only.itemsSubtotalRial, '18014398509481986');
assert.deepEqual(only, replay);
assert.equal(three.lines.length, 3);
assert.equal(new Set(three.lines.map((line) => line.variantId)).size, 1);
assert.equal(new Set(three.lines.map((line) => line.lineId)).size, 3);
assert.equal(three.lines.filter((line) => line.lineKind === 'ordinary').length, 1);
assert.equal(three.lines.filter((line) => line.lineKind === 'acceptedOffer').length, 2);
assert.deepEqual(
  three.lines
    .map((line) => line.unitPriceRial)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)),
  ['123', '777', '9007199254740993'],
);
assert.equal(three.itemsSubtotalRial, '18014398509482886');
assert.equal(expiry.quoteId, expired.quoteId);
assert.equal(expiry.createdAt, expired.createdAt);
assert.equal(expiry.expiresAt, expired.expiresAt);
assert.equal(expiry.pricingFingerprint, expired.pricingFingerprint);
assert.deepEqual(expiry.lines, expired.lines);
assert.ok(!expiry.blockers.includes('quote_expired'));
assert.ok(expired.blockers.includes('quote_expired'));
assert.ok(expired.temporaryOrder.blockers.includes('quote_expired'));
assert.deepEqual(
  {
    ...expired,
    blockers: expired.blockers.filter((code) => code !== 'quote_expired'),
    temporaryOrder: {
      ...expired.temporaryOrder,
      blockers: expired.temporaryOrder.blockers.filter((code) => code !== 'quote_expired'),
    },
  },
  expiry,
);
const report = {
  status: 'accepted-sql-http-wire-only',
  passed: names.length,
  actualSqlHttpResponseBodies: true,
  strictProductionDecoder: true,
  originalBodyHashes: true,
  ordinaryAndTwoAcceptedPricesSameSku: true,
  largeRialDecimalStrings: true,
  faEnSnapshots: true,
  previewWithBoundedDeadline: true,
  replayPreservesSnapshotAndExpiry: true,
  expiredReplayFenced: true,
  orderingAndPaymentRemainDisabled: true,
  unknownChargesRemainExplicit: true,
  requestBodiesCaptured: false,
  browserAccepted: false,
  mainPromoted: false,
  bodies: captured.map(({ name, bytes, sha256, quote: q }) => ({
    name,
    bytes,
    sha256,
    locale: q.locale,
    saved: q.quoteId !== null,
    lineCount: q.lines.length,
    ordinaryLines: q.lines.filter((line) => line.lineKind === 'ordinary').length,
    acceptedLines: q.lines.filter((line) => line.lineKind === 'acceptedOffer').length,
    itemsSubtotalRial: q.itemsSubtotalRial,
    goodsTotalRial: q.goodsTotalRial,
    shippingRial: q.shippingRial,
    taxRial: q.taxRial,
    payableTotalRial: q.payableTotalRial,
    lines: q.lines.map((line) => ({
      lineKind: line.lineKind,
      quantity: line.quantity,
      unitPriceRial: line.unitPriceRial,
      lineTotalRial: line.lineTotalRial,
    })),
    canPlaceOrder: q.canPlaceOrder,
    canPay: q.canPay,
    canCreateTemporaryOrder: q.temporaryOrder.canCreate,
  })),
  scope:
    'Original synthetic-account SQL HTTP responses only. This verifier does not execute SQL, inspect stock side effects, render a browser, capture request bodies or promote the main runtime.',
};
await writeFile(
  path.join(directory, 'quote4-wire-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(report) + '\n');
