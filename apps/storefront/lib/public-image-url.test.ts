import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicImageUrl } from './public-image-url.ts';
import { snapshotSchema } from './snapshot.ts';
import { storefrontSnapshot } from './fixtures.ts';

test('public image paths accept processed upload variants, safe static assets and CDN queries', () => {
  for (const value of [
    '/products/phone-silver.svg',
    '/products/campaign_1/hero-2.avif',
    '/products/campaign/photo.jpeg',
    '/media/catalog/' + 'a'.repeat(32) + '/thumb.webp',
    '/media/catalog/' + 'a'.repeat(32) + '/card.webp',
    '/media/catalog/' + 'a'.repeat(32) + '/zoom.webp',
    'https://images.example.test/photo.webp?width=800&format=webp',
  ])
    assert.equal(isPublicImageUrl(value), true, value);
});

test('public image paths reject malformed, private, credential-bearing and executable sources', () => {
  for (const value of [
    '',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'http://images.example.test/photo.webp',
    'https://user:secret@images.example.test/photo.webp',
    'https://images.example.test/photo.webp#fragment',
    'https://images.example.test/photo.webp#',
    'https://images.example.test/photo\n.webp',
    'https://images.example.test/photo\u007f.webp',
    'https://images.example.test\\photo.webp',
    'https://a%',
    'https://images.example.test/' + 'a'.repeat(1500),
    '//images.example.test/photo.webp',
    '/api/private-files/photo.webp',
    '/media/private/photo.webp',
    '/media/catalog/' + 'a'.repeat(32) + '/original.webp',
    '/media/catalog/' + 'A'.repeat(32) + '/card.webp',
    '/media/catalog/' + 'a'.repeat(32) + '/card.webp?token=secret',
    '/products/../private.webp',
    '/products/%2e%2e/private.webp',
    '/products//photo.webp',
    '/products/photo.webp?token=secret',
    '/products/photo.html',
  ])
    assert.equal(isPublicImageUrl(value), false, value);
});

test('snapshot rejects unsafe images at every rendered catalog and CMS image field', () => {
  const invalid = 'https://user:secret@images.example.test/photo.webp';
  const cases = [
    (v: typeof storefrontSnapshot) => {
      v.products[0].image = invalid;
    },
    (v: typeof storefrontSnapshot) => {
      v.products[0].images = [invalid];
    },
    (v: typeof storefrontSnapshot) => {
      v.categories[0].image = invalid;
    },
    (v: typeof storefrontSnapshot) => {
      v.site.logoUrl = invalid;
    },
    (v: typeof storefrontSnapshot) => {
      v.site.hero.image = invalid;
    },
    (v: typeof storefrontSnapshot) => {
      v.site.homeBlocks = [
        {
          id: 'promo',
          kind: 'promotions',
          enabled: true,
          items: [
            {
              eyebrow: '',
              title: '',
              action: '',
              href: '/catalog',
              image: invalid,
            },
          ],
        },
      ];
    },
  ];
  for (const change of cases) {
    const value = structuredClone(storefrontSnapshot);
    change(value);
    assert.equal(snapshotSchema.safeParse(value).success, false);
  }
  const valid = structuredClone(storefrontSnapshot);
  valid.products[0].image = '/media/catalog/' + 'a'.repeat(32) + '/card.webp';
  valid.products[0].images = [valid.products[0].image];
  valid.categories[0].image = 'https://images.example.test/phone.webp?width=400';
  assert.equal(snapshotSchema.safeParse(valid).success, true);
});
