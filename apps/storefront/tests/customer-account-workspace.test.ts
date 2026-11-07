import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import { setImmediate } from 'node:timers/promises';
import * as overview from '../lib/account/account-overview.ts';
import * as accountClient from '../lib/account/customer-account-client.ts';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { order2Detail } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
import type { CustomerSession } from '../lib/account/customer-session.ts';
import { uiElements, uiText } from '@sayman/web-shared/testing/digital-ui.test-harness.ts';

const owner = 'a'.repeat(32),
  session: CustomerSession = {
    accessToken: 'synthetic-memory-only-token',
    expiresIn: 300,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: owner, displayName: 'Session name', userName: 'synthetic-user' },
  },
  profile = {
    id: owner,
    userName: 'synthetic-user',
    displayName: 'PARSED-PRIVATE-PROFILE',
    email: 'synthetic@example.test',
    emailConfirmed: false,
    phoneNumber: null,
    phoneNumberConfirmed: false,
    createdAt: '2026-10-30T00:00:00Z',
    passwordEnabled: true,
    twoFactorEnabled: false,
    version: 'synthetic-version',
  },
  orders = {
    schemaVersion: 2,
    items: Array.from({ length: 4 }, (_, index) => ({
      ...order2Detail().summary,
      id: (index + 1).toString().repeat(32),
      reference: 'SM-' + (index + 1),
      payableTotalRial: '9223372036854775807',
    })),
    nextCursor: 'another_page',
  },
  addresses = {
    schemaVersion: 1,
    capacity: 20,
    items: [
      {
        id: 'b'.repeat(32),
        label: 'Synthetic home',
        contactName: 'Synthetic recipient',
        contactPhone: '09123456789',
        delivery: {
          countryCode: 'IR',
          province: 'تهران',
          city: 'تهران',
          address: 'PARSED-PRIVATE-ADDRESS',
          postalCode: '1234567890',
        },
        isDefault: true,
        createdAt: '2026-10-30T00:00:00Z',
        updatedAt: '2026-10-30T00:00:00Z',
        version: 'AAAAAAAAAAE=',
      },
    ],
  };

function normalResponse(path: string) {
  if (path === '/api/account/profile') return Response.json(profile);
  if (path === '/api/orders/v2') return Response.json(orders);
  if (path === '/api/addresses') return Response.json(addresses);
  assert.match(path, /^\/api\/notifications\/(?:phones\/|credit-reminders\/)?unread-count$/);
  return Response.json({ schemaVersion: 1, unreadCount: '9007199254740993' });
}
type Transport = (path: string, init: RequestInit) => Promise<Response>;

// Run the real workspace, effects and its stat/issue components. Hooks and
// transport are deterministic and confined to this file; no browser/SQL calls.
function workspace(
  locale: 'fa' | 'en' = 'en',
  transport: Transport = async (path) => normalResponse(path),
) {
  const slots: unknown[] = [],
    effects = new Map<number, { deps: unknown[]; cleanup: unknown }>(),
    queued: (() => void)[] = [],
    calls: { path: string; init: RequestInit }[] = [],
    focused: string[] = [],
    exactMoney: bigint[] = [];
  let at = 0,
    dirty = true,
    active = true,
    currentOwner = owner,
    revision = 1,
    status = 'member',
    tree: unknown;
  const store = {
    snapshot: () => ({
      status,
      session: status === 'member' ? { user: { id: currentOwner } } : null,
    }),
    viewRevision: () => revision,
    fetch: async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      return transport(path, init);
    },
  };
  const react = {
    useState(initial: unknown) {
      const index = at++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (next: unknown) => {
          if (!active) return;
          slots[index] = typeof next === 'function' ? next(slots[index]) : next;
          dirty = true;
        },
      ];
    },
    useRef(initial: unknown) {
      return (slots[at++] ??= { current: initial });
    },
    useId() {
      return (slots[at++] ??= 'synthetic-workspace');
    },
    useEffect(callback: () => unknown, deps: unknown[]) {
      const index = at++,
        previous = effects.get(index);
      if (
        previous &&
        previous.deps.length === deps.length &&
        deps.every((item, index) => Object.is(item, previous.deps[index]))
      )
        return;
      queued.push(() => {
        if (typeof previous?.cleanup === 'function') previous.cleanup();
        effects.set(index, { deps, cleanup: callback() });
      });
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>): unknown =>
    typeof type === 'function' ? type(props) : { type, props };
  const mocks: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_object, name) => String(name) }),
    '../navigation/localized-link': { __esModule: true, default: 'Link' },
    '../auth/auth-provider': { useCustomerSession: () => ({ store, ...store.snapshot() }) },
    '../navigation/locale-provider': {
      useI18n: () => ({
        locale,
        digits: String,
        t: (text: string) => text,
        toman: (value: bigint) => {
          assert.equal(typeof value, 'bigint');
          exactMoney.push(value);
          return value.toString();
        },
      }),
    },
    '../providers/shop-provider': {
      useShop: () => ({
        wishlist: ['synthetic-product'],
        wishlistStatus: { ready: true, account: true, failed: false },
      }),
    },
    '../shared/ui': { Button: 'Button', groupNavigation() {} },
    './account-settings': { AccountSettings: 'AccountSettings' },
    '@/lib/account/account-overview': overview,
    '@/lib/account/customer-account-client': accountClient,
    '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
    './customer-account-workspace.css': {},
  };
  const compiled = swc.transformSync(
      fs.readFileSync(
        new URL('../components/account/customer-account-workspace.tsx', import.meta.url),
        'utf8',
      ),
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'automatic' } },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ),
    exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled.code, {
    exports,
    require: (name: string) => {
      assert.ok(name in mocks, 'Unexpected workspace import: ' + name);
      return mocks[name];
    },
    AbortController,
    Date,
    Intl,
    setInterval: () => 'synthetic-timer',
    clearInterval() {},
    document: { getElementById: (id: string) => ({ focus: () => focused.push(id) }) },
  });
  const component = exports.CustomerAccountWorkspace as (props: unknown) => unknown;
  function paint() {
    at = 0;
    dirty = false;
    tree = component({
      session,
      busy: false,
      error: '',
      async onLogout() {},
      async onPasswordChanged() {},
    });
    return tree;
  }
  paint();
  return {
    calls,
    focused,
    exactMoney,
    tree: () => tree,
    async settle() {
      for (let turn = 0; turn < 50; turn++) {
        if (dirty) paint();
        while (queued.length) queued.shift()!();
        await setImmediate();
        if (!dirty && queued.length === 0) return;
      }
      assert.fail('Workspace did not settle');
    },
    switchOwner() {
      currentOwner = 'c'.repeat(32);
      revision++;
    },
    signOut() {
      status = 'guest';
      revision++;
    },
    unmount() {
      active = false;
      for (const effect of effects.values())
        if (typeof effect.cleanup === 'function') effect.cleanup();
    },
  };
}

test('actual FA/EN workspace shows bounded recent orders, exact money, unread total and accessible connected settings tabs', async () => {
  for (const locale of ['fa', 'en'] as const) {
    const h = workspace(locale);
    await h.settle();
    const tree = h.tree(),
      nodes = uiElements(tree),
      text = uiText(tree);
    assert.ok(text.includes('PARSED-PRIVATE-PROFILE'));
    assert.ok(text.includes('PARSED-PRIVATE-ADDRESS'));
    assert.ok(text.includes('18014398509481986'));
    assert.ok(text.includes('4+'));
    assert.equal(
      nodes.filter((node) => node.props.className === 'customer-account-order-row').length,
      3,
    );
    assert.ok(h.exactMoney.every((value) => value === 9223372036854775807n));
    assert.ok(
      nodes.some((node) => node.type === 'Link' && node.props.href === '/orders/' + '1'.repeat(32)),
    );
    const tabs = nodes.filter((node) => node.props.role === 'tab');
    assert.equal(tabs.length, 2);
    assert.equal(
      nodes.find((node) => node.props.role === 'tablist')?.props['aria-orientation'],
      'horizontal',
    );
    for (const tab of tabs) {
      assert.equal(tab.props.type, 'button');
      assert.ok(
        nodes.some(
          (node) =>
            node.props.id === tab.props['aria-controls'] &&
            node.props['aria-labelledby'] === tab.props.id,
        ),
      );
    }
    assert.equal(
      nodes.filter((node) => node.props.role === 'tab' && node.props.tabIndex === 0).length,
      1,
    );
    (tabs[1].props.onClick as () => void)();
    await h.settle();
    assert.ok(uiElements(h.tree()).some((node) => node.type === 'AccountSettings'));
    assert.equal(
      uiElements(h.tree()).find(
        (node) => node.props.role === 'tab' && node.props['aria-selected'] === true,
      )?.props.id,
      tabs[1].props.id,
    );
    assert.equal(h.calls.filter((call) => call.path === '/api/orders/v2').length, 1);
    assert.equal(h.calls.filter((call) => call.path === '/api/account/profile').length, 1);
    h.unmount();
  }
});

test('actual workspace keeps unavailable unread counts distinct from zero while other private sections render', async () => {
  const h = workspace('en', async (path) =>
    path === '/api/notifications/credit-reminders/unread-count'
      ? new Response(null, { status: 503 })
      : normalResponse(path),
  );
  await h.settle();
  const tree = h.tree(),
    text = uiText(tree),
    nodes = uiElements(tree);
  assert.ok(text.includes('PARSED-PRIVATE-ADDRESS'));
  assert.ok(text.includes('Unread counts are unavailable.'));
  assert.equal(text.includes('18014398509481986'), false);
  const stat = nodes.find(
    (node) =>
      node.props.className === 'customer-account-stat' &&
      uiText(node).includes('Unread notifications'),
  );
  assert.ok(stat);
  assert.ok(uiText(stat).includes('—Unavailable'));
  assert.ok(
    uiElements(stat).some(
      (node) => node.type === 'button' && typeof node.props.onClick === 'function',
    ),
  );
  h.unmount();
});

test('the account shortcut links to a live reservation and skips expired or paid orders', async () => {
  const future = new Date(Date.now() + 15 * 60_000).toISOString();
  const h = workspace('en', async (path) =>
    path === '/api/orders/v2'
      ? Response.json({
          ...orders,
          items: [
            orders.items[0],
            { ...orders.items[1], state: 'Paid', expiresAt: future },
            { ...orders.items[2], expiresAt: future },
          ],
        })
      : normalResponse(path),
  );
  await h.settle();
  const shortcut = uiElements(h.tree()).find(
    (node) => node.props.className === 'customer-account-resume',
  );
  assert.ok(shortcut);
  assert.ok(uiText(shortcut).includes(orders.items[2].reference));
  assert.equal(
    uiElements(shortcut).find((node) => node.type === 'Link')?.props.href,
    '/orders/' + orders.items[2].id,
  );
  h.unmount();
});

test('actual workspace rejects profile, order and address data parsed after owner changes or unmount', async () => {
  for (const exit of ['owner', 'logout', 'unmount']) {
    const release = Promise.withResolvers<void>();
    const h = workspace('en', async (path) => {
      const original = normalResponse(path),
        bytes = new TextEncoder().encode(await original.text());
      return new Response(
        new ReadableStream({
          start(controller) {
            void release.promise.then(() => {
              controller.enqueue(bytes);
              controller.close();
            });
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    await h.settle();
    assert.equal(h.calls.length, 5);
    if (exit === 'owner') h.switchOwner();
    else if (exit === 'logout') h.signOut();
    else h.unmount();
    release.resolve();
    await h.settle();
    const text = uiText(h.tree());
    assert.equal(text.includes('PARSED-PRIVATE-PROFILE'), false);
    assert.equal(text.includes('PARSED-PRIVATE-ADDRESS'), false);
    assert.equal(
      uiElements(h.tree()).some((node) => node.props.className === 'customer-account-order-row'),
      false,
    );
    if (exit === 'unmount') assert.ok(h.calls.every((call) => call.init.signal?.aborted));
    else h.unmount();
  }
});
