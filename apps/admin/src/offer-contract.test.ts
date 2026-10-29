import test from 'node:test';
import assert from 'node:assert/strict';
import {
  offerAdminCommandMatches,
  offerAdminDetailSchema,
  offerAdminPageSchema,
  offerSkuLookupPath,
  offerSkuPageSchema,
  offerSkuReadPath,
  type OfferAdminCommand,
} from './offer-contract.ts';
import { offerMutationSchema } from '../../storefront/lib/offer-contract.ts';
import {
  offerTestAction as action,
  offerTestDetail as detail,
  offerTestMutation as mutation,
  offerTestRequest as requestId,
  offerTestId as offerId,
  offerTestListing as listingId,
  offerTestPage as page,
  offerTestSku as sku,
} from '../../storefront/lib/offer.test-fixtures.ts';
test('admin offer decoders require staff child capabilities and bounded SKU choices', () => {
  assert.equal(
    offerAdminDetailSchema.safeParse({
      ...detail,
      canAccept: false,
      canDecline: false,
      canCancelRequest: false,
      canPublish: true,
    }).success,
    true,
  );
  assert.equal(offerAdminDetailSchema.safeParse(detail).success, false);
  assert.equal(
    offerAdminPageSchema.safeParse({
      ...page,
      pageSize: 50,
      canCancelRequest: false,
      canMarkRequestUnavailable: true,
    }).success,
    true,
  );
  const {
      variantId,
      productId,
      sku: code,
      labelFa,
      labelEn,
      color,
      colorNameFa,
      colorNameEn,
      warrantyFa,
      warrantyEn,
      publicPriceRial,
      version,
    } = sku,
    choice = {
      variantId,
      productId,
      sku: code,
      labelFa,
      labelEn,
      color,
      colorNameFa,
      colorNameEn,
      warrantyFa,
      warrantyEn,
      publicPriceRial,
      version,
    };
  const decoded = offerSkuPageSchema.parse({
    schemaVersion: 1,
    pageSize: 20,
    items: [choice],
    nextCursor: null,
  });
  assert.equal(decoded.items[0].publicPriceRial, '9007199254740993');
  for (const value of [
    { schemaVersion: 1, pageSize: 20, items: [choice, choice], nextCursor: null },
    { schemaVersion: 1, pageSize: 20, items: [{ ...choice, onHand: 1 }], nextCursor: null },
    { schemaVersion: 1, pageSize: 50, items: [], nextCursor: null },
  ])
    assert.equal(offerSkuPageSchema.safeParse(value).success, false);
});
test('admin offer acknowledgement binds operation and both requested resources', () => {
  const command: OfferAdminCommand = {
    id: action.requestId,
    kind: 'withdraw',
    requestId,
    offerId,
    body: action,
    phase: 'unknown',
  };
  const value = offerMutationSchema.parse({
    ...mutation,
    operation: 'withdraw',
    state: 'Withdrawn',
    acceptanceId: null,
  });
  assert.equal(offerAdminCommandMatches(command, value), true);
  assert.equal(offerAdminCommandMatches(command, { ...value, offerId: 'f'.repeat(32) }), false);
  assert.equal(offerAdminCommandMatches(command, { ...value, requestId: 'f'.repeat(32) }), false);
  assert.equal(offerAdminCommandMatches(command, offerMutationSchema.parse(mutation)), false);
});
test('SKU lookup paths bind request listing and encode bounded search and cursor without trusting model body', () => {
  const path = offerSkuLookupPath(requestId, listingId, 'QA & white', 'abc_-'),
    url = new URL(path, 'http://localhost');
  assert.equal(url.searchParams.get('listingId'), listingId);
  assert.equal(url.searchParams.get('query'), 'QA & white');
  assert.equal(url.searchParams.get('cursor'), 'abc_-');
  assert.equal(url.searchParams.has('modelId'), false);
  assert.equal(
    offerSkuReadPath(requestId, listingId, sku.variantId),
    `/admin/sourcing/requests/${requestId}/offer-skus/${sku.variantId}?listingId=${listingId}`,
  );
  assert.throws(() => offerSkuReadPath(requestId, listingId, '../admin'));
  assert.throws(() => offerSkuLookupPath(requestId, listingId, 'x'.repeat(121), null));
  assert.throws(() => offerSkuLookupPath(requestId, listingId, 'a b c d e f g h i', null));
  assert.throws(() => offerSkuLookupPath(requestId, listingId, '', 'bad/cursor'));
});
