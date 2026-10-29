import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminListMatches,
  compareAdminListValues,
  normalizeAdminListText,
} from './admin-list-text.ts';
test('Persian and Arabic spelling, marks, digits and half-spaces share list search', () => {
  assert.equal(normalizeAdminListText('  كارمَند‌ ۱۲۸  '), 'کارمند 128');
  assert.equal(adminListMatches(['گوشی سامسونگ', '128GB', 'فعال'], 'سامسونگ ۱۲۸'), true);
  assert.equal(adminListMatches(['دسته‌بندی', 'برند'], 'دسته بندی'), true);
  assert.equal(adminListMatches(['گوشی', '128GB'], 'ناموجود'), false);
});
test('sorting integer text above JavaScript safe range preserves the exact order', () => {
  assert.ok(compareAdminListValues('9007199254740993', '9007199254740992') > 0);
  assert.ok(compareAdminListValues('۱۲۸', '64') > 0);
  assert.equal(adminListMatches([null, { private: 'never searchable' }, true], 'private'), false);
});
