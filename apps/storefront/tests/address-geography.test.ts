import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  provinces,
  counties,
  cities,
  findProvince,
  findCounty,
  geographyVersion,
  geographySearch,
  resolveLegacyLocation,
  countyMapCenter,
} from '../lib/address/address-geography.ts';
import {
  addressBook,
  addressOrderFields,
  saveAddressInput,
} from '../lib/address/address-contract.ts';

const details = {
  geographyVersion,
  provinceId: '123',
  countyId: '1230001',
  cityId: '1230001001576',
  localityKind: 'city',
  plaque: '۱۲',
  unit: '۲',
  latitude: 35.6892,
  longitude: 51.389,
};
const input = {
  label: 'خانه',
  contactName: 'گیرندهٔ آزمون',
  contactPhone: '+۹۸۹۱۲۱۲۳۴۵۶۷',
  delivery: {
    countryCode: 'IR',
    province: 'تهران',
    city: 'تهران',
    address: 'خیابان آزمایشی، کوچهٔ نمونه',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
  },
  details,
  makeDefault: false,
  version: null,
};
test('pinned geography retains every source province, county and city, with explicit valid parents and unique IDs', () => {
  const folder = new URL('../../../data/iran-geography/', import.meta.url);
  for (const [kind, rows, count] of [
    ['provinces', provinces, 31],
    ['counties', counties, 484],
    ['cities', cities, 1672],
  ] as const) {
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map((r) => r.id)).size, count);
    const original = JSON.parse(readFileSync(new URL(kind + '.json', folder), 'utf8')) as {
      id: number;
      name: string;
      province_id?: number;
      county_id?: number;
    }[];
    for (const row of original) {
      const projected = rows.find((r) => r.id === String(row.id));
      assert.ok(projected);
      assert.equal(projected.name, row.name);
      if (row.province_id)
        assert.equal((projected as (typeof counties)[number]).provinceId, String(row.province_id));
      if (row.county_id)
        assert.equal((projected as (typeof cities)[number]).countyId, String(row.county_id));
    }
  }
  for (const county of counties) assert.ok(findProvince(county.provinceId));
  for (const city of cities) assert.equal(findCounty(city.countyId)?.provinceId, city.provinceId);
  const publicFolder = new URL('../public/data/', import.meta.url);
  const metadata = JSON.parse(
    readFileSync(new URL('iran-geography-source.json', publicFolder), 'utf8'),
  );
  assert.equal(
    metadata.sha256,
    createHash('sha256')
      .update(readFileSync(new URL('iran-geography.v1.json', publicFolder)))
      .digest('hex'),
  );
  assert.equal(metadata.sourceYear, 1404);
  assert.match(
    readFileSync(new URL('iran-geography-LICENSE.txt', publicFolder), 'utf8'),
    /GNU GENERAL PUBLIC LICENSE/,
  );
});
test('search normalizes Persian compatibility and legacy resolution only chooses an unambiguous parent chain', () => {
  assert.equal(geographySearch('كاشان'), geographySearch('کاشان'));
  assert.equal(geographySearch('قائم شهر'), geographySearch('قائم‌شهر'));
  assert.deepEqual(resolveLegacyLocation('تهران', 'تهران'), {
    provinceId: '123',
    countyId: '1230001',
    cityId: '1230001001576',
  });
  assert.equal(resolveLegacyLocation('تهران', 'محل تازه').cityId, '');
  assert.deepEqual(resolveLegacyLocation('ناشناخته', 'تهران'), {
    provinceId: '',
    countyId: '',
    cityId: '',
  });
  for (const county of counties) {
    const center = countyMapCenter(county.id);
    assert.ok(center && center.every(Number.isFinite));
  }
});
test('writes bind province county city and labels, normalize building digits and reject forged or incomplete geography', () => {
  assert.equal(saveAddressInput.parse(input).details.plaque, '12');
  assert.equal(saveAddressInput.parse(input).details.unit, '2');
  for (const d of [
    { ...details, provinceId: '999' },
    { ...details, countyId: '1000001' },
    { ...details, cityId: '1000001001101' },
    { ...details, cityId: null },
    { ...details, localityKind: 'other' },
    { ...details, geographyVersion: 'unknown' },
    { ...details, plaque: '' },
    { ...details, plaque: '۱۲\u202e' },
    { ...details, unit: 'x'.repeat(11) },
    { ...details, latitude: null },
    { ...details, longitude: null },
    { ...details, latitude: 90 },
    { ...details, longitude: 0 },
    { ...details, latitude: Number.NaN },
    { ...details, latitude: Infinity },
    { ...details, ownerId: 'other' },
  ])
    assert.equal(
      saveAddressInput.safeParse({ ...input, details: d }).success,
      false,
      JSON.stringify(d),
    );
  for (const delivery of [
    { ...input.delivery, province: 'اصفهان' },
    { ...input.delivery, city: 'کاشان' },
  ])
    assert.equal(saveAddressInput.safeParse({ ...input, delivery }).success, false);
  assert.equal(saveAddressInput.safeParse({ ...input, details: undefined }).success, false);
  assert.equal(
    saveAddressInput.safeParse({
      ...input,
      delivery: { ...input.delivery, address: 'x'.repeat(2000) },
    }).success,
    false,
  );
});
test('a village/new locality remains available within a known county; map is optional and does not replace the street or postal code', () => {
  const manual = {
    ...input,
    delivery: { ...input.delivery, city: 'روستای نمونه' },
    details: { ...details, localityKind: 'other', cityId: null, latitude: null, longitude: null },
  };
  assert.equal(saveAddressInput.safeParse(manual).success, true);
  assert.equal(
    saveAddressInput.safeParse({ ...manual, delivery: { ...manual.delivery, address: '' } })
      .success,
    false,
  );
  assert.equal(
    saveAddressInput.safeParse({ ...manual, delivery: { ...manual.delivery, postalCode: '' } })
      .success,
    false,
  );
  const canonical = saveAddressInput.parse(manual);
  const row = {
    id: 'a'.repeat(32),
    label: canonical.label,
    contactName: canonical.contactName,
    contactPhone: canonical.contactPhone,
    delivery: canonical.delivery,
    details: canonical.details,
    isDefault: true,
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    version: 'AAAAAAAAAAE=',
  };
  const saved = addressBook.parse({ schemaVersion: 1, capacity: 20, items: [row] }).items[0];
  const fields = addressOrderFields(saved);
  assert.equal(fields.address, 'خیابان آزمایشی، کوچهٔ نمونه\nشهرستان تهران، پلاک 12، واحد 2');
  assert.equal('latitude' in fields, false);
  const { details: _details, ...legacy } = row;
  assert.equal(
    addressBook.safeParse({ schemaVersion: 1, capacity: 20, items: [legacy] }).success,
    true,
  );
  assert.equal(addressOrderFields(legacy).address, legacy.delivery.address);
});
