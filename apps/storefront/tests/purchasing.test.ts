import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableCartMethods,
  availablePurchaseMethods,
  eligibleChequePlans,
} from '../lib/catalog/purchasing.ts';
import type { Product, PurchaseMethod, ChequePlan } from '@sayman/web-shared/lib/shared/types.ts';
const methods: PurchaseMethod[] = [
  {
    id: 'cash',
    kind: 'online',
    name: 'Cash',
    description: '',
    enabled: true,
    requiresApproval: false,
  },
  {
    id: 'credit',
    kind: 'cheque',
    name: 'Cheques',
    description: '',
    enabled: true,
    requiresApproval: true,
    minAmountRial: '1000',
  },
];
const p: Product = {
  id: 'p',
  slug: 'p',
  name: 'p',
  englishName: 'p',
  category: 'phones',
  brand: 'x',
  description: '',
  image: '',
  attributes: {},
  purchaseMethodIds: ['cash', 'credit'],
  chequePlanIds: ['six'],
  variants: [
    {
      id: 'v',
      sku: 'v',
      label: '',
      color: '',
      colorName: '',
      warranty: '',
      stock: 2,
      priceRial: '2000',
    },
  ],
};
test('product and variant restrictions cannot enable a globally disabled method', () => {
  assert.equal(
    availablePurchaseMethods({ ...p, purchaseMethodIds: ['cash'] }, p.variants[0], methods).some(
      (m) => m.id === 'credit',
    ),
    false,
  );
  assert.equal(
    availablePurchaseMethods(p, { ...p.variants[0], purchaseMethodIds: ['cash'] }, methods).length,
    1,
  );
  assert.equal(
    availablePurchaseMethods(
      p,
      p.variants[0],
      methods.map((m) => ({ ...m, enabled: false })),
    ).length,
    0,
  );
});
test('mixed cart uses intersection, not union, of eligible payment methods', () => {
  const cashOnly = {
    ...p,
    id: 'p2',
    purchaseMethodIds: ['cash'],
    variants: [{ ...p.variants[0], id: 'v2' }],
  };
  assert.deepEqual(
    availableCartMethods(
      [
        { variantId: 'v', quantity: 1 },
        { variantId: 'v2', quantity: 1 },
      ],
      [p, cashOnly],
      methods,
    ).map((m) => m.id),
    ['cash'],
  );
  assert.equal(
    availableCartMethods([{ variantId: 'unknown', quantity: 1 }], [p], methods).length,
    0,
  );
  assert.equal(availableCartMethods([{ variantId: 'v', quantity: 3 }], [p], methods).length, 0);
});
test('amount limits, category restrictions and plan assignment all apply', () => {
  assert.equal(
    availablePurchaseMethods(p, { ...p.variants[0], priceRial: '100' }, methods).some(
      (m) => m.id === 'credit',
    ),
    false,
  );
  assert.equal(
    availablePurchaseMethods(
      p,
      p.variants[0],
      methods.map((m) => ({ ...m, categoryIds: ['laptops'] })),
    ).length,
    0,
  );
  const plans: ChequePlan[] = [
    {
      id: 'six',
      months: 6,
      markupPercent: 12,
      downPaymentPercent: 30,
      intervalMonths: 1,
      minAmountRial: '1000',
    },
    { id: 'twelve', months: 12, markupPercent: 24, downPaymentPercent: 40, intervalMonths: 1 },
  ];
  assert.deepEqual(
    eligibleChequePlans(plans, 2000n, [p]).map((p) => p.id),
    ['six'],
  );
  assert.equal(
    eligibleChequePlans(
      plans.map((p) => ({ ...p, enabled: false })),
      2000n,
      [p],
    ).length,
    0,
  );
  assert.equal(eligibleChequePlans(plans, 500n, [p]).length, 0);
});
