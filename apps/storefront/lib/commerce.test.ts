import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartTotal,
  chequeQuote,
  discount,
  filterVariants,
  matchesSearch,
  normalizePersian,
  sanitizeCart,
  toman,
} from './commerce.ts';
import type { Product, ChequePlan } from './types.ts';

const product: Product = {
  id: 'test',
  purchaseMethodIds: ['online', 'cheque'],
  slug: 'test',
  name: 'گوشی سامسونگ ۱۲۸',
  englishName: 'Samsung Galaxy',
  brand: 'Samsung',
  category: 'phones',
  description: '',
  image: '',
  attributes: { storage: '۱۲۸ گیگابایت' },
  variants: [
    {
      id: 'available',
      sku: 'TEST',
      label: '',
      color: '#000',
      colorName: 'مشکی',
      priceRial: '900719925474099300',
      stock: 2,
      warranty: '',
    },
    {
      id: 'sold-out',
      sku: 'SOLD',
      label: '',
      color: '#fff',
      colorName: 'سفید',
      priceRial: '10',
      stock: 0,
      warranty: '',
    },
  ],
};
test('Persian normalization handles Arabic forms, both digit sets, diacritics and spacing', () => {
  assert.equal(normalizePersian('  كِيف يک ۱۲۳ ٤٥٦\u200cگیگ  '), 'کیف یک 123 456 گیگ');
});
test('money stays exact beyond JavaScript safe integer and formats toman at the boundary', () => {
  assert.equal(
    cartTotal([{ variantId: 'available', quantity: 2 }], [product]),
    1801439850948198600n,
  );
  assert.equal(toman(1234567890n), '۱۲۳٬۴۵۶٬۷۸۹');
  assert.equal(discount('800', '1000'), 20);
  assert.equal(discount('1200', '1000'), 0);
});
test('untrusted persisted cart cannot inject unknown, sold-out, negative, fractional or excess quantities', () => {
  assert.deepEqual(
    sanitizeCart(
      [
        { variantId: 'available', quantity: 1 },
        { variantId: 'available', quantity: 8 },
        { variantId: 'sold-out', quantity: 1 },
        { variantId: 'unknown', quantity: 1 },
        { variantId: 'available', quantity: -1 },
        { variantId: 'available', quantity: 1.5 },
      ],
      [product],
    ),
    [{ variantId: 'available', quantity: 2 }],
  );
  assert.deepEqual(sanitizeCart({ cart: 'bad' }, [product]), []);
  assert.deepEqual(sanitizeCart([{ variantId: 'available', quantity: 0 }], [product]), []);
});
test('all installment amounts reconcile with the quoted total for every sample plan', () => {
  for (const months of [3, 6, 12])
    for (const amount of [0n, 10n, 10010n, 689000000n, 900719925474099300n]) {
      const plan: ChequePlan = {
        id: 'plan',
        months,
        intervalMonths: 1,
        downPaymentPercent: 30,
        markupPercent: 12,
      };
      const quote = chequeQuote(amount, plan);
      assert.equal(
        quote.installments.reduce((s, n) => s + n, quote.downPayment),
        quote.total,
      );
      assert.ok(quote.installments.every((n) => n >= 0n));
      assert.ok(quote.downPayment <= amount);
      assert.ok(quote.total >= amount);
      assert.equal(quote.installments.length, months);
      assert.equal(quote.downPayment % 10n, 0n);
    }
});
test('invalid installment configuration is rejected instead of silently producing a misleading quote', () => {
  const plan: ChequePlan = {
    id: 'invalid',
    months: 6,
    intervalMonths: 1,
    markupPercent: 12,
    downPaymentPercent: 30,
  };
  for (const patch of [
    { months: 0 },
    { months: 5, intervalMonths: 2 },
    { markupPercent: -1 },
    { downPaymentPercent: 101 },
    { intervalMonths: 0 },
  ])
    assert.throws(() => chequeQuote(1000n, { ...plan, ...patch }));
  assert.throws(() => chequeQuote(-10n, plan));
});
test('search uses normalized digits and Persian/English brand aliases', () => {
  assert.equal(matchesSearch(product, 'سامسونگ 128'), true);
  assert.equal(matchesSearch(product, 'samsung ١٢٨'), true);
  assert.equal(matchesSearch(product, 'ايفون'), false);
});
test('stock, price and dynamic attributes must match the same variant', () => {
  const p: Product = {
    ...product,
    variants: [
      {
        ...product.variants[0],
        id: 'small',
        priceRial: '1000',
        stock: 2,
        attributes: { storage: '128' },
      },
      {
        ...product.variants[0],
        id: 'large',
        priceRial: '2000',
        stock: 0,
        attributes: { storage: '256' },
      },
    ],
  };
  assert.equal(
    filterVariants(p, { maxPriceRial: 1500n, attributes: { storage: ['256'] } }).length,
    0,
  );
  assert.equal(
    filterVariants(p, { availableOnly: true, attributes: { storage: ['256'] } }).length,
    0,
  );
  assert.deepEqual(
    filterVariants(p, { attributes: { storage: ['256'] } }).map((v) => v.id),
    ['large'],
  );
  assert.equal(filterVariants(p, { attributes: { ram: [] } }).length, 2);
});
test('sample calculator bounds configuration size and keeps the down payment within a tiny principal', () => {
  const p: ChequePlan = {
    id: 'a',
    months: 6,
    intervalMonths: 1,
    downPaymentPercent: 30,
    markupPercent: 12,
  };
  assert.equal(chequeQuote(1n, p).downPayment, 1n);
  assert.throws(() => chequeQuote(10n, { ...p, months: 100000000 }));
  assert.throws(() => chequeQuote(10n, { ...p, markupPercent: 12.345 }));
});
