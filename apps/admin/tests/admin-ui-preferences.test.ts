import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultAdminDashboardPreferences,
  moveAdminPreference,
  parseAdminDashboardPreferences,
} from '../src/state/admin-ui-preferences.ts';

test('dashboard preferences retain explicit empty choices and safely restore missing widget definitions', () => {
  assert.deepEqual(
    parseAdminDashboardPreferences(
      '{"order":["inventory","sourcing","inventory","unknown"],"hidden":["purchase","bad"],"shortcuts":[]}',
    ),
    {
      order: ['inventory', 'tickets', 'cheques', 'orders', 'traffic', 'shortcuts'],
      hidden: [],
      shortcuts: [],
      stockLimit: 3,
    },
  );
  assert.deepEqual(parseAdminDashboardPreferences('invalid'), defaultAdminDashboardPreferences());
  assert.equal(parseAdminDashboardPreferences('{"stockLimit":5}').stockLimit, 5);
  assert.equal(parseAdminDashboardPreferences('{"stockLimit":10000}').stockLimit, 3);
});

test('moving a dashboard item changes order without mutating saved preferences', () => {
  const order = ['catalog', 'inventory', 'shortcuts'] as const;
  assert.deepEqual(moveAdminPreference(order, 'shortcuts', -1), [
    'catalog',
    'shortcuts',
    'inventory',
  ]);
  assert.deepEqual(moveAdminPreference(order, 'catalog', -1), order);
  assert.deepEqual(order, ['catalog', 'inventory', 'shortcuts']);
});
