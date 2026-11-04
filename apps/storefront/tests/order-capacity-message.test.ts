import assert from 'node:assert/strict';
import test from 'node:test';
import {
  physicalOrderCapacityCode,
  isPhysicalOrderCapacityError,
  physicalOrderCapacityMessage,
  digitalOrderCapacityCode,
  digitalMetadataCapacityCode,
  isDigitalOrderCapacityError,
  isDigitalMetadataCapacityError,
  digitalOrderCapacityMessage,
} from '../lib/orders/order-capacity-message.ts';

test('tracked physical limit decoder accepts only its exact code, independently of digital limits', () => {
  assert.equal(isPhysicalOrderCapacityError({ code: physicalOrderCapacityCode }), true);
  for (const value of [
    null,
    undefined,
    false,
    physicalOrderCapacityCode,
    {},
    { code: physicalOrderCapacityCode + 'x' },
    { code: digitalOrderCapacityCode },
    { code: digitalMetadataCapacityCode },
  ])
    assert.equal(isPhysicalOrderCapacityError(value), false);
  assert.equal(isDigitalOrderCapacityError({ code: physicalOrderCapacityCode }), false);
  assert.equal(isDigitalMetadataCapacityError({ code: physicalOrderCapacityCode }), false);
});
test('both locales explain100 tracked units without incorrectly lowering untracked or digital capacity', () => {
  assert.match(physicalOrderCapacityMessage('fa'), /۱۰۰/);
  assert.match(physicalOrderCapacityMessage('en'), /100/);
  assert.match(physicalOrderCapacityMessage('fa'), /سریال یا IMEI/);
  assert.match(physicalOrderCapacityMessage('en'), /serial number or IMEI/);
  assert.match(physicalOrderCapacityMessage('en'), /separate orders/);
  for (const locale of ['fa', 'en'] as const) {
    assert.doesNotMatch(physicalOrderCapacityMessage(locale), /1024|1,024|۱۰۲۴/);
    assert.notEqual(physicalOrderCapacityMessage(locale), digitalOrderCapacityMessage(locale));
  }
  assert.match(digitalOrderCapacityMessage('en'), /1,024/);
  assert.match(digitalOrderCapacityMessage('en', 'metadata'), /metadata/);
});
