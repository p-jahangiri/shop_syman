import test from 'node:test';
import assert from 'node:assert/strict';
import { activeHomeBlocks, curatedProducts } from '../lib/content/home-blocks.ts';
import { homeBlockSchema } from '../lib/data/snapshot.ts';
import { products } from '../lib/data/fixtures.ts';
import type { HomeBlock } from '@sayman/web-shared/lib/shared/types.ts';
const block: HomeBlock = {
  id: 'moments',
  kind: 'spotlight',
  enabled: true,
  title: 'Sample picks',
  productIds: [products[1].id, products[0].id],
};
test('scheduled selection includes start, excludes end, disabled and malformed dates', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.deepEqual(
    activeHomeBlocks(
      [
        { ...block, startsAt: '2026-10-23T12:00:00Z' },
        { ...block, id: 'end', endsAt: '2026-10-23T12:00:00Z' },
        { ...block, id: 'future', startsAt: '2026-10-24T12:00:00Z' },
        { ...block, id: 'disabled', enabled: false },
        { ...block, id: 'invalid', endsAt: 'invalid' },
      ],
      now,
    ).map((b) => b.id),
    ['moments'],
  );
});
test('manual selection preserves order and never fills missing ids with unrelated products', () => {
  assert.deepEqual(
    curatedProducts(
      { ...block, productIds: ['not-public', products[1].id, products[1].id, products[0].id] },
      products,
    ).map((p) => p.id),
    [products[1].id, products[0].id],
  );
  assert.deepEqual(curatedProducts({ ...block, productIds: [] }, products), []);
  assert.deepEqual(curatedProducts({ ...block, productIds: ['not-public'] }, products), []);
  assert.equal(curatedProducts(block, products, 1)[0].id, products[1].id);
});
test('membership never changes money, availability or purchase terms', () => {
  const originals = structuredClone(products);
  const selected = curatedProducts(block, products);
  assert.deepEqual(selected[0], products[1]);
  assert.deepEqual(products, originals);
  assert.deepEqual(curatedProducts({ ...block, categoryId: 'laptops' }, products), []);
});
test('API boundary rejects enabled empty, duplicate and reversed-time spotlight definitions', () => {
  assert.equal(homeBlockSchema.safeParse(block).success, true);
  for (const invalid of [
    { ...block, productIds: [] },
    { ...block, title: ' ' },
    { ...block, productIds: ['a', 'a'] },
    { ...block, startsAt: '2026-10-24T00:00:00Z', endsAt: '2026-10-23T00:00:00Z' },
  ])
    assert.equal(homeBlockSchema.safeParse(invalid).success, false);
  assert.equal(
    homeBlockSchema.safeParse({ ...block, enabled: false, title: '', productIds: [] }).success,
    true,
  );
});
