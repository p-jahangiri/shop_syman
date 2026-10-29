import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedAdminPage, canAccessAdminPage } from './admin-page-access.ts';
test('payment history requires both financial and sales read permissions across sidebar and current-page fallback', () => {
  const page = { id: 'payments', permission: 'finance.read', requiredPermissions: ['sales.read'] },
    navigation = [{ id: 'dashboard' }, page];
  for (const permissions of [[], ['finance.read'], ['sales.read']]) {
    assert.equal(canAccessAdminPage(page, permissions), false);
    assert.equal(allowedAdminPage('payments', navigation, permissions, 'dashboard'), 'dashboard');
  }
  assert.equal(canAccessAdminPage(page, ['finance.read', 'sales.read']), true);
  assert.equal(
    allowedAdminPage('payments', navigation, ['finance.read', 'sales.read'], 'dashboard'),
    'payments',
  );
});
