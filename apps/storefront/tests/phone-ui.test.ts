import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import { webcrypto } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import * as phoneClient from '../lib/market/phone-interest-client.ts';
import * as phoneContract from '@sayman/web-shared/lib/market/phone-discovery-contract.ts';
import * as offerContract from '@sayman/web-shared/lib/market/offer-contract.ts';
import * as offerInteraction from '../lib/market/offer-interaction.ts';
import * as sourcingJournal from '../lib/market/sourcing-journal.ts';
import { CartError } from '../lib/checkout/cart-client.ts';
import { requestCartV2 } from '../lib/checkout/cart-v2-client.ts';
import { cart2Snapshot } from './cart-v2.test-fixtures.ts';
import { cartReviewCapabilities } from '../lib/checkout/cart-review-capabilities.ts';
import * as cartContract from '../lib/checkout/cart-v2-contract.ts';
import * as savedShop from '../lib/wishlist/saved-shop.ts';
import { localeHref } from '../lib/navigation/i18n.ts';
import { bindRealtimeTransport } from '@sayman/web-shared/lib/notifications/private-realtime-client.ts';
import { RealtimeRefreshGate } from '@sayman/web-shared/lib/notifications/realtime-refresh.ts';
import {
  phoneTestCommand as commandFixture,
  phoneTestPage as page,
  phoneTestResult as result,
  phoneTestOwner as owner,
  phoneTestOtherId as other,
} from './phone-discovery.test-fixtures.ts';
import {
  offerTestPage,
  offerTestDetail,
  offerTestEvents,
  offerTestRequest,
  offerTestId,
  offerTestVersion,
} from '@sayman/web-shared/testing/offer.test-fixtures.ts';

// Actual TSX handlers are compiled in memory. Hooks, clocks and transport are
// deterministic substitutes confined to these tests; no browser or data writes.
type Element = {
  type: unknown;
  props: Record<string, unknown> & {
    onClick: (...args: unknown[]) => unknown;
    onChange: (event: unknown) => unknown;
  };
};
function callComponent<T>(component: unknown, props: unknown): T {
  assert.equal(typeof component, 'function');
  return (component as (props: unknown) => T)(props);
}
function shopValue(tree: Element) {
  assert.ok(tree.props.value && typeof tree.props.value === 'object');
  return tree.props.value as Record<string, unknown>;
}

const text = (v: unknown): string =>
  v == null || v === false
    ? ''
    : Array.isArray(v)
      ? v.map(text).join('')
      : typeof v !== 'object'
        ? String(v)
        : text((v as Element).props?.children);
function elements(v: unknown): Element[] {
  if (!v || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.flatMap(elements);
  const element = v as Element;
  return element.props ? [element, ...elements(element.props.children)] : [];
}
const button = (tree: Element, label: string) => {
  const v = elements(tree).find(
    (v) => ['button', 'Button'].includes(String(v.type)) && text(v).includes(label),
  );
  assert.ok(v, 'Missing button: ' + label);
  return v;
};
const flush = async () => {
  for (let n = 0; n < 6; n++) await setImmediate();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

function hooks() {
  const values: unknown[] = [],
    dependencies = new Map<number, unknown[] | undefined>(),
    cleanups = new Map<number, unknown>(),
    queue: (() => void)[] = [],
    timers = new Map<number, () => void>();
  let at = 0,
    timer = 0;
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const react = {
    useState(initial: unknown) {
      const i = at++;
      if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [
        values[i],
        (next: unknown) => {
          values[i] = typeof next === 'function' ? next(values[i]) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const i = at++;
      return (values[i] ??= { current: initial });
    },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const i = at++;
      if (!(i in values) || !same(dependencies.get(i), deps)) {
        values[i] = fn();
        dependencies.set(i, [...deps]);
      }
      return values[i];
    },
    useCallback(fn: unknown, deps: unknown[]) {
      const i = at++;
      if (!(i in values) || !same(dependencies.get(i), deps)) {
        values[i] = fn;
        dependencies.set(i, [...deps]);
      }
      return values[i];
    },
    useEffect(fn: () => unknown, deps?: unknown[]) {
      const i = at++;
      if (!same(dependencies.get(i), deps)) {
        dependencies.set(i, deps ? [...deps] : undefined);
        queue.push(() => {
          const cleanup = cleanups.get(i);
          if (typeof cleanup === 'function') cleanup();
          cleanups.set(i, fn());
        });
      }
    },
    useTransition() {
      return [false, (fn: () => void) => fn()];
    },
    isValidElement(v: unknown) {
      return !!v && typeof v === 'object' && 'props' in v;
    },
    useSyncExternalStore(_s: unknown, get: () => unknown) {
      return get();
    },
  };
  const schedule = (fn: () => void) => {
    const id = ++timer;
    timers.set(id, fn);
    return id;
  };
  return {
    react,
    schedule,
    cancel: (id: number) => timers.delete(id),
    tick() {
      const ready = [...timers];
      timers.clear();
      for (const [, fn] of ready) fn();
    },
    render<T>(component: unknown, props: unknown) {
      at = 0;
      const value = callComponent<T>(component, props);
      while (queue.length) queue.shift()!();
      return value;
    },
    dispose() {
      for (const cleanup of cleanups.values()) if (typeof cleanup === 'function') cleanup();
      timers.clear();
    },
    timers,
  };
}
type Hooks = ReturnType<typeof hooks>;
const icons = new Proxy({}, { get: (_target, name) => String(name) }),
  i18n = { useI18n: () => ({ locale: 'fa', digits: (v: unknown) => String(v) }) };
function compile(
  file: string,
  h: Hooks,
  mocks: Record<string, unknown>,
  extra = '',
  globals: Record<string, unknown> = {},
) {
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    source =
      fs.readFileSync(
        new URL(import.meta.resolve(file.startsWith('@') ? file : '../components/' + file)),
        'utf8',
      ) + extra,
    code = swc.transformSync(source, {
      filename: file,
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        target: 'es2022',
        transform: { react: { runtime: 'automatic' } },
      },
      module: { type: 'commonjs' },
    }).code,
    exported: Record<string, unknown> = {};
  const all: Record<string, unknown> = {
    react: h.react,
    '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': icons,
    '../navigation/locale-provider': i18n,
    '../navigation/localized-link': { default: 'Link' },
    '../media/content-image': { default: 'Image' },
    '../shared/ui': { Button: 'Button' },
    ...mocks,
  };
  vm.runInNewContext(code, {
    exports: exported,
    require: (name: string) => {
      if (name.endsWith('.css')) return {};
      assert.ok(name in all, 'Unexpected module ' + name);
      return all[name];
    },
    crypto: webcrypto,
    structuredClone,
    AbortController,
    URLSearchParams,
    Date,
    Intl,
    setTimeout: h.schedule,
    clearTimeout: h.cancel,
    setInterval: h.schedule,
    clearInterval: h.cancel,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    ...globals,
  });
  return exported;
}

test('actual phone action never sends a different pending selection on a normal click; receipt404 requires explicit exact resend', async () => {
  const h = hooks(),
    c = structuredClone(commandFixture) as phoneClient.PhoneInterestCommand,
    writes: { path: string; body: string }[] = [],
    reads: string[] = [];
  let saved = 0;
  phoneClient.finishPhoneInterest(owner, c.requestId);
  const store = {
    snapshot: () => ({ status: 'member', session: { user: { id: owner } } }),
    fetch: async (path: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        writes.push({ path, body: String(init.body) });
        return Response.json(result);
      }
      reads.push(path);
      return Response.json({ title: 'not_found' }, { status: 404 });
    },
  };
  const compiled = compile(
    'market/phone-interest.tsx',
    h,
    {
      '../auth/auth-provider': { useCustomerSession: () => ({ store }) },
      '@/lib/checkout/cart-client': { CartError },
      '@/lib/market/phone-interest-client': phoneClient,
    },
    '\nexport const TestInterestAction=InterestAction;',
  );
  const props = {
      owner,
      listingId: 'other-listing',
      configurationId: other,
      canNotify: true,
      onSaved: () => saved++,
    },
    render = () => h.render<Element>(compiled.TestInterestAction, props);
  try {
    render();
    await flush();
    let tree = render();
    phoneClient.startPhoneInterest(c);
    button(tree, 'موجود شد خبرم کن').props.onClick();
    await flush();
    tree = render();
    assert.equal(writes.length, 0);
    assert.equal(
      phoneClient.pendingPhoneInterest(owner)!.input.configurationId,
      c.input.configurationId,
    );
    button(tree, 'پیگیری نتیجه').props.onClick();
    await flush();
    tree = render();
    assert.equal(writes.length, 0);
    assert.equal(reads.at(-1), '/api/phones/interests/commands/' + c.requestId);
    assert.ok(phoneClient.pendingPhoneInterest(owner));
    button(tree, 'ارسال دوبارهٔ همین فرمان').props.onClick();
    await flush();
    render();
    assert.equal(writes.length, 1);
    assert.equal(
      writes[0].path,
      '/api/phones/interests/' + c.listingId + '/commands/' + c.requestId,
    );
    assert.equal(writes[0].body, JSON.stringify(c.input));
    assert.equal(saved, 1);
    assert.equal(phoneClient.pendingPhoneInterest(owner), null);
  } finally {
    phoneClient.finishPhoneInterest(owner, c.requestId);
    h.dispose();
  }
});

test('actual phone filters preserve rapid search draft while applying facets and cancel the obsolete debounce', () => {
  const h = hooks(),
    routes: string[] = [],
    compiled = compile('market/phone-market.tsx', h, {
      'next/navigation': {
        useRouter: () => ({ replace: (url: string) => routes.push(url) }),
        useSearchParams: () => new URLSearchParams(),
      },
      './sourcing-provider': { useSourcing: () => null },
      './sourcing': { SourcingError: 'SourcingError' },
      './phone-interest': { PhoneInterestAction: 'PhoneInterestAction' },
      '@/lib/navigation/i18n': { localeHref },
      '@sayman/web-shared/lib/market/phone-discovery-contract.ts': phoneContract,
    });
  const query = phoneContract.phoneSearchSchema.parse({ page: 2 }),
    props = { query, page: { ...page, page: 2, total: 30, totalPages: 3 } },
    render = () => h.render<Element>(compiled.PhoneBrowse, props);
  try {
    let tree = render();
    elements(tree)
      .find((v) => v.type === 'input' && v.props['aria-label'] === 'جست‌وجوی مدل گوشی')!
      .props.onChange({ target: { value: 'Galaxy A56' } });
    tree = render();
    button(tree, '8 گیگابایت').props.onClick();
    assert.equal(routes.at(-1), '/fa/market?q=Galaxy+A56&ram=8');
    assert.equal(h.timers.size, 0);
    h.tick();
    assert.equal(routes.length, 1);
    tree = render();
    button(tree, '256 گیگابایت').props.onClick();
    assert.equal(routes.at(-1), '/fa/market?q=Galaxy+A56&ram=8&storage=256');
  } finally {
    h.dispose();
  }
});

test('actual phone Clear and browser query changes cancel pending searches and restore displayed draft/page', () => {
  const h = hooks(),
    routes: string[] = [],
    compiled = compile('market/phone-market.tsx', h, {
      'next/navigation': {
        useRouter: () => ({ replace: (url: string) => routes.push(url) }),
        useSearchParams: () => new URLSearchParams(),
      },
      './sourcing-provider': { useSourcing: () => null },
      './sourcing': { SourcingError: 'SourcingError' },
      './phone-interest': { PhoneInterestAction: 'PhoneInterestAction' },
      '@/lib/navigation/i18n': { localeHref },
      '@sayman/web-shared/lib/market/phone-discovery-contract.ts': phoneContract,
    });
  let props = {
    query: phoneContract.phoneSearchSchema.parse({ query: 'old', page: 2, ramGb: 8 }),
    page,
  };
  const render = () => h.render<Element>(compiled.PhoneBrowse, props),
    input = (tree: Element) =>
      elements(tree).find(
        (v) => v.type === 'input' && v.props['aria-label'] === 'جست‌وجوی مدل گوشی',
      )!;
  try {
    let tree = render();
    input(tree).props.onChange({ target: { value: 'obsolete' } });
    tree = render();
    button(tree, 'پاک کردن').props.onClick();
    h.tick();
    assert.deepEqual(routes, ['/fa/market']);
    tree = render();
    input(tree).props.onChange({ target: { value: 'typed after clear' } });
    props = {
      ...props,
      query: phoneContract.phoneSearchSchema.parse({
        query: 'back destination',
        page: 3,
        storageGb: 512,
      }),
    };
    render();
    tree = render();
    assert.equal(input(tree).props.value, 'back destination');
    assert.equal(h.timers.size, 0);
    h.tick();
    assert.equal(routes.length, 1);
  } finally {
    h.dispose();
  }
});

test('actual phone detail and comparison display localized specifications and keep technical keys out of visible text', () => {
  const h = hooks(),
    item = {
      ...page.items[0],
      model: { ...page.items[0].model, attributes: { 'phone-refresh-rate': '120 Hz' } },
    },
    compiled = compile('market/phone-market.tsx', h, {
      'next/navigation': {
        useRouter: () => ({ replace() {} }),
        useSearchParams: () => new URLSearchParams(),
      },
      './sourcing-provider': { useSourcing: () => null },
      './sourcing': { SourcingError: 'SourcingError' },
      './phone-interest': { PhoneInterestAction: 'PhoneInterestAction' },
      '@/lib/navigation/i18n': { localeHref },
      '@sayman/web-shared/lib/market/phone-discovery-contract.ts': phoneContract,
    });
  try {
    const detail = h.render<Element>(compiled.PhoneDetail, { item });
    assert.equal(text(detail).includes('phone-refresh-rate'), false);
    assert.ok(text(detail).includes('نرخ نوسازی نمایشگر'));
    assert.ok(text(detail).includes('۱۲۰ هرتز'));
    const comparison = callComponent<Element>(compiled.PhoneComparison, { items: [item] });
    assert.equal(text(comparison).includes('phone-refresh-rate'), false);
    assert.ok(text(comparison).includes('نرخ نوسازی نمایشگر'));
    assert.ok(text(comparison).includes('۱۲۰ هرتز'));
  } finally {
    h.dispose();
  }
});

test('phone discovery keeps the selected sellable variant when opening the store offer', () => {
  const h = hooks(),
    item = structuredClone(page.items[0]),
    configuration = item.configurations[0];
  Object.assign(configuration, {
    availableInStore: true,
    storeSlug: 'matching-phone',
    variantId: 'specific-colour-memory',
    canRequest: false,
  });
  const compiled = compile('market/phone-market.tsx', h, {
    'next/navigation': {
      useRouter: () => ({ replace() {} }),
      useSearchParams: () => new URLSearchParams(),
    },
    './sourcing-provider': { useSourcing: () => null },
    './sourcing': { SourcingError: 'SourcingError' },
    './phone-interest': { PhoneInterestAction: 'PhoneInterestAction' },
    '@/lib/navigation/i18n': { localeHref },
    '@sayman/web-shared/lib/market/phone-discovery-contract.ts': phoneContract,
  });
  try {
    const tree = h.render<Element>(compiled.PhoneDetail, { item }),
      link = elements(tree).find(
        (v) => text(v).includes('دیدن پیشنهاد موجود فروشگاه') && typeof v.props.href === 'string',
      );
    assert.equal(link?.props.href, '/product/matching-phone?variant=specific-colour-memory');
  } finally {
    h.dispose();
  }
});

test('a late add response never confirms a different colour; cart state owns the phone confirmation', async () => {
  const h = hooks(),
    item = structuredClone(page.items[0]),
    first = item.configurations[0],
    second = { ...first, id: other, colorKey: 'white', colorNameFa: 'سفید', colorNameEn: 'White' },
    pending = deferred<boolean>(),
    writes: unknown[][] = [],
    sourcing = {
      ready: true,
      busy: false,
      locked: false,
      unknown: false,
      cart: { lines: [] as { listingId: string; configurationId: string; quantity: number }[] },
      add: (...args: unknown[]) => {
        writes.push(args);
        return pending.promise;
      },
    };
  item.configurations.push(second);
  const compiled = compile(
    'market/phone-market.tsx',
    h,
    {
      'next/navigation': {
        useRouter: () => ({ replace() {} }),
        useSearchParams: () => new URLSearchParams(),
      },
      './sourcing-provider': { useSourcing: () => sourcing },
      './sourcing': { SourcingError: 'SourcingError' },
      './phone-interest': { PhoneInterestAction: 'PhoneInterestAction' },
      '@/lib/navigation/i18n': { localeHref },
      '@sayman/web-shared/lib/market/phone-discovery-contract.ts': phoneContract,
    },
    '',
    { window: { history: { replaceState() {} } } },
  );
  const render = () => h.render<Element>(compiled.PhoneDetail, { item }),
    confirmed = (tree: Element) => elements(tree).some((v) => v.props.className === 'phone-added');
  try {
    let tree = render();
    button(tree, 'افزودن پیش‌سفارش به سبد').props.onClick();
    assert.deepEqual(writes, [[item.id, 1, first.id]]);
    button(tree, 'سفید').props.onClick();
    render();
    sourcing.cart.lines = [{ listingId: item.id, configurationId: first.id, quantity: 1 }];
    pending.resolve(true);
    await flush();
    tree = render();
    assert.equal(confirmed(tree), false);
    sourcing.cart.lines = [{ listingId: item.id, configurationId: second.id, quantity: 1 }];
    assert.equal(confirmed(render()), true);
    sourcing.cart.lines = [];
    assert.equal(confirmed(render()), false);
  } finally {
    h.dispose();
  }
});

type TestJournal = {
  owner: string;
  pending: { command: { kind: string; body: { requestId: string } }; result: null } | null;
};
function offerMocks(h: Hooks, client: Record<string, unknown>, getJournal: () => TestJournal) {
  const listeners = new Set<(scope: string) => void>(),
    live = {
      listen: (f: (scope: string) => void) => {
        listeners.add(f);
        return () => listeners.delete(f);
      },
    },
    refreshHooks = compile('@sayman/web-shared/components/notifications/private-realtime', h, {
      '../../lib/notifications/realtime-refresh': {
        RealtimeRefreshGate: class extends RealtimeRefreshGate {
          constructor(refresh: () => void, busy: () => boolean) {
            super(refresh, busy, (run) => {
              const id = h.schedule(run);
              return () => h.cancel(id);
            });
          }
        },
      },
      '../../lib/notifications/private-realtime-client': {},
    });
  const store = {
    snapshot: () => ({ status: 'member', session: { user: { id: owner } } }),
    fetch: async () => Response.json({}),
  };
  return {
    listeners,
    mocks: {
      '../auth/auth-provider': { useCustomerSession: () => ({ store }) },
      './sourcing-provider': { useSourcingCommand: getJournal },
      './sourcing': { useSourcingText: () => (fa: string) => fa },
      '@/lib/checkout/cart-client': { CartError },
      '@/lib/market/offer-client': client,
      '@sayman/web-shared/lib/market/offer-contract.ts': offerContract,
      '@/lib/market/offer-interaction': offerInteraction,
      '@/lib/market/sourcing-journal': sourcingJournal,
      '@sayman/web-shared/lib/notifications/private-realtime-client.ts': { bindRealtimeTransport },
      '@sayman/web-shared/components/notifications/private-realtime': {
        usePrivateRealtime: () => live,
        useRealtimeRefresh: refreshHooks.useRealtimeRefresh,
        PrivateRealtimeStatus: 'PrivateRealtimeStatus',
      },
    },
  };
}

test('actual quote realtime handler defers notification refresh behind an unresolved command and only reloads reads after release', async () => {
  const h = hooks();
  let journal: TestJournal = { owner, pending: null },
    reads = 0;
  const pendingRead = deferred<typeof offerTestPage>();
  const client = {
      listSourcingOffers: async () => {
        reads++;
        return reads === 2 ? pendingRead.promise : offerTestPage;
      },
    },
    setup = offerMocks(h, client, () => journal),
    compiled = compile('market/customer-offers.tsx', h, setup.mocks),
    props = { requestId: offerTestRequest, refreshToken: 0, onCapabilities() {}, onChanged() {} },
    render = () => h.render<Element>(compiled.CustomerSourcingOffers, props);
  try {
    render();
    await flush();
    render();
    assert.equal(reads, 1);
    journal = {
      owner,
      pending: {
        command: { kind: 'submit', body: { requestId: commandFixture.requestId } },
        result: null,
      },
    };
    render();
    for (const listener of setup.listeners) listener('notifications');
    h.tick();
    render();
    assert.equal(reads, 1);
    journal = { owner, pending: null };
    render();
    h.tick();
    render();
    render();
    assert.equal(reads, 2);
    for (const listener of setup.listeners) listener('notifications');
    h.tick();
    render();
    assert.equal(reads, 2);
    pendingRead.resolve(offerTestPage);
    await flush();
    render();
    h.tick();
    render();
    await flush();
    assert.equal(reads, 3);
  } finally {
    h.dispose();
  }
});

test('actual quote detail clears checked consent on a new read and requires review of the fresh terms', async () => {
  const h = hooks();
  let reads = 0;
  const future = {
      ...offerTestDetail,
      offer: {
        ...offerTestDetail.offer,
        summary: {
          ...offerTestDetail.offer.summary,
          acceptUntil: '2099-10-28T12:00:00Z',
          purchaseUntil: '2099-10-29T12:00:00Z',
        },
      },
    },
    newer = {
      ...future,
      offer: {
        ...future.offer,
        summary: { ...future.offer.summary, version: 'AAAAAAAAAAI=', termsHash: 'B'.repeat(64) },
        termsFa: 'شرایط جدید',
      },
    };
  const client = {
      readSourcingOffer: async () => (++reads === 1 ? future : newer),
      sourcingOfferEvents: async () => offerTestEvents,
    },
    setup = offerMocks(h, client, () => ({ owner, pending: null })),
    compiled = compile(
      'market/customer-offers.tsx',
      h,
      setup.mocks,
      '\nexport const TestCustomerOfferView=CustomerOfferView;',
    );
  let props = {
    requestId: offerTestRequest,
    offerId: offerTestId,
    capabilityVersion: offerTestVersion,
    refreshToken: 0,
    recovered: null,
    onChanged() {},
  };
  const render = () => h.render<Element>(compiled.TestCustomerOfferView, props);
  try {
    render();
    await flush();
    let tree = render();
    button(tree, 'بررسی و پذیرش شرایط').props.onClick();
    tree = render();
    elements(tree)
      .find((v) => v.type === 'input' && v.props.type === 'checkbox')!
      .props.onChange({ target: { checked: true } });
    tree = render();
    assert.equal(button(tree, 'ثبت رضایت برای پیگیری تأمین').props.disabled, false);
    props = { ...props, refreshToken: 1 };
    render();
    await flush();
    tree = render();
    assert.equal(
      elements(tree).some((v) => v.type === 'input' && v.props.type === 'checkbox'),
      false,
    );
    assert.equal(reads, 2);
    button(tree, 'بررسی و پذیرش شرایط').props.onClick();
    tree = render();
    assert.equal(
      elements(tree).find((v) => v.type === 'input' && v.props.type === 'checkbox')!.props.checked,
      false,
    );
    assert.equal(button(tree, 'ثبت رضایت برای پیگیری تأمین').props.disabled, true);
  } finally {
    h.dispose();
  }
});

function connectedCart(
  reply: (
    path: string,
    init: RequestInit,
    account: ReturnType<typeof cart2Snapshot>,
  ) => Response | Promise<Response>,
) {
  const h = hooks(),
    account = cart2Snapshot('empty'),
    calls: { path: string; method: string; body: unknown }[] = [],
    legacy = JSON.stringify([{ variantId: 'preserved-guest-sku', quantity: 2 }]),
    storage = new Map([['sayman:legacy-cart:v1', legacy]]),
    changes: string[] = [],
    cookieWrites: string[] = [],
    windowEvents = new Map<string, () => void>(),
    buses: { onmessage: (() => void) | null }[] = [];
  const auth: {
      status: 'member' | 'guest';
      session: { user: { id: string } } | null;
      store?: unknown;
    } = { status: 'member', session: { user: { id: owner } } },
    store = {
      snapshot: () => auth,
      fetch: async (path: string, init: RequestInit = {}) => {
        calls.push({ path, method: init.method ?? 'GET', body: init.body });
        return reply(path, init, account);
      },
    };
  auth.store = store;
  const registry = { publish() {}, release() {}, current: () => [] };
  const document = {
    addEventListener() {},
    removeEventListener() {},
    get cookie() {
      return 'sayman_cart=guest-token-preserved';
    },
    set cookie(value: string) {
      cookieWrites.push(value);
    },
  };
  const compiled = compile(
    'providers/connected-shop-provider.tsx',
    h,
    {
      '../navigation/locale-provider': {
        useI18n: () => ({ locale: 'fa', t: (value: string) => value }),
        useProductRegistry: () => registry,
      },
      '../auth/auth-provider': { useCustomerSession: () => auth },
      './shop-context': { ShopContext: { Provider: 'ShopContextProvider' } },
      '../wishlist/connected-wishlist': {
        useConnectedWishlist: () => ({ wishlist: [], ready: true, toggle() {} }),
      },
      '../checkout/legacy-cart-review': { LegacyCartReview: 'LegacyCartReview' },
      '@/lib/checkout/cart-client': {
        CartError,
        withCartLock: (run: () => unknown) => run(),
        combineLegacyCart() {
          throw Error('Legacy transfer must remain explicit.');
        },
      },
      '@/lib/checkout/cart-v2-client': { requestCartV2 },
      '@/lib/checkout/cart-v2-contract': cartContract,
      '@/lib/catalog/catalog-client': { lookupProducts: async () => [] },
      '@/lib/wishlist/saved-shop': savedShop,
      '@sayman/web-shared/lib/shared/commerce.ts': { findVariant: () => null },
      '@/lib/checkout/cart-addition': {
        addCartSelection() {
          throw Error('No cart edit was requested.');
        },
      },
      '@/lib/checkout/cart-command-runner': {
        createCartCommandRunner() {
          throw Error('No private command was requested.');
        },
        pendingCartCommand: () => null,
      },
      '@/lib/checkout/cart-conversion-contract': {
        cartOfferRemovalInputSchema: { parse: (v: unknown) => v },
      },
      '@/lib/checkout/cart-review-capabilities': { cartReviewCapabilities },
      '@/lib/market/sourcing-journal': sourcingJournal,
    },
    '',
    {
      document,
      window: {
        addEventListener: (name: string, handler: () => void) => windowEvents.set(name, handler),
        removeEventListener: (name: string) => windowEvents.delete(name),
      },
      BroadcastChannel: class {
        onmessage: (() => void) | null = null;
        constructor() {
          buses.push(this);
        }
        postMessage() {}
        close() {}
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          changes.push(key);
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          changes.push(key);
          storage.delete(key);
        },
      },
    },
  );
  const render = () =>
    h.render<Element>(compiled.ConnectedShopProvider, { children: 'Customer view' });
  return {
    h,
    render,
    account,
    calls,
    legacy,
    storage,
    changes,
    cookieWrites,
    windowEvents,
    buses,
    auth,
  };
}

for (const code of ['cart_phone_configuration_conflict', 'phone_configuration_required'])
  test(
    'actual member merge ' +
      code +
      ' loads account cart without automatically resending or deleting guest selections',
    async () => {
      const {
        h,
        render,
        account,
        calls,
        legacy,
        storage,
        changes,
        cookieWrites,
        windowEvents,
        buses,
      } = connectedCart((_path, init, account) =>
        init.method === 'POST'
          ? Response.json({ title: code }, { status: 409 })
          : Response.json(account),
      );
      try {
        render();
        await flush();
        let tree = render();
        await flush();
        tree = render();
        assert.equal(tree.type, 'ShopContextProvider');
        assert.equal(shopValue(tree).ready, true);
        assert.equal(shopValue(tree).loadError, false);
        assert.deepEqual(shopValue(tree).serverCart, account);
        assert.equal(shopValue(tree).cartBusy, false);
        assert.equal(shopValue(tree).quoteReviewIssue, true);
        assert.ok(text(tree).includes('سبد پیش از ورود هنوز منتقل نشده است'));
        assert.deepEqual(
          calls.map((c) => [c.path, c.method]),
          [
            ['/api/cart/fa/v2/merge', 'POST'],
            ['/api/cart/fa/v2', 'GET'],
          ],
        );
        assert.equal(calls[0].body, '{}');
        assert.equal(calls[1].body, undefined);
        h.tick();
        render();
        await flush();
        render();
        assert.equal(calls.length, 2);
        assert.equal(storage.get('sayman:legacy-cart:v1'), legacy);
        assert.equal(changes.includes('sayman:legacy-cart:v1'), false);
        assert.deepEqual(cookieWrites, []);
        windowEvents.get('focus')?.();
        render();
        await flush();
        tree = render();
        assert.equal(
          calls.filter((v) => v.method === 'POST').length,
          1,
          'Window focus must not automatically resend the conflicted merge.',
        );
        buses[0]?.onmessage?.();
        render();
        await flush();
        tree = render();
        assert.equal(
          calls.filter((v) => v.method === 'POST').length,
          1,
          'Cross-tab refresh must not automatically resend the conflicted merge.',
        );
        const previousGets = calls.filter((v) => v.method === 'GET').length;
        button(tree, 'تلاش برای ادغام').props.onClick();
        render();
        await flush();
        tree = render();
        assert.equal(calls.filter((v) => v.method === 'POST').length, 2);
        assert.equal(calls.filter((v) => v.method === 'GET').length, previousGets + 1);
        assert.equal(shopValue(tree).ready, true);
        assert.equal(storage.get('sayman:legacy-cart:v1'), legacy);
        assert.deepEqual(cookieWrites, []);
      } finally {
        h.dispose();
      }
    },
  );

test('actual merge conflict marker clears on logout/owner change and blocks checkout until explicit retry is confirmed', async () => {
  let mode: 'conflict' | 'pending' | 'success' = 'conflict';
  const response = deferred<Response>(),
    q = connectedCart((_path, init, account) =>
      init.method !== 'POST' || mode === 'success'
        ? Response.json(account)
        : mode === 'pending'
          ? response.promise
          : Response.json({ title: 'cart_phone_configuration_conflict' }, { status: 409 }),
    );
  try {
    q.render();
    await flush();
    let tree = q.render();
    q.auth.status = 'guest';
    q.auth.session = null;
    q.render();
    await flush();
    tree = q.render();
    assert.equal(q.calls.filter((v) => v.method === 'POST').length, 1);
    assert.equal(text(tree).includes('سبد پیش از ورود هنوز منتقل نشده است'), false);
    q.auth.status = 'member';
    q.auth.session = { user: { id: other } };
    q.render();
    await flush();
    q.render();
    assert.equal(q.calls.filter((v) => v.method === 'POST').length, 2);
    q.auth.session = { user: { id: owner } };
    q.render();
    await flush();
    tree = q.render();
    assert.equal(q.calls.filter((v) => v.method === 'POST').length, 3);
    mode = 'pending';
    button(tree, 'تلاش برای ادغام').props.onClick();
    tree = q.render();
    assert.equal(q.calls.filter((v) => v.method === 'POST').length, 4);
    assert.equal(shopValue(tree).quoteReviewIssue, true);
    assert.ok(text(tree).includes('سبد پیش از ورود هنوز منتقل نشده است'));
    mode = 'success';
    response.resolve(Response.json(q.account));
    await flush();
    tree = q.render();
    assert.equal(text(tree).includes('سبد پیش از ورود هنوز منتقل نشده است'), false);
    assert.equal(shopValue(tree).ready, true);
    assert.equal(shopValue(tree).loadError, false);
    q.windowEvents.get('focus')?.();
    q.render();
    await flush();
    q.render();
    assert.equal(
      q.calls.filter((v) => v.method === 'POST').length,
      5,
      'A confirmed merge restores the existing normal load behaviour.',
    );
    assert.equal(q.storage.get('sayman:legacy-cart:v1'), q.legacy);
    assert.deepEqual(q.cookieWrites, []);
  } finally {
    q.h.dispose();
  }
});

test('actual legacy capacity fallback and unknown initial merge retain their existing refresh behaviour', async () => {
  for (const code of ['cart_limit', 'cart_amount_limit', 'transport_unknown']) {
    const q = connectedCart((_path, init, account) => {
      if (init.method !== 'POST') return Response.json(account);
      if (code === 'transport_unknown') throw Error('Lost initial merge reply');
      return Response.json({ title: code }, { status: 409 });
    });
    try {
      q.render();
      await flush();
      let tree = q.render();
      assert.equal(q.calls.filter((v) => v.method === 'POST').length, 1);
      assert.equal(
        q.calls.filter((v) => v.method === 'GET').length,
        code === 'transport_unknown' ? 0 : 1,
      );
      assert.equal(shopValue(tree).ready, code !== 'transport_unknown');
      assert.equal(shopValue(tree).loadError, code === 'transport_unknown');
      q.windowEvents.get('focus')?.();
      q.render();
      await flush();
      tree = q.render();
      assert.equal(q.calls.filter((v) => v.method === 'POST').length, 2);
      assert.equal(q.storage.get('sayman:legacy-cart:v1'), q.legacy);
      assert.deepEqual(q.cookieWrites, []);
    } finally {
      q.h.dispose();
    }
  }
});
