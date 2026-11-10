import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product, Variant } from '@sayman/web-shared/lib/shared/types.ts';
import {
  choosePhoneConfiguration,
  phoneConfigurations,
} from '../lib/catalog/phone-configurations.ts';

function sku(id: string, colorName: string, attributes: Variant['attributes'], stock = 1): Variant {
  return {
    id,
    sku: id,
    label: id,
    color: '#364152',
    colorName,
    attributes,
    stock,
    priceRial: '900000000',
    warranty: 'Sample warranty',
  };
}

function phone(variants: Variant[]): Product {
  return {
    id: 'phone',
    slug: 'phone',
    name: 'Phone',
    englishName: 'Phone',
    category: 'phones',
    brand: 'Sample',
    description: '',
    image: '',
    attributes: { storage: '128 GB', ram: '8 GB', region: 'A' },
    variants,
    purchaseMethodIds: [],
  };
}

test('color choices share effective technical facts but keep the original SKU and offer', () => {
  const black = sku('black', 'مشکی', { color: 'مشکی' });
  const blue = {
    ...sku('blue', 'آبی', { color: 'آبی', storage: '128 GB' }),
    priceRial: '810000000' as const,
    compareAtRial: '900000000' as const,
  };
  const larger = sku('larger', 'مشکی', { storage: '256 GB' });
  const otherRegion = sku('region', 'مشکی', { region: 'B' });
  const result = phoneConfigurations(phone([black, blue, larger, otherRegion]))!;
  assert.deepEqual(
    result.groups.map((group) => group.variants.map((item) => item.id)),
    [['black', 'blue'], ['larger'], ['region']],
  );
  assert.deepEqual(result.configurationKeys, ['storage', 'ram', 'region']);
  assert.deepEqual(result.groups[0].specs, { storage: '128 GB', ram: '8 GB', region: 'A' });
  assert.equal(result.groups[0].variants[1], blue);
});

test('duplicate or missing color data keeps every SKU available through the detailed selector', () => {
  const first = sku('a', 'خاكستری', {});
  const second = sku('b', 'خاکستری', {});
  const missing = sku('c', '', {});
  const valid = sku('d', 'مشکی', { storage: '256 GB' });
  const product = phone([first, second, missing, valid]);
  const result = phoneConfigurations(product)!;
  assert.equal(result.groups[0].colorOnly, false);
  assert.deepEqual(result.groups[0].variants, [first, second, missing]);
  assert.equal(result.groups[1].colorOnly, true);
  const laptop = phoneConfigurations({ ...product, category: 'laptops' })!;
  assert.equal(laptop.isPhone, false);
  assert.equal(laptop.groups[0].colorOnly, false);
  assert.deepEqual(laptop.groups[1].variants, [valid]);
  assert.equal(phoneConfigurations(phone([first, second, missing])), null);
});

test('switching configuration prefers the previous color when it is in stock', () => {
  const black = sku('old', 'Black', {});
  const blue = sku('blue', 'Blue', {});
  const availableBlack = sku('new', 'Black', {});
  const soldOutBlack = { ...availableBlack, stock: 0 };
  assert.equal(choosePhoneConfiguration([blue, availableBlack], black), availableBlack);
  assert.equal(choosePhoneConfiguration([soldOutBlack, blue], black), blue);
  assert.equal(
    choosePhoneConfiguration([{ ...blue, stock: 0 }, soldOutBlack], black),
    soldOutBlack,
  );
});
