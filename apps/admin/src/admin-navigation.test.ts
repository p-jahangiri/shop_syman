import test from 'node:test';
import assert from 'node:assert/strict';
import { filteredNavigationGroups, navigation, navigationGroups } from './admin-navigation.ts';

test('grouped navigation never exposes a restricted route through search', () => {
  assert.deepEqual(
    filteredNavigationGroups([], '').flatMap((group) => group.items.map((item) => item.id)),
    ['dashboard', 'security'],
  );
  assert.deepEqual(filteredNavigationGroups([], 'مالی'), []);
  assert.ok(
    !filteredNavigationGroups(['finance.read'], '')
      .flatMap((group) => group.items)
      .some((item) => item.id === 'payments'),
  );
  assert.ok(
    filteredNavigationGroups(['finance.read', 'sales.read'], '')
      .flatMap((group) => group.items)
      .some((item) => item.id === 'payments'),
  );
});
test('every management route has one group and no route disappears during redesign', () => {
  const grouped = navigationGroups.flatMap((group) => [...group.pages]);
  assert.equal(new Set(grouped).size, grouped.length);
  assert.deepEqual([...grouped].sort(), navigation.map((item) => item.id).sort());
});
test('Persian and Arabic letters and half-spaces find the same permitted section', () => {
  const permissions = ['catalog.read'];
  const find = (query: string) =>
    filteredNavigationGroups(permissions, query).flatMap((group) =>
      group.items.map((item) => item.id),
    );
  assert.deepEqual(find('كالا'), find('کالا'));
  assert.deepEqual(find('   ويژگی   '), find('ویژگی'));
  assert.deepEqual(find('دسته بندی'), find('دسته‌بندی'));
});
