import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogPriceRange } from '../lib/catalog/catalog-filter-state.ts';
import {
  CATALOG_PRICE_SLIDER_STEPS,
  catalogPriceAtPosition,
  catalogPriceDomain,
  catalogPriceForThumb,
  catalogPriceInput,
  catalogPricePosition,
} from '../lib/catalog/catalog-price-range.ts';

test('price domains distinguish empty facets from zero or a single supported price', () => {
  assert.equal(catalogPriceDomain(undefined, undefined), undefined);
  assert.deepEqual(catalogPriceDomain(undefined, '0'), { minRial: 0n, maxRial: 0n });
  assert.deepEqual(catalogPriceDomain('11', '11'), { minRial: 11n, maxRial: 11n });
  assert.deepEqual(catalogPriceDomain(undefined, '100'), { minRial: 0n, maxRial: 100n });
  for (const [min, max] of [
    ['2', '1'],
    ['-1', '10'],
    ['1', 'invalid'],
    ['0', '9223372036854775808'],
  ]) {
    assert.equal(catalogPriceDomain(min, max), undefined);
  }
});

test('slider endpoints preserve the final rial at the Int64 boundary', () => {
  const domain = catalogPriceDomain('1', '9223372036854775807')!;
  assert.equal(catalogPricePosition('1', domain), 0);
  assert.equal(catalogPricePosition('9223372036854775807', domain), CATALOG_PRICE_SLIDER_STEPS);
  assert.equal(catalogPriceAtPosition(0, domain), '1');
  assert.equal(catalogPriceAtPosition(CATALOG_PRICE_SLIDER_STEPS, domain), '9223372036854775807');
  assert.equal(
    catalogPriceAtPosition(CATALOG_PRICE_SLIDER_STEPS / 2, domain),
    '4611686018427387904',
  );
});

test('slider mapping clamps out-of-domain values and handles a collapsed domain without division by zero', () => {
  const domain = catalogPriceDomain('15', '1015')!;
  assert.equal(catalogPricePosition('0', domain), 0);
  assert.equal(catalogPricePosition('9223372036854775807', domain), CATALOG_PRICE_SLIDER_STEPS);
  assert.equal(catalogPriceAtPosition(-100, domain), '15');
  assert.equal(catalogPriceAtPosition(2000, domain), '1015');
  for (const value of [0, 500, 1000])
    assert.equal(catalogPriceAtPosition(value, catalogPriceDomain('11', '11')!), '11');
  assert.equal(catalogPricePosition('11', catalogPriceDomain('11', '11')!), 0);
  for (const position of [NaN, Infinity, -Infinity])
    assert.throws(() => catalogPriceAtPosition(position, domain), RangeError);
});

test('thumbs cannot cross an exact typed bound that shares their rounded slider position', () => {
  const domain = catalogPriceDomain('0', '100000')!;
  assert.equal(catalogPricePosition('49999', domain), 500);
  assert.equal(catalogPricePosition('50001', domain), 500);
  assert.equal(catalogPriceForThumb(500, domain, 'min', '49999'), '49999');
  assert.equal(catalogPriceForThumb(500, domain, 'max', '50001'), '50001');
  assert.equal(catalogPriceForThumb(800, domain, 'min', '49999'), '49999');
  assert.equal(catalogPriceForThumb(200, domain, 'max', '50001'), '50001');
});

test('only an actual domain endpoint clears a thumb, including opposite prices outside the slider domain', () => {
  const domain = catalogPriceDomain('0', '100000')!;
  assert.equal(catalogPriceForThumb(0, domain, 'min', '0'), undefined);
  assert.equal(catalogPriceForThumb(1000, domain, 'max', '0'), undefined);
  assert.equal(catalogPriceForThumb(500, domain, 'min'), '50000');
  assert.equal(catalogPriceForThumb(500, domain, 'max'), '50000');
  assert.equal(catalogPriceForThumb(1000, domain, 'max', '100001'), '100001');
  assert.equal(
    catalogPriceForThumb(500, domain, 'max', '9223372036854775807'),
    '9223372036854775807',
  );
});

test('mapping stays monotonic and returns exact integer rials for every slider position', () => {
  for (const domain of [
    catalogPriceDomain('0', '1')!,
    catalogPriceDomain('11', '99')!,
    catalogPriceDomain('900719925474099399', '9223372036854775807')!,
  ]) {
    let last = domain.minRial;
    for (let position = 0; position <= CATALOG_PRICE_SLIDER_STEPS; position++) {
      const amount = BigInt(catalogPriceAtPosition(position, domain));
      assert.ok(amount >= last && amount >= domain.minRial && amount <= domain.maxRial);
      const shownPosition = catalogPricePosition(amount, domain);
      assert.ok(shownPosition >= 0 && shownPosition <= CATALOG_PRICE_SLIDER_STEPS);
      last = amount;
    }
  }
});

test('localized stacked price fields round trip grouping and fractional toman exactly', () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const rial of ['0', '1', '9', '11', '900719925474099399', '9223372036854775807']) {
      const input = catalogPriceInput(rial, locale);
      assert.deepEqual(parseCatalogPriceRange(input, input), {
        ok: true,
        value: { minPriceRial: rial, maxPriceRial: rial },
      });
    }
  }
  assert.equal(catalogPriceInput('123456', 'fa'), '۱۲٬۳۴۵٫۶');
  assert.equal(catalogPriceInput('123456', 'en'), '12,345.6');
});

test('displaying a slider position does not round an exact manually entered bound', () => {
  const domain = catalogPriceDomain('0', '9223372036854775807')!;
  const typed = parseCatalogPriceRange('90071992547409939.9', '922337203685477580.7');
  assert.ok(typed.ok);
  const original = { ...typed.value };
  catalogPricePosition(typed.value.minPriceRial!, domain);
  catalogPricePosition(typed.value.maxPriceRial!, domain);
  assert.deepEqual(typed.value, original);
  assert.equal(typed.value.minPriceRial, '900719925474099399');
});
