import test from 'node:test';
import assert from 'node:assert/strict';
import {
  productInspectionImages,
  inspectionGalleryKey,
} from '../lib/catalog/used-inspection-photos.ts';
import { usedConditionSchema } from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';
const report = usedConditionSchema.parse({
  inspectionId: 'a'.repeat(32),
  technicalState: 'unknown',
  batteryState: 'unknown',
  batteryHealthPercent: null,
  screenState: 'damaged',
  bodyState: 'worn',
  repairState: 'unknown',
  notesFa: '',
  notesEn: '',
  inspectedAt: '2026-10-30T10:00:00Z',
  photos: [
    {
      url: '/media/catalog/' + 'b'.repeat(32) + '/card.webp',
      altFa: 'همین دستگاه',
      altEn: 'This exact unit',
    },
  ],
});
test('product gallery selects only this inspection’s photos and uses locale alternatives; a different unit never inherits them', () => {
  const product = {
    name: 'Generic model',
    image: '/products/model.webp',
    images: ['/products/model.webp', '/products/other.webp'],
  };
  assert.deepEqual(productInspectionImages(product, report, 'fa'), [
    { url: report.photos![0].url, alt: 'همین دستگاه', source: 'inspection' },
  ]);
  assert.equal(productInspectionImages(product, report, 'en')[0].alt, 'This exact unit');
  assert.ok(
    productInspectionImages(product, undefined, 'fa').every((item) => item.source === 'catalog'),
  );
  assert.deepEqual(
    productInspectionImages(product, { ...report, photos: [] }, 'en').map((item) => item.url),
    product.images,
  );
  const key = inspectionGalleryKey({ id: 'USED-A', usedCondition: report });
  assert.notEqual(inspectionGalleryKey({ id: 'USED-B', usedCondition: report }), key);
  assert.notEqual(
    inspectionGalleryKey({
      id: 'USED-A',
      usedCondition: { ...report, inspectionId: 'c'.repeat(32) },
    }),
    key,
  );
});
