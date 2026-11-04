import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localizeData,
  localeFormat,
  localeHref,
  stripLocale,
  translate,
} from '../lib/navigation/i18n.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
test('language routes preserve internal query strings and do not alter external or API URLs', () => {
  assert.equal(localeHref('/catalog?category=phones', 'en'), '/en/catalog?category=phones');
  assert.equal(localeHref('/en/catalog?q=a', 'fa'), '/fa/catalog?q=a');
  assert.equal(localeHref('/', 'en'), '/en');
  assert.equal(localeHref('/api/auth', 'en'), '/api/auth');
  assert.equal(localeHref('https://example.com', 'en'), 'https://example.com');
  assert.equal(stripLocale('/en/account'), '/account');
});
test('English snapshot translates commercial content without changing identifiers or money', () => {
  const en = localizeData(storefrontSnapshot, 'en');
  assert.equal(en.products[0].id, storefrontSnapshot.products[0].id);
  assert.equal(
    en.products[0].variants[0].priceRial,
    storefrontSnapshot.products[0].variants[0].priceRial,
  );
  assert.equal(en.products[0].name, 'Apple iPhone 16');
  assert.equal(en.categories[0].name, 'Phones');
  assert.equal(/[\u0600-\u06ff]/.test(JSON.stringify(en)), false);
});
test('number formatting stays exact and template variables survive translation', () => {
  assert.equal(localeFormat('en').toman(1234567890n), '123,456,789');
  assert.equal(localeFormat('fa').toman(1234567890n), '۱۲۳٬۴۵۶٬۷۸۹');
  assert.equal(translate('مقایسه: {0}', 'en', ['Phone']), 'Compare: Phone');
  assert.equal(translate('عنوان', 'fa'), 'عنوان');
});
