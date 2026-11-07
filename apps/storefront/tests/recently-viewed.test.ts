import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product, Variant } from '@sayman/web-shared/lib/shared/types.ts';
import {
  parseRecentViews,
  recordRecentView,
  resolveRecentViews,
} from '../lib/catalog/recently-viewed.ts';

const view = (productId: string, variantId = productId + '-first') => ({ productId, variantId });

test('history keeps the latest exact variant per product and caps the list at six', () => {
  const older = Array.from({ length: 6 }, (_, i) => view(String(i)));
  assert.deepEqual(recordRecentView(older, view('2', 'blue')), [
    view('2', 'blue'),
    ...older.filter((entry) => entry.productId !== '2'),
  ]);
  assert.deepEqual(recordRecentView(older, view('new')), [view('new'), ...older.slice(0, 5)]);
});

test('stored data is bounded and contains only valid product and variant references', () => {
  assert.deepEqual(
    parseRecentViews(
      JSON.stringify([
        null,
        { ...view('first'), price: '200', name: 'Stale data' },
        view('first', 'duplicate'),
        view('second', ''),
        view(' third'),
        view('fourth'),
      ]),
    ),
    [view('first'), view('fourth')],
  );
  assert.deepEqual(parseRecentViews('{broken'), []);
  assert.deepEqual(parseRecentViews(' '.repeat(3000)), []);
});

test('hydration preserves visit order, keeps sold-out variants, and skips deleted ones', () => {
  const variant = (id: string, stock: number): Variant => ({
    id,
    sku: id,
    label: id,
    color: '',
    colorName: '',
    stock,
    priceRial: '9223372036854775807',
    warranty: '',
  });
  const product = (id: string, variants: Variant[]): Product => ({
    id,
    slug: id,
    name: id,
    englishName: id,
    category: 'phones',
    brand: '',
    description: '',
    image: '/products/phone-green.svg',
    attributes: {},
    variants,
    purchaseMethodIds: [],
  });
  const first = product('first', [variant('black', 8), variant('blue', 0)]);
  const second = product('second', [variant('white', 3)]);
  assert.deepEqual(
    resolveRecentViews(
      [view('first', 'blue'), view('missing', 'white'), view('second', 'white')],
      [second, first],
    ),
    [
      { product: first, variant: first.variants[1] },
      { product: second, variant: second.variants[0] },
    ],
  );
  assert.deepEqual(resolveRecentViews([view('first', 'deleted')], [first]), []);
});
