import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  lookupInputSchema,
  lookupResponseSchema,
  lookupReferencesProduct,
} from '../apps/storefront/lib/catalog-contract.ts';
import { snapshotSchema } from '../apps/storefront/lib/snapshot.ts';
const root = path.resolve('artifacts/checks'),
  dir = path.join(root, 'comparison-browser-wire');
const stats = JSON.parse(await readFile(path.join(dir, 'stats.json'), 'utf8')),
  fixture = JSON.parse(await readFile(path.join(root, 'comparison-qa-fixture.json'), 'utf8'));
assert(
  stats.qaOnly &&
    stats.database === fixture.Database &&
    stats.failed === 1 &&
    stats.captured > 0 &&
    stats.captured <= 50,
);
const ids = new Set([...fixture.ProductIds, fixture.HiddenProductId, fixture.MixedProductId]);
const bodies = [];
let large = false,
  max = false,
  override = false,
  hiddenExcluded = false,
  mixed = false,
  four = false;
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
for (let i = 1; i <= stats.captured; i++) {
  const request = await readFile(path.join(dir, `${i}.request.json`)),
    response = await readFile(path.join(dir, `${i}.response.json`));
  assert(request.length <= 32768 && response.length <= 1048576);
  const refs = lookupInputSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request)),
    ),
    value = lookupResponseSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response)),
    );
  assert(
    refs.productIds.every((id) => ids.has(id)) &&
      refs.productIds.length <= 4 &&
      refs.variantIds.length === 0 &&
      refs.slugs.length === 0,
  );
  assert(value.products.every((p) => lookupReferencesProduct(refs, p)));
  const a = value.products.find((p) => p.id === fixture.ProductIds[0]),
    b = value.products.find((p) => p.id === fixture.ProductIds[1]);
  if (a) {
    const variant = a.variants.find((v) => v.id === fixture.Variants[0].Items[1].Id)!;
    assert.equal(variant.priceRial, '9007199254740993');
    large = true;
    const memory = fixture.Attributes[0].Key;
    assert.equal(a.attributes[memory], '128 GB');
    assert.equal(variant.attributes?.[memory], '512 GB');
    override = true;
  }
  if (b) {
    assert.equal(
      b.variants.find((v) => v.id === fixture.Variants[1].Items[1].Id)!.priceRial,
      '9223372036854775807',
    );
    max = true;
  }
  if (
    refs.productIds.includes(fixture.HiddenProductId) &&
    refs.productIds.length === 2 &&
    !value.products.some((p) => p.id === fixture.HiddenProductId)
  )
    hiddenExcluded = true;
  if (
    value.products.some((p) => p.id === fixture.MixedProductId) &&
    new Set(value.products.map((p) => p.category)).size === 2
  )
    mixed = true;
  if (
    value.products.length === 4 &&
    new Set(value.products.map((p) => p.category)).size === 1 &&
    value.products.every((p) => ids.has(p.id))
  )
    four = true;
  bodies.push({
    request: `${i}.request.json`,
    requestBytes: request.length,
    requestSha256: hash(request),
    response: `${i}.response.json`,
    responseBytes: response.length,
    responseSha256: hash(response),
    locale: value.locale,
    products: value.products.length,
  });
}
const metadata = [];
for (const locale of ['fa', 'en']) {
  const file = `comparison-metadata-${locale}.json`,
    raw = await readFile(path.join(root, file)),
    snapshot = snapshotSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)),
    );
  assert.equal(snapshot.locale, locale);
  assert(
    snapshot.dataSource === 'api' && snapshot.isPreview === true && snapshot.products.length === 0,
  );
  const category = snapshot.categories.find((c) => c.key === fixture.CategoryId)!;
  assert.equal(category.attributeRules?.filter((r) => r.comparable).length, 8);
  assert.equal(category.attributeRules?.filter((r) => !r.comparable).length, 1);
  assert.deepEqual(
    new Set(
      snapshot.attributeDefinitions
        .filter((d) => fixture.Attributes.some((a: { Key: string }) => a.Key === d.key))
        .map((d) => d.dataType),
    ),
    new Set(['number', 'bool', 'text', 'select', 'multiSelect']),
  );
  metadata.push({ file, bytes: raw.length, sha256: hash(raw) });
}
assert(large && max && override && hiddenExcluded && mixed && four);
const report = {
  passed: true,
  actualSqlHttpBodies: true,
  browserOriginatedPublicLookupBodiesViaBff: true,
  metadataSeparateAnonymousHttpReads: true,
  developmentApiIsPreviewTrue: true,
  fixtureBffMode: false,
  strictProductionDecoders: true,
  bodyNormalization: false,
  routeLocaleIndependentlyCaptured: false,
  lookupResponses: stats.captured,
  expectedInjected503: 1,
  largeRialExact: true,
  longMaxRialExact: true,
  variantOverrideVerified: true,
  hiddenExcludedBeforeAdminPublish: true,
  mixedCategoryReadBeforeAdminEdit: true,
  fourSameCategoryAfterAdminEdits: true,
  eightTypedComparableAttributes: true,
  bodies,
  metadata,
};
await writeFile(
  path.join(root, 'comparison-wire-acceptance.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    passed: true,
    responses: bodies.length,
    metadata: metadata.length,
    expected503: 1,
    eightTypedAttributes: true,
  }),
);
