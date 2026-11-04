import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as geography from '../lib/address/address-geography.ts';
import * as contract from '../lib/address/address-contract.ts';

function editor(
  disabled = false,
  value: contract.SavedAddress | null = null,
  locale: 'fa' | 'en' = 'fa',
) {
  const saved: contract.SaveAddressInput[] = [];
  const h = digitalUiHarness(
    'apps/storefront/components/address/address-editor.tsx',
    {
      'next/dynamic': () => 'map-component',
      '../shared/ui': { Button: 'button' },
      '@/lib/address/address-contract': contract,
      '@/lib/address/address-geography': geography,
      './address-map.css': {},
    },
    { requestAnimationFrame: (f: () => void) => f() },
  );
  const props = {
    locale,
    value,
    disabled,
    onSave: (v: contract.SaveAddressInput) => saved.push(v),
    onCancel() {},
  };
  h.mount('AddressEditor', props);
  function field(id: string) {
    const node = uiElements(h.tree()).find((e) => e.props.id === 'address-' + id);
    assert.ok(node, id);
    return node;
  }
  function change(id: string, value: string) {
    (field(id).props.onChange as (e: unknown) => void)({ target: { value } });
    h.rerender();
  }
  function submit() {
    const f = uiElements(h.tree()).find((e) => e.type === 'form')!;
    (f.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
    h.rerender();
  }
  function button(name: RegExp) {
    const node = uiElements(h.tree()).find(
      (item) => item.type === 'button' && name.test(uiText(item)),
    );
    assert.ok(node, String(name));
    return node;
  }
  function toggleMap() {
    const node = button(
      /انتخاب از روی نقشه|مشاهده و تغییر نقطه|بستن نقشه|Choose on map|View or edit point|Close map/,
    );
    (node.props.onClick as () => void)();
    h.rerender();
  }
  function editArea() {
    const node = button(/ویرایش محدوده|Edit area/);
    (node.props.onClick as () => void)();
    h.rerender();
  }
  const hasField = (id: string) =>
    uiElements(h.tree()).some((item) => item.props.id === 'address-' + id);
  function summary() {
    const node = uiElements(h.tree()).find(
      (item) => item.props.className === 'address-confirmed-location',
    );
    assert.ok(node, 'Expected persistent entered-address summary');
    return node;
  }
  function map() {
    const node = uiElements(h.tree()).find((item) => item.type === 'map-component');
    assert.ok(node, 'Expected explicitly opened map');
    return node;
  }
  return {
    h,
    props,
    field,
    hasField,
    change,
    submit,
    saved,
    button,
    toggleMap,
    editArea,
    summary,
    map,
  };
}
test('real address editor clears county city and map point when parent changes; dependent options never cross provinces', async () => {
  const e = editor();
  await e.h.settle();
  assert.equal(e.field('countyId').props.disabled, true);
  assert.equal(e.field('cityId').props.disabled, true);
  e.change('provinceId', '123');
  e.change('countyId', '1230001');
  e.change('cityId', '1230001001576');
  const cityOptions = uiElements(e.field('cityId')).filter(
    (v) => v.type === 'option' && v.props.value,
  );
  assert.ok(cityOptions.length > 0);
  for (const v of cityOptions)
    assert.equal(geography.findCity(String(v.props.value))?.countyId, '1230001');
  e.change('provinceId', '100');
  assert.equal(e.field('countyId').props.value, '');
  assert.equal(e.field('cityId').props.value, '');
  const countyOptions = uiElements(e.field('countyId')).filter(
    (v) => v.type === 'option' && v.props.value,
  );
  for (const v of countyOptions)
    assert.equal(geography.findCounty(String(v.props.value))?.provinceId, '100');
  e.submit();
  assert.equal(e.saved.length, 0);
  assert.ok(uiText(e.h.tree()).includes('فیلدهای مشخص‌شده'));
  e.h.unmount();
});
test('real editor shows precise field errors, submits canonical digits and keeps optional map point across close/open', async () => {
  const e = editor();
  await e.h.settle();
  e.submit();
  assert.equal(e.field('contactPhone').props['aria-invalid'], true);
  for (const [id, v] of Object.entries({
    label: 'خانه',
    contactName: 'گیرندهٔ نمونه',
    contactPhone: '+۹۸۹۱۲۱۲۳۴۵۶۷',
    provinceId: '123',
    countyId: '1230001',
    cityId: '1230001001576',
    address: 'خیابان و کوچهٔ نمونهٔ آزمون',
    plaque: '۱۲',
    unit: '۲',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
  }))
    e.change(id, v);
  const open = () => e.button(/انتخاب از روی نقشه|مشاهده و تغییر نقطه|بستن نقشه/);
  assert.equal(
    uiElements(e.h.tree()).some((v) => v.type === 'map-component'),
    false,
  );
  (open().props.onClick as () => void)();
  e.h.rerender();
  const map = uiElements(e.h.tree()).find((v) => v.type === 'map-component')!;
  (map.props.onChange as (v: [number, number]) => void)([35.6892, 51.389]);
  e.h.rerender();
  (open().props.onClick as () => void)();
  e.h.rerender();
  e.submit();
  assert.equal(e.saved.length, 1);
  assert.equal(e.saved[0].contactPhone, '09121234567');
  assert.equal(e.saved[0].details.plaque, '12');
  assert.equal(e.saved[0].details.latitude, 35.6892);
  assert.equal(e.saved[0].delivery.province, 'تهران');
  e.h.rerender({ ...e.props, disabled: true });
  e.submit();
  assert.equal(e.saved.length, 1);
  e.h.unmount();
});
test('legacy addresses remain editable without guessing ambiguous geography; manual locality is explicit', async () => {
  const legacy = {
    id: 'a'.repeat(32),
    label: 'قدیمی',
    contactName: 'گیرندهٔ قدیمی',
    contactPhone: '09121234567',
    delivery: {
      countryCode: 'IR' as const,
      province: 'تهران',
      city: 'محل تازه',
      address: 'نشانی قدیمی در یک روستای نمونه',
      postalCode: '1234567890',
    },
    isDefault: true,
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    version: 'AAAAAAAAAAE=',
  };
  const e = editor(false, legacy);
  await e.h.settle();
  assert.equal(e.field('provinceId').props.value, '123');
  assert.equal(e.field('countyId').props.value, '');
  assert.equal(e.field('city').props.value, 'محل تازه');
  assert.ok(uiText(e.h.tree()).includes('تأیید نشده'));
  e.change('countyId', '1230001');
  e.change('city', 'روستای نمونه');
  e.change('plaque', 'بدون پلاک');
  e.submit();
  assert.equal(e.saved.length, 1);
  assert.equal(e.saved[0].details.cityId, null);
  assert.equal(e.saved[0].details.localityKind, 'other');
  assert.equal(e.saved[0].version, legacy.version);
  assert.equal(e.saved[0].details.latitude, null);
  e.h.unmount();
});
test('corrected location selections and manual locality clear their visible errors without a second submit', async () => {
  const e = editor();
  await e.h.settle();
  e.submit();
  for (const id of ['provinceId', 'countyId', 'cityId'])
    assert.equal(e.field(id).props['aria-invalid'], true);
  e.change('provinceId', '123');
  assert.equal(e.field('provinceId').props['aria-invalid'], false);
  assert.equal(e.field('countyId').props['aria-invalid'], true);
  e.change('countyId', '1230001');
  assert.equal(e.field('countyId').props['aria-invalid'], false);
  assert.equal(e.field('cityId').props['aria-invalid'], true);
  e.change('cityId', '1230001001576');
  assert.equal(e.field('cityId').props['aria-invalid'], false);
  for (const [id, value] of Object.entries({
    label: 'خانه',
    contactName: 'گیرندهٔ نمونه',
    contactPhone: '09121234567',
    address: 'خیابان و کوچهٔ نمونهٔ آزمون',
    plaque: '۱۲',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
  }))
    e.change(id, value);
  // delivery.province/city errors must not remain hidden in the summary after
  // their corresponding selectors have been corrected.
  assert.equal(uiText(e.h.tree()).includes('فیلدهای مشخص‌شده'), false);
  assert.equal(e.saved.length, 0);
  const manual = uiElements(e.h.tree()).find(
    (v) => v.type === 'button' && uiText(v).includes('روستا یا محل من'),
  )!;
  (manual.props.onClick as () => void)();
  e.h.rerender();
  e.submit();
  assert.equal(e.field('city').props['aria-invalid'], true);
  e.change('city', 'روستای نمونه');
  assert.equal(e.field('city').props['aria-invalid'], false);
  assert.equal(uiText(e.h.tree()).includes('فیلدهای مشخص‌شده'), false);
  assert.equal(e.saved.length, 0);
  e.h.unmount();
});

test('map search confirmation applies canonical locality and point together while preserving typed delivery details', async () => {
  const { searchAddressLocations } = await import('../lib/address/address-location-search.ts');
  const area = searchAddressLocations('کاشان').find((v) => v.kind === 'city')!;
  assert.ok(area.cityId);
  const e = editor();
  await e.h.settle();
  for (const [id, value] of Object.entries({
    label: 'خانه',
    contactName: 'گیرندهٔ آزمون',
    contactPhone: '09121234567',
    address: 'خیابان نمونه و کوچهٔ واردشده توسط مشتری',
    plaque: '۱۲',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
  }))
    e.change(id, value);
  const open = e.button(/انتخاب از روی نقشه|مشاهده و تغییر نقطه|بستن نقشه/);
  (open.props.onClick as () => void)();
  e.h.rerender();
  const map = uiElements(e.h.tree()).find((v) => v.type === 'map-component')!;
  assert.equal(map.props.presentation, 'compact');
  // Opening and closing/manual entry have no persistence side effect.
  (map.props.onManual as () => void)();
  assert.equal(e.field('provinceId').props.value, '');
  assert.equal(e.saved.length, 0);
  (map.props.onChange as (point: [number, number], area: unknown) => void)([34.01, 51.42], area);
  e.h.rerender();
  e.editArea();
  assert.equal(e.field('provinceId').props.value, area.provinceId);
  assert.equal(e.field('countyId').props.value, area.countyId);
  assert.equal(e.field('cityId').props.value, area.cityId);
  assert.equal(e.field('address').props.value, 'خیابان نمونه و کوچهٔ واردشده توسط مشتری');
  assert.equal(e.saved.length, 0);
  e.submit();
  assert.equal(e.saved.length, 1);
  assert.equal(e.saved[0].details.cityId, area.cityId);
  assert.equal(e.saved[0].details.latitude, 34.01);
  e.change('cityId', '');
  assert.equal(
    uiElements(e.h.tree()).some((v) => v.type === 'map-component'),
    false,
  );
  e.h.unmount();
});

test('a saved point does not mount external map preview until explicit consent; disabled callbacks cannot change locality', async () => {
  const { searchAddressLocations } = await import('../lib/address/address-location-search.ts');
  const area = searchAddressLocations('تهران').find((v) => v.kind === 'city')!;
  const saved: contract.SavedAddress = {
    id: 'a'.repeat(32),
    label: 'خانه',
    contactName: 'گیرندهٔ آزمون',
    contactPhone: '09121234567',
    delivery: {
      countryCode: 'IR',
      province: area.provinceName,
      city: area.cityName!,
      address: 'خیابان و کوچهٔ ثبت‌شدهٔ مشتری',
      postalCode: '1234567890',
    },
    details: {
      geographyVersion: geography.geographyVersion,
      provinceId: area.provinceId,
      countyId: area.countyId,
      cityId: area.cityId,
      localityKind: 'city',
      plaque: '12',
      unit: '',
      latitude: 35.69,
      longitude: 51.4,
    },
    isDefault: true,
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    version: 'AAAAAAAAAAE=',
  };
  const e = editor(false, saved);
  await e.h.settle();
  assert.equal(
    uiElements(e.h.tree()).some((v) => v.type === 'map-component'),
    false,
  );
  const open = e.button(/انتخاب از روی نقشه|مشاهده و تغییر نقطه|بستن نقشه/);
  (open.props.onClick as () => void)();
  e.h.rerender();
  e.editArea();
  e.h.rerender({ ...e.props, disabled: true });
  const map = uiElements(e.h.tree()).find((v) => v.type === 'map-component')!;
  const other = searchAddressLocations('کاشان').find((v) => v.kind === 'city')!;
  (map.props.onChange as (point: [number, number], area: unknown) => void)([34.01, 51.42], other);
  e.h.rerender();
  assert.equal(e.field('cityId').props.value, area.cityId);
  assert.equal(e.saved.length, 0);
  e.h.unmount();
});

for (const locale of ['fa', 'en'] as const)
  test(`entered ${locale} address remains visible after confirming and closing the map; area editing preserves the selected point`, async () => {
    const { searchAddressLocations } = await import('../lib/address/address-location-search.ts');
    const area = searchAddressLocations('تجریش').find((item) => item.kind === 'city');
    assert.ok(area?.cityId);
    const e = editor(false, null, locale);
    await e.h.settle();
    const street = 'خیابان واردشده توسط مشتری، کوچهٔ آزمون';
    for (const [id, value] of Object.entries({
      label: 'خانه',
      contactName: 'گیرندهٔ نمونه',
      contactPhone: '09121234567',
      provinceId: area.provinceId,
      countyId: area.countyId,
      cityId: area.cityId,
      address: street,
      plaque: '۱۲',
      unit: '۲',
      postalCode: '۱۲۳۴۵۶۷۸۹۰',
    }))
      e.change(id, value);
    assert.equal(
      e.hasField('provinceId'),
      true,
      'Manual entry keeps area controls available without a point',
    );
    assert.match(uiText(e.summary()), /تهران/);
    assert.match(uiText(e.summary()), /شمیرانات/);
    assert.match(uiText(e.summary()), /تجریش/);
    assert.ok(uiText(e.summary()).includes(street));
    assert.doesNotMatch(uiText(e.h.tree()), /OpenStreetMap|OSM|کاشی‌های|سرویس بیرونی/);
    assert.equal(
      uiElements(e.h.tree()).some((item) => item.type === 'map-component'),
      false,
    );
    e.toggleMap();
    const map = e.map();
    assert.equal(map.props.presentation, 'compact');
    const point: [number, number] = [35.812345, 51.512345];
    (map.props.onChange as (point: [number, number]) => void)(point);
    e.h.rerender();
    for (const id of ['provinceId', 'countyId', 'cityId']) assert.equal(e.hasField(id), false);
    assert.equal(
      uiElements(e.h.tree()).some((item) => item.props.id === 'address-area-controls'),
      false,
    );
    assert.equal(
      e.button(/ویرایش محدوده|Edit area/).props['aria-controls'],
      'address-area-controls',
    );
    const entered = uiElements(e.summary()).find(
      (item) => item.props.className === 'address-confirmed-location-address',
    );
    assert.ok(entered);
    assert.ok(uiText(entered).includes(street));
    assert.match(uiText(entered), /۱۲/);
    assert.equal(e.saved.length, 0, 'Confirming a point does not save an address');
    e.toggleMap();
    assert.equal(
      uiElements(e.h.tree()).some((item) => item.type === 'map-component'),
      false,
    );
    assert.ok(
      uiText(e.summary()).includes(street),
      'The address card is independent of map visibility',
    );
    assert.equal(
      e.summary().props['aria-label'],
      locale === 'fa' ? 'نشانی واردشده' : 'Entered address',
    );
    e.editArea();
    assert.equal(e.field('provinceId').props.value, area.provinceId);
    assert.equal(e.field('countyId').props.value, area.countyId);
    assert.equal(e.field('cityId').props.value, area.cityId);
    assert.equal(e.field('address').props.value, street);
    e.toggleMap();
    assert.deepEqual(
      e.map().props.point,
      point,
      'Opening area editing does not clear the delivery point',
    );
    e.submit();
    assert.equal(e.saved.length, 1);
    assert.equal(e.saved[0].delivery.address, street);
    assert.equal(e.saved[0].details.latitude, point[0]);
    assert.equal(e.saved[0].details.longitude, point[1]);
    assert.equal(e.saved[0].details.plaque, '12');
    e.h.unmount();
  });

test('a free map point leaves unknown area fields visible and manual completion still requires street plaque and postal code', async () => {
  const e = editor();
  await e.h.settle();
  e.toggleMap();
  const map = e.map();
  (map.props.onChange as (point: [number, number]) => void)([35.81, 51.51]);
  e.h.rerender();
  for (const id of ['provinceId', 'countyId', 'cityId']) assert.equal(e.field(id).props.value, '');
  assert.equal(e.field('address').props.value, '', 'A coordinate must not invent a street address');
  assert.equal(
    uiElements(e.h.tree()).some((item) => item.props.className === 'address-confirmed-location'),
    false,
  );
  (map.props.onManual as () => void)();
  e.h.rerender();
  assert.equal(e.hasField('provinceId'), true);
  e.submit();
  assert.equal(e.saved.length, 0);
  assert.equal(e.field('provinceId').props['aria-invalid'], true);
  assert.equal(e.field('address').props['aria-invalid'], true);
  for (const [id, value] of Object.entries({
    label: 'خانه',
    contactName: 'گیرندهٔ نمونه',
    contactPhone: '09121234567',
    provinceId: '123',
    countyId: '1230001',
    cityId: '1230001001576',
  }))
    e.change(id, value);
  e.submit();
  assert.equal(e.saved.length, 0);
  for (const id of ['address', 'plaque', 'postalCode'])
    assert.equal(e.field(id).props['aria-invalid'], true);
  assert.match(uiText(e.summary()), /خیابان و جزئیات ساختمان هنوز وارد نشده است/);
  for (const [id, value] of Object.entries({
    address: 'خیابان و کوچهٔ ثبت‌شده به صورت دستی',
    plaque: '۱۲',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
  }))
    e.change(id, value);
  e.submit();
  assert.equal(e.saved.length, 1);
  assert.equal(e.saved[0].delivery.address, 'خیابان و کوچهٔ ثبت‌شده به صورت دستی');
  assert.equal(
    e.saved[0].details.latitude,
    null,
    'Completing manual geography intentionally clears the earlier optional point',
  );
  assert.equal(e.saved[0].details.longitude, null);
  e.h.unmount();
});

test('manual address text is shown literally and a valid manual area gets a card without opening external tiles', async () => {
  const e = editor();
  await e.h.settle();
  for (const [id, value] of Object.entries({
    provinceId: '123',
    countyId: '1230001',
    cityId: '1230001001576',
    address: '<b>خیابان واردشده توسط کاربر</b>',
    plaque: '۱۲',
  }))
    e.change(id, value);
  const paragraph = uiElements(e.summary()).find(
    (item) => item.props.className === 'address-confirmed-location-address',
  );
  assert.ok(paragraph);
  assert.ok(uiText(paragraph).includes('<b>خیابان واردشده توسط کاربر</b>'));
  assert.equal(paragraph.props.dangerouslySetInnerHTML, undefined);
  assert.equal(
    e.hasField('provinceId'),
    true,
    'Without a point the manual area remains directly editable',
  );
  assert.equal(
    uiElements(e.h.tree()).some((item) => item.type === 'map-component'),
    false,
  );
  assert.doesNotMatch(uiText(e.h.tree()), /OpenStreetMap|OSM|کاشی‌های|سرویس بیرونی/);
  assert.equal(e.saved.length, 0);
  e.h.unmount();
});
