import test from 'node:test';
import assert from 'node:assert/strict';
import { storefrontSnapshot } from './fixtures.ts';
import { snapshotSchema } from './snapshot.ts';
test('validates the API snapshot boundary without losing large money strings', () => {
  const value = structuredClone(storefrontSnapshot);
  value.products[0].variants[0].priceRial = '9223372036854775807';
  value.products[0].variants[0].compareAtRial = undefined;
  assert.equal(
    snapshotSchema.parse(value).products[0].variants[0].priceRial,
    '9223372036854775807',
  );
});
test('rejects unsafe menus and malformed money at the API boundary', () => {
  const value = structuredClone(storefrontSnapshot);
  value.site.nav[0].href = '//external.test';
  assert.equal(snapshotSchema.safeParse(value).success, false);
  value.site.nav[0].href = '/catalog';
  value.products[0].variants[0].priceRial = '9223372036854775808';
  assert.equal(snapshotSchema.safeParse(value).success, false);
});
test('CMS cannot introduce executable block kinds or CSS values', () => {
  const value = structuredClone(storefrontSnapshot);
  assert.equal(snapshotSchema.safeParse(value).success, true);
  assert.equal(
    snapshotSchema.safeParse({
      ...value,
      site: { ...value.site, palette: { primaryLight: 'url(https://bad.test)' } },
    }).success,
    false,
  );
  assert.equal(
    snapshotSchema.safeParse({
      ...value,
      site: { ...value.site, homeBlocks: [{ id: 'script', kind: 'script', enabled: true }] },
    }).success,
    false,
  );
});

test('CMS SEO rejects signed, credential-bearing and malformed share URLs', () => {
  for (const shareImage of [
    'https://media.test/x.jpg?token=secret',
    'https://u:p@media.test/x.jpg',
    'https://a%',
    '/media/a.jpg#private',
  ])
    assert.equal(
      snapshotSchema.safeParse({
        ...storefrontSnapshot,
        site: { ...storefrontSnapshot.site, seo: { shareImage } },
      }).success,
      false,
    );
});
