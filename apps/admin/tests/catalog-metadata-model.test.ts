import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryParentOptions,
  metadataOptions,
  metadataTranslations,
} from '../src/features/catalog-metadata/catalog-metadata-model.ts';
import type { Category } from '../src/types/types.ts';

const category = (id: string, parentId?: string): Category => ({
  id,
  parentId,
  slug: id,
  version: 'fixture',
  sortOrder: 0,
  imageUrl: '',
  isActive: true,
  translations: [],
  attributes: [],
});

test('a category cannot be its own parent or move below one of its descendants', () => {
  const rows = [
    category('main'),
    category('branch', 'main'),
    category('leaf', 'branch'),
    category('other'),
    category('loop-a', 'loop-b'),
    category('loop-b', 'loop-a'),
    category('orphan', 'absent'),
  ];
  assert.deepEqual(
    categoryParentOptions(rows, 'branch').map((item) => item.id),
    ['main', 'other'],
  );
  assert.deepEqual(
    categoryParentOptions(rows).map((item) => item.id),
    ['main', 'branch', 'leaf', 'other'],
  );
});

test('opening an older single-language record provides an editable blank translation', () => {
  const row = { locale: 'fa' as const, name: 'کالای نمونه', description: 'توضیح' };
  assert.deepEqual(metadataTranslations([row]), [row, { locale: 'en', name: '', description: '' }]);
});

test('switching the draft from choices to a number removes stale options from the payload', () => {
  const original = [
    { id: 'stable', value: '128', labelFa: ' ۱۲۸ گیگ ', labelEn: '128 GB', sortOrder: 0 },
  ];
  assert.deepEqual(metadataOptions('Number', original), []);
  assert.deepEqual(metadataOptions('Select', original), [{ ...original[0], labelFa: '۱۲۸ گیگ' }]);
  assert.equal(original[0].labelFa, ' ۱۲۸ گیگ ');
});
