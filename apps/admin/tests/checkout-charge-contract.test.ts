import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRial, basisPoints, percentInput } from '../src/utils/finance-inputs.ts';
import {
  prepareCharges,
  readChargePolicy,
  sameChargeValues,
  type ChargeDraft,
} from '../src/api/contracts/finance/checkout-charge-contract.ts';

const version = 'AAAAAAAAAAE=';
const draft: ChargeDraft = {
  shippingMode: 'flat',
  shippingNameFa: ' ارسال آزمون ',
  shippingNameEn: 'Fixture delivery',
  shippingDescriptionFa: '',
  shippingDescriptionEn: '',
  fee: '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳',
  threshold: '۱۲٬۳۴۵',
  taxMode: 'inclusive',
  rate: '۹٫۲۵',
  taxBase: 'goods',
  taxRounding: 'half_up',
};

test('financial input keeps exact high rials and does not reinterpret misplaced separators', () => {
  assert.equal(normalizeRial(draft.fee), '9007199254740993');
  assert.equal(normalizeRial('۹۲۲۳۳۷۲۰۳۶۸۵۴۷۷۵۸۰۷'), '9223372036854775807');
  for (const invalid of ['9,25', '۱ ۲', '۱۲٬۰۰', '1,000٬000', '9223372036854775808', '1e6', '۱۰٫۵'])
    assert.throws(() => normalizeRial(invalid));
  assert.equal(basisPoints('١٠٫٠٥', 0, 10000), 1005);
  assert.equal(percentInput(1005), '10.05');
  assert.throws(() => basisPoints('۹,۲۵', 0, 10000));
  assert.throws(() => basisPoints('۱۰٫۰۰۱', 0, 10000));
});

test('charge review keeps server version and removes amounts only when the selected policy cannot use them', () => {
  const input = prepareCharges(draft, version).value!;
  assert.equal(input.shippingFeeRial, '9007199254740993');
  assert.equal(input.shippingFreeFromRial, '12345');
  assert.equal(input.taxRateBasisPoints, 925);
  assert.equal(input.shippingNameFa, 'ارسال آزمون');
  assert.equal(input.version, version);
  const postpaid = prepareCharges(
    { ...draft, shippingMode: 'postpaid', taxMode: 'included_unitemized' },
    version,
  ).value!;
  assert.equal(postpaid.shippingFeeRial, null);
  assert.equal(postpaid.shippingFreeFromRial, null);
  assert.equal(postpaid.taxRateBasisPoints, null);
  assert.equal(readChargePolicy({ ...postpaid, id: 1 }).taxMode, 'included_unitemized');
  assert.throws(() => readChargePolicy({ ...postpaid, id: 1, shippingFeeRial: '5000' }));
  assert.equal(sameChargeValues(postpaid, input), false);
  assert.equal(sameChargeValues(input, { ...input, version: 'AAAAAAAAAAI=' }), true);
});

test('a malformed money value reports the specific field and cannot produce a write candidate', () => {
  const result = prepareCharges({ ...draft, fee: '۲٫۵', rate: '100.01' }, version);
  assert.equal(result.value, null);
  assert.deepEqual(Object.keys(result.errors), ['fee', 'rate']);
});
