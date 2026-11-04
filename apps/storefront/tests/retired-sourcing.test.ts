import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterRetiredSourcingMenu,
  isRetiredSourcingPath,
} from '@sayman/web-shared/lib/market/retired-sourcing.ts';
import { filterPurchaseMenu } from '../lib/catalog/purchasing.ts';
import type { MenuItem } from '@sayman/web-shared/lib/shared/types.ts';

test('retired pages and browser APIs leave the ordinary catalog, orders and phone category available', () => {
  for (const path of [
    '/market',
    '/en/market/item',
    '/fa/%6darket',
    '/sourcing',
    '/fa/sourcing/1',
    '/en/phone-interests',
    '/api/market/fa/items',
    '/api/phones/fa/search',
    '/api/sourcing/requests',
    '/api/notifications/phones',
    '/api/cart/en/sourcing/submit',
  ])
    assert.equal(isRetiredSourcingPath(path), true, path);
  for (const path of [
    '/fa/catalog',
    '/fa/moments',
    '/api/orders/v2',
    '/api/cart/en/v2',
    '/api/notifications',
    '/fa/marketplace',
  ])
    assert.equal(isRetiredSourcingPath(path), false, path);
});

test('old CMS links disappear from both storefront menus and the admin editor', () => {
  const catalog = { label: 'گوشی', href: '/fa/catalog?category=phones' };
  const menu: MenuItem[] = [
    { label: 'بازار', href: '/market' },
    { label: 'حساب', href: '#', children: [{ label: 'درخواست', href: '/en/sourcing' }] },
    {
      label: 'کالاها',
      href: '/catalog',
      children: [catalog, { label: 'اطلاع', href: '/fa/phone-interests' }],
    },
  ];
  const visible = [{ ...menu[2], children: [catalog] }];
  assert.deepEqual(filterRetiredSourcingMenu(menu), visible);
  assert.deepEqual(filterPurchaseMenu(menu, []), visible);
});
