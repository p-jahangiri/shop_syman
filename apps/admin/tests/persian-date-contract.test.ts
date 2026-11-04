import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { format } from 'date-fns-jalali';
import {
  dateFieldValue,
  dateFieldWire,
  persianCivilDate,
} from '../src/utils/persian-date-contract.ts';

test('Persian cheque due-date labels retain the civil day in different device timezones', () => {
  const expected = '۱۱ آبان ۱۴۰۵';
  assert.equal(persianCivilDate('2026-11-02'), expected);
  for (const value of ['', '2026-02-30', '2026-13-01', '0000-01-01', '1405/08/11'])
    assert.equal(persianCivilDate(value), 'تاریخ نامعتبر');
  const source = new URL('../src/utils/persian-date-contract.ts', import.meta.url).href;
  for (const timezone of ['Asia/Tehran', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `import {persianCivilDate} from ${JSON.stringify(source)}; console.log(persianCivilDate('2026-11-02'));`,
      ],
      { encoding: 'utf8', env: { ...process.env, TZ: timezone } },
    );
    assert.equal(child.status, 0, timezone);
    assert.equal(child.stdout.trim(), expected, timezone);
  }
});

test('Jalali calendar shows Nowruz without changing the Gregorian civil wire day', () => {
  const value = dateFieldValue('2026-03-21', 'date');
  assert.ok(value);
  assert.equal(format(value, 'yyyy/MM/dd'), '1405/01/01');
  assert.equal(dateFieldWire(value, 'date'), '2026-03-21');
  assert.equal(format(dateFieldValue('2025-03-20', 'date')!, 'yyyy/MM/dd'), '1403/12/30');
});
test('UTC-wall times round trip exactly while picker uses an instant', () => {
  const value = dateFieldValue('2026-11-01T23:45:06', 'utc');
  assert.equal(value?.toISOString(), '2026-11-01T23:45:06.000Z');
  assert.equal(dateFieldWire(value, 'utc'), '2026-11-01T23:45:06');
  assert.equal(
    dateFieldWire(dateFieldValue('2026-01-01T00:00', 'utc'), 'utc'),
    '2026-01-01T00:00:00',
  );
});
test('local-wall inputs retain their civil time, seconds and midnight', () => {
  for (const value of ['2026-11-01T00:00:00', '2026-03-21T23:59:59'])
    assert.equal(dateFieldWire(dateFieldValue(value, 'local'), 'local'), value);
});
test('invalid dates, overflow, missing timezone conventions and incomplete edits are not valid wire dates', () => {
  for (const value of ['', 'invalid-date', '2026-02-30', '2026-13-01', '0000-01-01', '1405/08/10'])
    assert.equal(dateFieldValue(value, 'date'), null);
  for (const value of [
    '2026-11-01',
    '2026-11-01T25:00:00',
    '2026-11-01T13:00Z',
    '2026-11-01T13:00+03:30',
    '2026-02-30T13:00',
  ])
    assert.equal(dateFieldValue(value, 'utc'), null);
  assert.equal(dateFieldWire(new Date(NaN), 'utc'), '');
  assert.equal(dateFieldWire(null, 'date'), '');
});
