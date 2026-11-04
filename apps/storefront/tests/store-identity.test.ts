import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storeIdentitySchema,
  visibleStoreIdentity,
  publicHttpsUrl,
} from '@sayman/web-shared/lib/content/store-identity.ts';
import { snapshotSchema } from '../lib/data/snapshot.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';

const social = (platform: string, url: string, enabled = true) => ({ platform, url, enabled });
const badge = (verificationUrl: string, kind = 'enamad') => ({
  id: kind,
  kind,
  title: 'مجوز',
  verificationUrl,
  enabled: true,
});
test('old snapshot remains valid; typed identity survives the actual storefront parser', () => {
  assert.equal(snapshotSchema.safeParse(storefrontSnapshot).success, true);
  const storeIdentity = {
    demonstration: true,
    policyLinks: [{ id: 'terms', title: 'شرایط خرید و مرجوعی', href: '/support', enabled: true }],
  };
  assert.deepEqual(
    snapshotSchema.parse({
      ...storefrontSnapshot,
      site: { ...storefrontSnapshot.site, storeIdentity },
    }).site.storeIdentity,
    storeIdentity,
  );
});
test('supported profiles use exact known hosts and WhatsApp international numbers', () => {
  const rows = [
    social('instagram', 'https://www.instagram.com/shop_sample'),
    social('telegram', 'https://t.me/shop_sample'),
    social('whatsapp', 'https://wa.me/989123456789'),
    social('aparat', 'https://www.aparat.com/shop_sample'),
    social('linkedin', 'https://www.linkedin.com/company/shop_sample'),
  ];
  assert.equal(storeIdentitySchema.safeParse({ socialLinks: rows }).success, true);
});
test('credentials, service redirects, wrong hosts and browser-normalized hostile URLs are rejected', () => {
  for (const url of [
    'javascript:alert(1)',
    '//instagram.com/shop',
    'https://instagram.com.evil.test/shop',
    'https://user:pass@instagram.com/shop',
    'https://instagram.com:444/shop',
    'https://instagram.com:443/shop',
    'https://instagram.com/shop#x',
    'https://instagram.com/shop?next=https://evil.test',
    'https://instagram.com/accounts',
    'https://instagram.com/shop\\x',
    'https://instagram.com/\u0000shop',
    'https://instagram.com/\u202eshop',
    'https://instagram.com/shop/../accounts',
  ]) {
    assert.equal(
      storeIdentitySchema.safeParse({ socialLinks: [social('instagram', url)] }).success,
      false,
      url,
    );
  }
  for (const url of [
    'https://wa.me/+989123456789',
    'https://wa.me/09121234567',
    'https://wa.me/98912',
    'https://wa.me/989123456789?text=hello',
  ])
    assert.equal(
      storeIdentitySchema.safeParse({ socialLinks: [social('whatsapp', url)] }).success,
      false,
      url,
    );
});
test('hidden rows cannot retain unsafe URLs, while incomplete disabled entries are editable', () => {
  assert.equal(
    storeIdentitySchema.safeParse({
      socialLinks: [social('instagram', '', false)],
      badges: [{ ...badge(''), enabled: false, title: '' }],
    }).success,
    true,
  );
  assert.equal(
    storeIdentitySchema.safeParse({
      socialLinks: [social('instagram', 'javascript:alert(1)', false)],
    }).success,
    false,
  );
  assert.equal(
    storeIdentitySchema.safeParse({ socialLinks: [social('instagram', '')] }).success,
    false,
  );
});
test('Enamad accepts official verification and official image only; other license images must be issued media', () => {
  const valid = {
    ...badge('https://trustseal.enamad.ir/?id=123&Code=sample'),
    imageUrl: 'https://trustseal.enamad.ir/logo.aspx?id=123&Code=sample',
  };
  assert.equal(storeIdentitySchema.safeParse({ badges: [valid] }).success, true);
  for (const verificationUrl of [
    'https://trustseal.enamad.ir.evil.test/?id=123',
    'https://evil.test/logo.png',
    'http://trustseal.enamad.ir/',
  ])
    assert.equal(
      storeIdentitySchema.safeParse({ badges: [{ ...valid, verificationUrl }] }).success,
      false,
    );
  assert.equal(
    storeIdentitySchema.safeParse({
      badges: [{ ...valid, imageUrl: 'https://evil.test/fake.png' }],
    }).success,
    false,
  );
  const license = {
    ...badge('https://issuer.example/license/123', 'license'),
    imageUrl: '/media/catalog/' + 'a'.repeat(32) + '/card.webp',
  };
  assert.equal(storeIdentitySchema.safeParse({ badges: [license] }).success, true);
  for (const imageUrl of [
    '/api/credit/private',
    '/products/fake.png',
    'https://issuer.example/badge.png',
  ])
    assert.equal(
      storeIdentitySchema.safeParse({ badges: [{ ...license, imageUrl }] }).success,
      false,
    );
});
test('duplicates, executable badge snippets, display controls, excessive entries and unknown fields fail closed', () => {
  for (const value of [
    {
      socialLinks: [
        social('telegram', 'https://t.me/store'),
        social('telegram', 'https://t.me/store2'),
      ],
    },
    { script: '<script>' },
    { badges: [{ ...badge('https://trustseal.enamad.ir/?id=1'), html: '<script>' }] },
    { badges: [{ ...badge('https://trustseal.enamad.ir/?id=1'), title: '<img>' }] },
    {
      badges: Array.from({ length: 7 }, (_, i) => ({
        ...badge('https://issuer.example/check', 'license'),
        id: String(i),
      })),
    },
    { demonstration: 'true' },
    {
      badges: [
        badge('https://trustseal.enamad.ir/?id=1'),
        { ...badge('https://trustseal.enamad.ir/?id=2'), id: 'another' },
      ],
    },
  ]) {
    assert.equal(storeIdentitySchema.safeParse(value).success, false, JSON.stringify(value));
    assert.deepEqual(visibleStoreIdentity(value), {});
  }
});
test('only safe published-page path shapes can be configured as policy links', () => {
  const policy = { id: 'privacy', title: 'حریم خصوصی', href: '/pages/privacy', enabled: true };
  assert.equal(storeIdentitySchema.safeParse({ policyLinks: [policy] }).success, true);
  for (const href of [
    '//evil.test',
    '/account',
    '/api/admin',
    '/pages/../account',
    '/pages/privacy?draft=1',
    '/support#x',
    'javascript:alert(1)',
  ])
    assert.equal(
      storeIdentitySchema.safeParse({ policyLinks: [{ ...policy, href }] }).success,
      false,
      href,
    );
});
test('local addresses and non-public license destinations are rejected', () => {
  for (const url of [
    'https://127.0.0.1/x',
    'https://2130706433/x',
    'https://localhost/x',
    'https://host.local/x',
    'https://[::1]/x',
  ])
    assert.equal(publicHttpsUrl(url), null, url);
});
test('disabled records disappear from the public view', () => {
  const value = visibleStoreIdentity({
    socialLinks: [social('telegram', 'https://t.me/store'), social('instagram', '', false)],
    badges: [{ ...badge(''), title: '', enabled: false }],
  });
  assert.equal(value.socialLinks?.length, 1);
  assert.equal(value.badges?.length, 0);
});
