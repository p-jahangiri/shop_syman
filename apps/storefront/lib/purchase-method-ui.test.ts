import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { storefrontSnapshot } from './fixtures.ts';
import { localeFormat, translate } from './i18n.ts';
import * as purchasing from './purchasing.ts';
import * as commerce from './commerce.ts';
import * as money from './money.ts';
import * as media from './media-paths.ts';
import * as catalog from './catalog-contract.ts';
import * as homeBlocks from './home-blocks.ts';
import * as seo from './seo.ts';
import * as creditApplications from './credit-application-contract.ts';
import { advanceRequestGeneration } from './request-generation.ts';
import { parseCreditRequestedToman } from './credit-application-form.ts';
import { readSupportContent } from './support-content-contract.ts';
import { accountReturnTo } from './order-form.ts';
import type { Locale, PurchaseMethod, StorefrontSnapshot } from './types.ts';

// Compile actual TSX render paths in memory. Hook/session substitutes are test-only;
// these assertions neither authenticate a browser nor make API/database requests.
const require = createRequire(import.meta.url);
const swc = require('next/dist/build/swc');
await swc.loadBindings();
type Element = { type: unknown; props: Record<string, unknown> };
const elements = (value: unknown): Element[] => {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
};
const text = (value: unknown): string => {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value !== 'object') return String(value);
  return 'props' in value ? text((value as Element).props.children) : '';
};
function render(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(render);
  if (!value || typeof value !== 'object' || !('props' in value)) return value;
  const element = value as Element;
  if (typeof element.type === 'function')
    return render((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  return { ...element, props: { ...element.props, children: render(element.props.children) } };
}
const hrefs = (value: unknown) =>
  elements(value).flatMap((node) => (typeof node.props.href === 'string' ? [node.props.href] : []));
const installmentHref = (href: string) =>
  /^\/(?:fa\/|en\/)?installments(?:\/|$)/.test(new URL(href, 'https://shop.example').pathname);
function snapshot(locale: Locale = 'fa') {
  const value: StorefrontSnapshot = {
    ...structuredClone(storefrontSnapshot),
    dataSource: 'api',
    isPreview: false,
    locale,
  };
  value.purchaseMethods = value.purchaseMethods.map((method) => ({
    ...method,
    enabled: method.kind === 'online',
  }));
  return value;
}
function chequeEnabled(value: StorefrontSnapshot) {
  value.purchaseMethods = value.purchaseMethods.map((method) => ({
    ...method,
    enabled: method.kind === 'cheque',
  }));
  return value;
}
function methodSnapshot(locale: Locale, enabled: PurchaseMethod['kind'] | null) {
  const value = snapshot(locale);
  value.purchaseMethods.push({
    id: 'provider',
    kind: 'installment',
    name: 'Provider plans',
    description: '',
    enabled: false,
    requiresApproval: true,
  });
  value.purchaseMethods = value.purchaseMethods.map((method) => ({
    ...method,
    enabled: method.kind === enabled,
  }));
  return value;
}
function compile(
  file: string,
  value: StorefrontSnapshot,
  overrides: Record<string, unknown> = {},
  extra = '',
  initialStates: Record<number, unknown> = {},
) {
  const locale = value.locale ?? 'fa';
  const i18n = {
    useI18n: () => ({
      locale,
      ...localeFormat(locale),
      t: <T>(source: T, variables?: unknown[]) => translate(source, locale, variables),
    }),
    useStorefront: () => value,
    ProductsScope: 'ProductsScope',
  };
  let stateIndex = 0;
  const hooks = {
    Fragment: 'Fragment',
    useState(initial: unknown) {
      const index = stateIndex++;
      return [
        Object.hasOwn(initialStates, index)
          ? initialStates[index]
          : initial === 'login'
            ? 'account'
            : typeof initial === 'function'
              ? initial()
              : initial,
        () => {},
      ];
    },
    useEffect: () => {},
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useSyncExternalStore: (
      _subscribe: unknown,
      _snapshot: unknown,
      serverSnapshot: () => unknown,
    ) => serverSnapshot(),
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const links = {
    default: 'Link',
    useRouter: () => ({ replace() {}, push() {} }),
    usePathname: () => '/',
  };
  const ui = { Button: 'Button', Modal: 'Modal', groupNavigation() {} };
  const mocks: Record<string, unknown> = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_target, name) => String(name) }),
    'next/navigation': { useSearchParams: () => new URLSearchParams() },
    '@/components/locale-provider': i18n,
    './locale-provider': i18n,
    '@/components/localized-link': links,
    './localized-link': links,
    '@/components/content-image': { default: 'Image' },
    './ui': ui,
    '@/components/ui': ui,
    './shop-provider': {
      useShop: () => ({
        wishlist: [],
        compare: [],
        ready: true,
        cartBusy: false,
        loadError: false,
        cart: [],
        serverCart: null,
        setCartOpen() {},
      }),
    },
    './used-condition': { UsedConditionReport: 'UsedConditionReport' },
    './product-reviews': { ProductReviews: 'ProductReviews' },
    './product-card': { ProductGrid: 'ProductGrid' },
    './connected-account': { ConnectedAccount: 'ConnectedAccount' },
    './sourcing': {
      SourcingDrawerLink: 'SourcingDrawerLink',
      SourcingCartIndicator: 'SourcingCartIndicator',
    },
    './cart-summary': { CartAmount: 'CartAmount', CartCheckoutLink: 'CartCheckoutLink' },
    './accepted-cart-groups': { AcceptedCartGroups: 'AcceptedCartGroups' },
    './cart-command-notice': { CartCommandNotice: 'CartCommandNotice' },
    './language-switch': { LanguageSwitch: 'LanguageSwitch' },
    '@/lib/cart-v2-contract': { cartV2BuyCount: () => 0, cartV2HasBuyLines: () => false },
    '@/lib/catalog-client': {
      async searchProducts() {
        throw Error('Unexpected catalog request in render');
      },
    },
    '@/lib/server-locale': {
      getLocale: async () => locale,
      serverI18n: async () => ({ ...value, ...i18n.useI18n() }),
    },
    '@/lib/home-blocks': homeBlocks,
    '@/lib/seo': seo,
    '@/components/product-card': { ProductGrid: 'ProductGrid' },
    '@/components/home-collection': { HomeCollection: 'HomeCollection' },
    '@/components/spotlight': { Spotlight: 'Spotlight' },
    '@/components/scroll-rail': { ScrollRail: 'ScrollRail' },
    '@/lib/purchasing': purchasing,
    '@/lib/commerce': commerce,
    '@/lib/money': money,
    '@/lib/media-paths': media,
    '@/lib/order-form': { accountReturnTo },
    ...overrides,
  };
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8') + extra;
  const code = swc.transformSync(source, {
    filename: file,
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  }).code;
  const exported: Record<string, unknown> = {};
  vm.runInNewContext(code, {
    exports: exported,
    require(name: string) {
      assert.ok(name in mocks, 'Unexpected module: ' + name);
      return mocks[name];
    },
    URLSearchParams,
  });
  return exported;
}

test('disabled cheque routes reject before catalog lookup and metadata does not advertise the method', async () => {
  for (const locale of ['fa', 'en'] as const) {
    const value = snapshot(locale);
    let lookups = 0;
    const route = compile('app/[locale]/installments/page.tsx', value, {
      'next/navigation': {
        notFound() {
          throw Error('NOT_FOUND');
        },
      },
      '@/lib/server-locale': {
        serverI18n: async () => ({
          ...value,
          ...{
            t: <T>(source: T) => translate(source, locale),
          },
        }),
      },
      '@/lib/catalog-server': {
        async getCatalogProducts() {
          lookups++;
          return value.products;
        },
      },
      '@/lib/catalog-contract': catalog,
      '@/components/installments': { Installments: 'Installments' },
    });
    const page = route.default as (props: unknown) => Promise<Element>;
    await assert.rejects(
      page({ searchParams: Promise.resolve({ product: 'iphone-16' }) }),
      /NOT_FOUND/,
    );
    assert.equal(lookups, 0);
    const metadata = await (route.generateMetadata as () => Promise<Record<string, unknown>>)();
    assert.equal(metadata.title, locale === 'fa' ? 'صفحه در دسترس نیست' : 'Page unavailable');
    assert.equal(JSON.stringify(metadata.robots), JSON.stringify({ index: false, follow: false }));
  }
});

test('an enabled cheque route still resolves its product and renders the calculator', async () => {
  const value = chequeEnabled(snapshot());
  let lookups = 0;
  const route = compile('app/[locale]/installments/page.tsx', value, {
    'next/navigation': {
      notFound() {
        throw Error('NOT_FOUND');
      },
    },
    '@/lib/server-locale': {
      serverI18n: async () => ({ ...value, t: (source: unknown) => source }),
    },
    '@/lib/catalog-server': {
      async getCatalogProducts() {
        lookups++;
        return [value.products[0]];
      },
    },
    '@/lib/catalog-contract': catalog,
    '@/components/installments': { Installments: 'Installments' },
  });
  const tree = await (route.default as (props: unknown) => Promise<Element>)({
    searchParams: Promise.resolve({ product: 'iphone-16' }),
  });
  assert.equal(lookups, 1);
  assert.ok(elements(tree).some((node) => node.type === 'Installments'));
});

test('the calculator component does not show promotional terms or inputs when cheque purchasing is disabled', () => {
  for (const locale of ['fa', 'en'] as const) {
    const component = compile('components/installments.tsx', snapshot(locale));
    const tree = (component.Installments as () => Element)();
    assert.equal(
      elements(tree).some((node) => node.type === 'input'),
      false,
    );
    assert.equal(
      elements(tree).some((node) => node.props.className === 'installment-intro'),
      false,
    );
    assert.ok(elements(tree).some((node) => node.props.href === '/catalog'));
  }
});

test('a valid amount without an eligible plan does not become a zero-percent repayment offer', () => {
  const value = chequeEnabled(snapshot());
  value.chequePlans = [];
  const component = compile('components/installments.tsx', value);
  const tree = (component.Installments as () => Element)();
  assert.equal(
    elements(tree).some((node) => node.props.className === 'plan-details'),
    false,
  );
  assert.equal(
    elements(tree).some((node) => node.props.className === 'calculator-main'),
    false,
  );
  assert.ok(text(tree).includes('خرید چکی برای این کالا یا مبلغ فعال نیست.'));
});

test('connected calculator guidance keeps the confirmed cheque approval rule and confines sample-only claims to previews', () => {
  for (const preview of [false, true]) {
    const value = chequeEnabled(snapshot());
    value.isPreview = preview;
    value.dataSource = preview ? 'fixture' : 'api';
    const component = compile('components/installments.tsx', value);
    const tree = (component.Installments as () => Element)();
    assert.equal(
      text(tree).includes('در این نسخه درخواست اعتبار ثبت یا مدرکی دریافت نمی‌شود.'),
      preview,
    );
    if (!preview)
      assert.ok(text(tree).includes('دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها الزامی است.'));
  }
});

test('product detail removes disabled cheque acquisition while keeping its neutral price and other methods', () => {
  const value = snapshot('en');
  const component = compile('components/product-detail.tsx', value);
  const tree = (component.ProductDetail as (props: unknown) => Element)({
    product: value.products[0],
  });
  assert.equal(
    elements(tree).some((node) => String(node.props.href ?? '').startsWith('/installments')),
    false,
  );
  assert.ok(text(tree).includes('Product price'));
  assert.ok(
    text(tree).includes(
      translate(value.purchaseMethods.find((method) => method.kind === 'online')!.name, 'en'),
    ),
  );
});

test('enabled cheque-only purchasing retains the product calculator and does not advertise a cash-price method', () => {
  const value = chequeEnabled(snapshot('en'));
  const component = compile('components/product-detail.tsx', value);
  const tree = (component.ProductDetail as (props: unknown) => Element)({
    product: value.products[0],
  });
  assert.ok(
    elements(tree).some((node) => String(node.props.href ?? '').startsWith('/installments')),
  );
  assert.ok(text(tree).includes('Product price'));
  assert.equal(text(tree).includes('Sample cash price'), false);
});

test('preview account acquisition links disappear when disabled but return when cheque is enabled', () => {
  for (const enabled of [false, true]) {
    const value = enabled ? chequeEnabled(snapshot()) : snapshot();
    value.dataSource = 'fixture';
    const component = compile('components/account.tsx', value, {}, '\nexport { PreviewAccount };');
    const tree = (component.PreviewAccount as () => Element)();
    assert.equal(
      elements(tree).some((node) => node.props.href === '/installments'),
      enabled,
    );
  }
});

test('a connected customer keeps cheque-history and order access even when new cheque purchasing is disabled', () => {
  const value = snapshot();
  const component = compile('components/connected-account.tsx', value, {
    './auth-provider': {
      useCustomerSession: () => ({
        status: 'member',
        session: { user: { id: 'member', displayName: 'Customer' } },
        store: {},
      }),
    },
  });
  const tree = (component.ConnectedAccount as () => Element)();
  assert.ok(elements(tree).some((node) => node.props.href === '/credit'));
  assert.ok(elements(tree).some((node) => node.props.href === '/orders'));
  assert.ok(text(tree).includes('سوابق و پیگیری خرید چکی'));
});

test('actual header and footer hide disabled acquisition links and confidence while retaining generic and historical navigation in both languages', () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const enabled of [null, 'online', 'cheque', 'installment'] as const) {
      const value = methodSnapshot(locale, enabled);
      value.site.nav = [
        { label: 'Catalog', href: '/catalog' },
        { label: 'A product', href: '/product/iphone-16' },
        { label: 'Previous cheque applications', href: '/credit' },
        { label: 'Previous cheque orders', href: '/credit/purchases' },
        { label: 'Cheques', href: `/${locale}/installments?from=menu` },
        {
          label: 'Other choices',
          href: '#',
          children: [
            { label: 'Generic support', href: '/support' },
            ...(['online', 'cheque', 'installment'] as const).map((kind) => ({
              label: `${kind} tagged menu`,
              href: `/catalog?method=${kind}`,
              purchaseMethodKind: kind,
            })),
          ],
        },
      ];
      const before = JSON.stringify(value);
      const menu = compile('components/content-menu.tsx', value);
      const shell = compile('components/shell.tsx', value, { './content-menu': menu });
      const header = render((shell.Header as () => Element)());
      const footer = render((shell.Footer as () => Element)());
      for (const tree of [header, footer]) {
        const links = hrefs(tree);
        assert.equal(links.some(installmentHref), enabled === 'cheque', `${locale}/${enabled}`);
        for (const path of [
          '/catalog',
          '/product/iphone-16',
          '/credit',
          '/credit/purchases',
          '/support',
        ])
          assert.ok(links.includes(path), `Missing retained path ${path} in ${locale}/${enabled}`);
        for (const kind of ['online', 'cheque', 'installment'])
          assert.equal(links.includes(`/catalog?method=${kind}`), enabled === kind);
      }
      const confidence = elements(footer).find(
        (node) => node.props.className === 'confidence container',
      );
      assert.ok(confidence);
      assert.equal(
        elements(confidence).some((node) => node.type === 'CreditCard'),
        enabled === 'cheque',
      );
      assert.equal(
        JSON.stringify(value),
        before,
        'Rendering must not rewrite the published CMS menu.',
      );
    }
  }
});

function homeSnapshot(locale: Locale, enabled: PurchaseMethod['kind'] | null) {
  const value = methodSnapshot(locale, enabled);
  value.site.hero = {
    ...value.site.hero,
    title: 'Generic hero',
    footnote: '',
    actionHref: '/installments',
    secondaryHref: '/catalog',
  };
  value.site.homeBlocks = [
    { id: 'categories', kind: 'categories', title: 'Generic categories', enabled: true },
    {
      id: 'generic-products',
      kind: 'products',
      title: 'Generic products',
      productIds: [value.products[0].id],
      enabled: true,
    },
    ...(['online', 'cheque', 'installment'] as const).map((kind, index) => ({
      id: `products-${kind}`,
      kind: 'products' as const,
      title: `${kind} product collection`,
      purchaseMethodKind: kind,
      productIds: [value.products[index + 1].id],
      enabled: true,
    })),
    {
      id: 'cheque-banner',
      kind: 'cheque',
      title: 'Cheque-only banner',
      href: '/installments',
      action: 'Cheque terms',
      enabled: true,
    },
    {
      id: 'promotions',
      kind: 'promotions',
      enabled: true,
      items: [
        {
          title: 'Generic promotion',
          eyebrow: '',
          action: 'Browse',
          href: '/catalog?promo=generic',
          image: '/products/console.svg',
        },
        ...(['online', 'cheque', 'installment'] as const).map((kind) => ({
          title: `${kind} promotion`,
          eyebrow: '',
          action: 'Browse',
          href: `/catalog?promo=${kind}`,
          image: '/products/console.svg',
          purchaseMethodKind: kind,
        })),
        {
          title: 'Direct calculator promotion',
          eyebrow: '',
          action: 'Terms',
          href: `/${locale}/installments?from=promo`,
          image: '/products/phone-silver.svg',
        },
      ],
    },
  ];
  return value;
}
function homeModule(value: StorefrontSnapshot, lookups: string[][] = []) {
  return compile('app/[locale]/page.tsx', value, {
    '@/lib/catalog-server': {
      async getCatalogProducts(_locale: string, input: { productIds: string[] }) {
        lookups.push([...input.productIds]);
        return value.products.filter((product) => input.productIds.includes(product.id));
      },
      async getCatalogPage() {
        throw Error('Unexpected broad catalog lookup');
      },
      async getCatalogFilters() {
        throw Error('Unexpected filters lookup');
      },
    },
  });
}

test('actual homepage SSR filters tagged collections and promotions before lookup without hiding generic catalog content or mutating CMS data', async () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const enabled of [null, 'online', 'cheque', 'installment'] as const) {
      const value = homeSnapshot(locale, enabled);
      const before = JSON.stringify(value);
      const lookups: string[][] = [];
      const home = homeModule(value, lookups);
      const tree = render(await (home.default as () => Promise<Element>)());
      const links = hrefs(tree);
      assert.equal(links.some(installmentHref), enabled === 'cheque');
      assert.ok(links.includes('/catalog'));
      assert.ok(links.includes('/catalog?promo=generic'));
      assert.ok(text(tree).includes('Generic products'));
      assert.ok(elements(tree).some((node) => node.props.className === 'category-section'));
      assert.equal(
        elements(tree).some((node) => node.props.className === 'cheque-banner'),
        enabled === 'cheque',
      );
      const expectedProductIds = [value.products[0].id];
      for (const [index, kind] of (['online', 'cheque', 'installment'] as const).entries()) {
        assert.equal(links.includes(`/catalog?promo=${kind}`), enabled === kind);
        assert.equal(text(tree).includes(`${kind} product collection`), enabled === kind);
        if (enabled === kind) expectedProductIds.push(value.products[index + 1].id);
      }
      assert.deepEqual(lookups.flat(), expectedProductIds);
      assert.equal(
        JSON.stringify(value),
        before,
        'Visibility must not rewrite a CMS document or method flag.',
      );
    }
  }
});

test('a method-specific hero follows its own global kind and keeps a page heading when hidden', async () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const kind of ['online', 'cheque', 'installment'] as const) {
      for (const enabled of [null, kind]) {
        const value = homeSnapshot(locale, enabled);
        value.site.hero.purchaseMethodKind = kind;
        const home = homeModule(value);
        const tree = render(await (home.default as () => Promise<Element>)());
        assert.equal(
          elements(tree).some((node) => node.props.className === 'hero'),
          enabled === kind,
        );
        assert.ok(
          elements(tree).some((node) => node.type === 'h1'),
          'Hiding a promotion must not remove the page heading.',
        );
      }
    }
  }
});

test('published support FAQs honor custom method metadata while order and support history remain available', () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const enabled of [null, 'online', 'cheque', 'installment'] as const) {
      const value = methodSnapshot(locale, enabled);
      const contentLoad = {
        status: 'ready',
        page: readSupportContent(
          {
            schemaVersion: 1,
            locale,
            revision: 1,
            content: {
              isDemo: false,
              eyebrow: '',
              title: 'Help',
              description: '',
              ticketsAction: 'Contact support',
              faqTitle: 'Questions',
              faqDescription: '',
              faqs: [
                {
                  id: '11111111111111111111111111111111',
                  question: 'Generic delivery question',
                  answer: 'Delivery details.',
                },
                ...(['online', 'cheque', 'installment'] as const).map((kind, index) => ({
                  id: String(index + 2).repeat(32),
                  question: `${kind} FAQ question`,
                  answer: 'Published plan details.',
                  purchaseMethodKind: kind,
                })),
              ],
            },
          },
          locale,
        ),
      };
      const before = JSON.stringify(contentLoad);
      const component = compile('components/support.tsx', value);
      const tree = render((component.Support as (props: unknown) => Element)({ contentLoad }));
      assert.equal(hrefs(tree).some(installmentHref), enabled === 'cheque');
      assert.ok(hrefs(tree).includes('/orders'));
      assert.ok(hrefs(tree).includes('/support/tickets'));
      assert.ok(text(tree).includes('Generic delivery question'));
      for (const kind of ['online', 'cheque', 'installment'])
        assert.equal(text(tree).includes(`${kind} FAQ question`), enabled === kind);
      assert.equal(JSON.stringify(contentLoad), before);
    }
  }
});

test('an opened preview support guide does not suggest cheque questions while the method is disabled', () => {
  for (const locale of ['fa', 'en'] as const) {
    const value = methodSnapshot(locale, null);
    value.dataSource = 'fixture';
    value.isPreview = true;
    const component = compile('components/support.tsx', value, {}, '', { 0: true });
    const tree = render((component.Support as (props: unknown) => Element)({}));
    assert.equal(hrefs(tree).some(installmentHref), false);
    const input = elements(tree).find((node) => node.type === 'input');
    assert.ok(input);
    assert.doesNotMatch(String(input.props.placeholder), /چک|cheque/i);
    assert.doesNotMatch(text(tree), /شرایط خرید چکی چگونه است|What are the cheque purchase terms/i);
  }
});

test('actual credit workspace can disable new drafts without removing a retained application list', () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const canCreate of [false, true]) {
      const value = methodSnapshot(locale, null);
      const id = '11111111111111111111111111111111';
      const page = creditApplications.creditApplicationPageSchema.parse({
        schemaVersion: 1,
        state: null,
        nextCursor: null,
        items: [
          {
            id,
            planId: 'legacy-plan',
            requestedAmountRial: '100000000',
            locale,
            state: 'Submitted',
            version: 'AAAAAAAAAAA=',
            createdAt: '2026-10-29T00:00:00Z',
            changedAt: '2026-10-29T00:00:00Z',
          },
        ],
      });
      let requests = 0;
      const component = compile(
        'components/credit-applications-workspace.tsx',
        value,
        {
          '../lib/request-generation': { advanceRequestGeneration },
          '../lib/credit-order-journal': {
            customerCreditOrderJournal: { subscribe: () => () => {}, snapshot: () => null },
          },
          '../lib/credit-application-contract': creditApplications,
          '../lib/money': money,
          '../lib/credit-application-form': { parseCreditRequestedToman },
          './credit-purchase-scope-panel': { CreditPurchaseScopePanel: 'CreditPurchaseScopePanel' },
          './credit-review-panel': { CreditReviewPanel: 'CreditReviewPanel' },
          './credit-submission-panel': { CreditSubmissionPanel: 'CreditSubmissionPanel' },
          './credit-documents-panel': { CreditDocumentsPanel: 'CreditDocumentsPanel' },
          './credit-consent-panel': { CreditConsentPanel: 'CreditConsentPanel' },
        },
        '',
        { 0: page },
      );
      const tree = render(
        (component.CreditApplicationsWorkspace as (props: unknown) => Element)({
          owner: '22222222222222222222222222222222',
          locale,
          canCreate,
          async transport() {
            requests++;
            throw Error('Render must not issue a request');
          },
        }),
      );
      assert.ok(text(tree).includes(id));
      assert.equal(
        elements(tree).some((node) => node.type === 'form'),
        canCreate,
      );
      assert.equal(
        elements(tree).some(
          (node) =>
            node.type === 'button' &&
            text(node) === (locale === 'fa' ? 'پیش‌نویس تازه' : 'New draft'),
        ),
        canCreate,
      );
      assert.equal(requests, 0);
    }
  }
});
