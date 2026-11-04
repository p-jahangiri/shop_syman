import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maxAddressLocationSearchResults,
  normalizeAddressLocationQuery,
  searchAddressLocations,
} from '../lib/address/address-location-search.ts';
import {
  cities,
  counties,
  countyMapCenter,
  findCity,
  findCounty,
  findProvince,
} from '../lib/address/address-geography.ts';

test('location search normalizes Arabic letters, marks, spacing and Persian compatibility forms', () => {
  assert.equal(normalizeAddressLocationQuery('كـاشَان'), normalizeAddressLocationQuery('کاشان'));
  assert.equal(
    normalizeAddressLocationQuery('علي آباد'),
    normalizeAddressLocationQuery('علی‌آباد'),
  );
  assert.deepEqual(searchAddressLocations('كـاشَان'), searchAddressLocations('کاشان'));
  assert.deepEqual(searchAddressLocations('قائم شهر'), searchAddressLocations('قائم‌شهر'));
});

test('province, county and city tokens match the same actual ancestry in any order', () => {
  const expected = cities.find((city) => city.name === 'تجریش');
  assert.ok(expected);
  const matches = searchAddressLocations('تهران، شمیرانات / تجریش');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].cityId, expected.id);
  assert.equal(matches[0].countyId, expected.countyId);
  assert.equal(matches[0].provinceId, expected.provinceId);
  assert.deepEqual(matches, searchAddressLocations('تجریش شمیرانات تهران'));
  assert.equal(searchAddressLocations('اصفهان تجریش').length, 0);
});

test('duplicate city names remain separate, with full parent paths and stable unique identities', () => {
  const originals = cities.filter((city) => city.name === 'مهاجران');
  assert.equal(originals.length, 2);
  const matches = searchAddressLocations('مهاجران').filter((item) => item.kind === 'city');
  assert.deepEqual(
    new Set(matches.map((item) => item.cityId)),
    new Set(originals.map((c) => c.id)),
  );
  assert.equal(new Set(matches.map((item) => item.key)).size, matches.length);
  for (const item of matches) {
    const city = findCity(item.cityId!);
    assert.ok(city);
    assert.deepEqual(item.path, [
      findProvince(city.provinceId)!.name,
      findCounty(city.countyId)!.name,
      city.name,
    ]);
    const narrowed = searchAddressLocations(`${item.provinceName} ${item.name}`);
    assert.ok(narrowed.some((candidate) => candidate.key === item.key));
    assert.equal(narrowed.filter((candidate) => candidate.name === item.name).length, 1);
  }
});

test('exact city names rank before county and ancestor-only matches, with deterministic bounded results', () => {
  const matches = searchAddressLocations('تهران');
  assert.equal(matches.length, maxAddressLocationSearchResults);
  assert.equal(matches[0].kind, 'city');
  assert.equal(matches[0].name, 'تهران');
  assert.equal(matches[1].kind, 'county');
  assert.equal(matches[1].name, 'تهران');
  assert.deepEqual(searchAddressLocations('تهران'), matches);
  assert.deepEqual(searchAddressLocations('تهران', { limit: 2 }), matches.slice(0, 2));
  assert.deepEqual(searchAddressLocations('تهران', { limit: 2.8 }), matches.slice(0, 2));
  for (const limit of [1000, Infinity, Number.NaN])
    assert.equal(
      searchAddressLocations('تهران', { limit }).length,
      maxAddressLocationSearchResults,
    );
  for (const limit of [0, -1]) assert.deepEqual(searchAddressLocations('تهران', { limit }), []);
  for (const query of ['', '  \u200c ', '، /', 'نامی که وجود ندارد', '1230001001576'])
    assert.deepEqual(searchAddressLocations(query), []);
});

test('all discoverable results preserve real IDs and expose only the approximate county center', () => {
  const discovered = new Map(
    [...cities, ...counties].flatMap((row) =>
      searchAddressLocations(row.name).map((entry) => [entry.key, entry] as const),
    ),
  );
  assert.ok(discovered.size > cities.length);
  for (const entry of discovered.values()) {
    const county = findCounty(entry.countyId);
    assert.ok(county);
    assert.equal(county.provinceId, entry.provinceId);
    assert.equal(findProvince(entry.provinceId)?.name, entry.provinceName);
    assert.equal(county.name, entry.countyName);
    assert.deepEqual(entry.center, countyMapCenter(county.id));
    assert.equal(entry.centerSource, entry.center ? 'county' : null);
    if (entry.kind === 'city') {
      const city = findCity(entry.cityId!);
      assert.ok(city);
      assert.equal(city.countyId, county.id);
      assert.equal(city.provinceId, entry.provinceId);
      assert.equal(city.name, entry.cityName);
    } else {
      assert.equal(entry.cityId, null);
      assert.equal(entry.cityName, null);
    }
  }
});

test('callers cannot mutate the search index through returned map centers or paths', () => {
  const original = searchAddressLocations('تجریش');
  const changed = searchAddressLocations('تجریش');
  changed[0].path[0] = 'نام جعلی';
  changed[0].center![0] = 0;
  changed[0].provinceId = 'invalid';
  assert.deepEqual(searchAddressLocations('تجریش'), original);
});
