import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blankProductVariant,
  draftOfProduct,
  hasAttributeValue,
  productInput,
  rialToToman,
  tomanToRial,
  validateProductDraft,
  variantCandidates,
  type VariantAxis,
} from '../src/features/catalog/product-editor-model.ts';
import {
  productErrorPaths,
  readAdminFieldErrors,
} from '../src/features/catalog/product-field-errors.ts';
import type { AttributeDefinition, Catalog } from '../src/types/types';

const definition: AttributeDefinition = {
  id: 'storage',
  version: 'AAAAAAAAAAE=',
  key: 'storage',
  dataType: 'Select',
  translations: [
    { locale: 'fa', name: 'حافظه', description: '' },
    { locale: 'en', name: 'Storage', description: '' },
  ],
  options: [
    { id: 's128', value: '128', labelFa: '۱۲۸گیگابایت', labelEn: '128GB', sortOrder: 1 },
    { id: 's256', value: '256', labelFa: '۲۵۶گیگابایت', labelEn: '256GB', sortOrder: 2 },
  ],
};
const data: Catalog = {
  categories: [
    {
      id: 'phones',
      version: 'AAAAAAAAAAE=',
      slug: 'phones',
      imageUrl: '',
      isActive: true,
      sortOrder: 0,
      translations: [{ locale: 'fa', name: 'گوشی', description: '' }],
      attributes: [
        {
          attributeId: 'storage',
          isRequired: true,
          isFilterable: true,
          isComparable: true,
          showInSpecs: true,
          isVariantAxis: true,
          sortOrder: 0,
          groupName: 'memory',
        },
      ],
    },
  ],
  brands: [
    {
      id: 'brand',
      version: 'AAAAAAAAAAE=',
      name: 'Brand',
      slug: 'brand',
      logoUrl: '',
      isActive: true,
    },
  ],
  attributes: [definition],
  products: [],
};
test('toman editing preserves exact rial above Number safe range and Persian pasted prices', () => {
  assert.equal(tomanToRial('۱۲٬۳۴۵٫۶'), '123456');
  assert.equal(tomanToRial('٩٢٢٣٣٧٢٠٣٦٨٥٤٧٧٥٨٠٫٧'), '9223372036854775807');
  assert.equal(rialToToman('9223372036854775807'), '922337203685477580.7');
  for (const value of ['922337203685477580.8', '12.34', '-2', '1e6', 'NaN', '', 'Infinity'])
    assert.equal(tomanToRial(value), null, value);
});
test('category axes produce independent color and memory combinations and exclude existing exact rows', () => {
  const axis: VariantAxis = {
    definition,
    choices: definition.options.map((o) => ({
      labelFa: o.labelFa,
      labelEn: o.labelEn,
      value: { attributeId: definition.id, optionId: o.id },
    })),
  };
  const colors = [
    { hex: '#000000', nameFa: 'مشکی', nameEn: 'Black' },
    { hex: '#ffffff', nameFa: 'سفید', nameEn: 'White' },
  ];
  const first = variantCandidates(colors, [axis], []);
  assert.equal(first.length, 4);
  assert.equal(new Set(first.map((r) => r.signature)).size, 4);
  const row = {
    ...blankProductVariant('one'),
    color: '#000000',
    colorNameFa: 'مشکی',
    attributes: [{ attributeId: 'storage', optionId: 's128' }],
  };
  const remaining = variantCandidates(colors, [axis], [row]);
  assert.equal(remaining.length, 3);
  assert.ok(
    remaining.some((r) => r.color.hex === '#ffffff' && r.attributes[0].optionId === 's128'),
  );
  assert.throws(() =>
    variantCandidates(
      colors,
      [{ ...axis, choices: Array.from({ length: 51 }, () => axis.choices[0]) }],
      [],
    ),
  );
});
test('all invalid rows get field paths; required false and numeric zero remain values', () => {
  const draft = draftOfProduct(undefined, 'row1', []);
  draft.variants.push(blankProductVariant('row1'), {
    ...blankProductVariant('row2'),
    sku: 'same',
    price: 'bad',
  });
  draft.variants[0].sku = 'SAME';
  draft.variants[0].price = '100';
  draft.variants[0].referencePrice = '90';
  draft.status = 'Published';
  draft.slug = '';
  const errors = validateProductDraft(draft, data);
  for (const path of [
    'nameFa',
    'categoryId',
    'brandId',
    'slug',
    'images',
    'purchaseMethods',
    'variants.row1.sku',
    'variants.row2.sku',
    'variants.row1.referencePrice',
    'variants.row2.price',
  ])
    assert.ok(errors[path], path);
  assert.equal(hasAttributeValue({ attributeId: 'bool', bool: false }), true);
  assert.equal(hasAttributeValue({ attributeId: 'number', number: 0 }), true);
  assert.equal(hasAttributeValue({ attributeId: 'empty', textFa: ' ' }), false);
});
test('product command body owns catalog fields and never serializes warehouse quantities', () => {
  const draft = draftOfProduct(undefined, 'row1', []);
  Object.assign(draft, {
    nameFa: 'نام مشترک',
    categoryId: 'phones',
    brandId: 'brand',
    slug: 'model',
    onHand: 99,
  });
  draft.variants[0] = {
    ...blankProductVariant('row1'),
    sku: ' MODEL-BLACK ',
    price: '۱۲۳٫۴',
    referencePrice: '۱۵۰',
    colorNameFa: 'مشکی',
    warrantyFa: 'شرایط تعیین‌شده توسط مدیر',
  };
  const body = productInput(draft);
  assert.equal(body.variants[0].priceRial, '1234');
  assert.equal(body.variants[0].compareAtRial, '1500');
  assert.equal(body.variants[0].sku, 'MODEL-BLACK');
  assert.equal(body.translations[1].name, 'نام مشترک');
  assert.ok(!('onHand' in body));
  assert.ok(!('stock' in body));
  assert.equal(body.variants[0].warrantyEn, body.variants[0].warrantyFa);
});
test('server field errors are bounded and mapped to stable variant keys', () => {
  const parsed = readAdminFieldErrors({
    'variants.1.sku': ['این کد تکراری است.'],
    slug: ['نشانی تکراری است.'],
  });
  assert.ok(parsed);
  assert.deepEqual(productErrorPaths(parsed, ['first', 'second']), {
    'variants.second.sku': 'این کد تکراری است.',
    slug: 'نشانی تکراری است.',
  });
  assert.equal(readAdminFieldErrors({ '"><script>': ['bad'] }), undefined);
  assert.equal(readAdminFieldErrors({ slug: ['x'.repeat(501)] }), undefined);
  assert.deepEqual(productErrorPaths({ 'variants.20.sku': ['bad'] }, ['first']), {});
});
