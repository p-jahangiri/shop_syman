import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
import { localeFormat, translate } from '../lib/navigation/i18n.ts';
import * as purchasing from '../lib/catalog/purchasing.ts';
import * as commerce from '@sayman/web-shared/lib/shared/commerce.ts';
import * as money from '@sayman/web-shared/lib/shared/money.ts';
import * as media from '@sayman/web-shared/lib/media/media-paths.ts';
import * as inspectionPhotos from '../lib/catalog/used-inspection-photos.ts';
import * as catalog from '../lib/catalog/catalog-contract.ts';
import * as homeBlocks from '../lib/content/home-blocks.ts';
import * as seo from '../lib/seo/seo.ts';
import * as identity from '@sayman/web-shared/lib/content/store-identity.ts';
import * as appearance from '@sayman/web-shared/lib/content/appearance.ts';
import * as creditApplications from '@sayman/web-shared/lib/credit/credit-application-contract.ts';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { parseCreditRequestedToman } from '@sayman/web-shared/lib/credit/credit-application-form.ts';
import { readSupportContent } from '@sayman/web-shared/lib/content/support-content-contract.ts';
import { accountReturnTo, normalizeOrderDigits } from '@sayman/web-shared/lib/orders/order-form.ts';
import * as otpContract from '../lib/auth/customer-otp-contract.ts';
import type {
  Locale,
  PurchaseMethod,
  StorefrontSnapshot,
} from '@sayman/web-shared/lib/shared/types.ts';

// Compile actual TSX render paths in memory. Hook/session substitutes are test-only;
// these assertions neither authenticate a browser nor make API/database requests.
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
    useId: () => 'purchase-ui-test',
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
    '@/components/navigation/locale-provider': i18n,
    './locale-provider': i18n,
    '../navigation/locale-provider': i18n,
    '@/components/navigation/localized-link': links,
    './localized-link': links,
    '../navigation/localized-link': links,
    '@/components/media/content-image': { default: 'Image' },
    '../shared/ui': ui,
    '../orders/returns-policy': { ReturnsPolicy: 'ReturnsPolicy' },
    '@/components/shared/ui': ui,
    '../providers/shop-provider': {
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
    '@sayman/web-shared/components/catalog/used-condition': {
      UsedConditionReport: 'UsedConditionReport',
    },
    './product-reviews': { ProductReviews: 'ProductReviews' },
    '../catalog/product-card': { ProductGrid: 'ProductGrid' },
    './product-card': { ProductGrid: 'ProductGrid' },
    './recently-viewed': { RecentlyViewed: 'RecentlyViewed' },
    './connected-account': { ConnectedAccount: 'ConnectedAccount' },
    '../auth/customer-otp-login': { CustomerOtpLogin: 'CustomerOtpLogin' },
    '@/lib/auth/customer-otp-contract': otpContract,
    './sourcing': {
      SourcingDrawerLink: 'SourcingDrawerLink',
      SourcingCartIndicator: 'SourcingCartIndicator',
    },
    '../checkout/cart-summary': { CartAmount: 'CartAmount', CartCheckoutLink: 'CartCheckoutLink' },
    '../checkout/accepted-cart-groups': { AcceptedCartGroups: 'AcceptedCartGroups' },
    '../checkout/cart-command-notice': { CartCommandNotice: 'CartCommandNotice' },
    './language-switch': { LanguageSwitch: 'LanguageSwitch' },
    '../catalog/category-icon': { CatalogCategoryIcon: 'CatalogCategoryIcon' },
    '@/lib/checkout/cart-v2-contract': { cartV2BuyCount: () => 0, cartV2HasBuyLines: () => false },
    '@/lib/catalog/catalog-contract': catalog,
    '@/lib/catalog/catalog-client': {
      async searchProducts() {
        throw Error('Unexpected catalog request in render');
      },
    },
    '@/lib/navigation/server-locale': {
      getLocale: async () => locale,
      serverI18n: async () => ({ ...value, ...i18n.useI18n() }),
    },
    '@/lib/content/home-blocks': homeBlocks,
    '@/lib/seo/seo': seo,
    '@/components/catalog/product-card': { ProductGrid: 'ProductGrid' },
    '@/components/catalog/recently-viewed': { RecentlyViewed: 'RecentlyViewed' },
    '@/components/content/home-collection': { HomeCollection: 'HomeCollection' },
    '@/components/guides/guide-discovery': { GuideDiscovery: 'GuideDiscovery' },
    '@/components/shopping/shopping.css': {},
    '@/components/magazine/magazine-discovery': { MagazineDiscovery: 'MagazineDiscovery' },
    '@/components/budget-finder/budget-finder-link': { BudgetFinderLink: 'BudgetFinderLink' },
    './home-page.css': {},
    './shop-navigation.css': {},
    '../content/store-identity-footer': { StoreSocialLinks: 'StoreSocialLinks' },
    '@/components/catalog/spotlight': { Spotlight: 'Spotlight' },
    '@/lib/catalog/purchasing': purchasing,
    '@sayman/web-shared/lib/shared/commerce.ts': commerce,
    '@sayman/web-shared/lib/content/store-identity.ts': identity,
    '@sayman/web-shared/lib/content/appearance.ts': appearance,
    '@sayman/web-shared/lib/shared/money.ts': money,
    '@sayman/web-shared/lib/media/media-paths.ts': media,
    '@/lib/catalog/used-inspection-photos': inspectionPhotos,
    '@sayman/web-shared/lib/orders/order-form.ts': { accountReturnTo },
    ...overrides,
  };
  const source =
    fs.readFileSync(
      new URL(import.meta.resolve(file.startsWith('@') ? file : '../' + file)),
      'utf8',
    ) + extra;
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
      '@/lib/navigation/server-locale': {
        serverI18n: async () => ({
          ...value,
          ...{
            t: <T>(source: T) => translate(source, locale),
          },
        }),
      },
      '@/lib/catalog/catalog-server': {
        async getCatalogProducts() {
          lookups++;
          return value.products;
        },
      },
      '@/lib/catalog/catalog-contract': catalog,
      '@/components/credit/installments': { Installments: 'Installments' },
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

test('published CMS link blocks omit disabled cheque links and headings with no remaining links', () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const enabled of [false, true]) {
      const value = enabled ? chequeEnabled(snapshot(locale)) : snapshot(locale);
      const { CmsPageView } = compile('@sayman/web-shared/components/content/cms-page-view', value);
      const component = CmsPageView as (props: unknown) => Element;
      const content = {
        title: 'Editorial page',
        description: '',
        blocks: [
          {
            id: 'mixed',
            kind: 'Links',
            visibility: 'All',
            heading: 'Explore',
            links: [
              { href: '/catalog', label: 'Products' },
              { href: '/installments', label: 'Cheque calculator' },
            ],
          },
          {
            id: 'cheque-only',
            kind: 'Links',
            visibility: 'All',
            heading: 'Cheque guide',
            links: [{ href: '/catalog?method=cheque', label: 'Cheque offers' }],
          },
        ],
      };
      const tree = render(
        component({
          content,
          locale,
          link: (href: string, label: string) => ({ type: 'a', props: { href, children: label } }),
          canLink: (href: string) => purchasing.isPurchaseHrefEnabled(href, value.purchaseMethods),
        }),
      );
      assert.ok(hrefs(tree).includes('/catalog'));
      assert.equal(hrefs(tree).includes('/installments'), enabled);
      assert.equal(hrefs(tree).includes('/catalog?method=cheque'), enabled);
      assert.equal(text(tree).includes('Cheque guide'), enabled);
      assert.equal(content.blocks[1].links.length, 1);
    }
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
    '@/lib/navigation/server-locale': {
      serverI18n: async () => ({ ...value, t: (source: unknown) => source }),
    },
    '@/lib/catalog/catalog-server': {
      async getCatalogProducts() {
        lookups++;
        return [value.products[0]];
      },
    },
    '@/lib/catalog/catalog-contract': catalog,
    '@/components/credit/installments': { Installments: 'Installments' },
  });
  const tree = await (route.default as (props: unknown) => Promise<Element>)({
    searchParams: Promise.resolve({ product: 'iphone-16' }),
  });
  assert.equal(lookups, 1);
  assert.ok(elements(tree).some((node) => node.type === 'Installments'));
});

test('the calculator component does not show promotional terms or inputs when cheque purchasing is disabled', () => {
  for (const locale of ['fa', 'en'] as const) {
    const component = compile('components/credit/installments.tsx', snapshot(locale));
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
    assert.doesNotMatch(text(tree), /چکی|cheque/i);
  }
});

test('a valid amount without an eligible plan does not become a zero-percent repayment offer', () => {
  const value = chequeEnabled(snapshot());
  value.chequePlans = [];
  const component = compile('components/credit/installments.tsx', value);
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
    value.isPreview = true;
    value.dataSource = preview ? 'fixture' : 'api';
    const component = compile('components/credit/installments.tsx', value);
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
  const component = compile('components/catalog/product-detail.tsx', value);
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
  const component = compile('components/catalog/product-detail.tsx', value);
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
    const component = compile(
      'components/account/account.tsx',
      value,
      {},
      '\nexport { PreviewAccount };',
    );
    const tree = (component.PreviewAccount as () => Element)();
    assert.equal(
      elements(tree).some((node) => node.props.href === '/installments'),
      enabled,
    );
  }
});

test('a connected customer keeps cheque-history and order access even when new cheque purchasing is disabled', () => {
  const value = snapshot();
  const auth = {
    '../auth/auth-provider': {
      useCustomerSession: () => ({
        status: 'member',
        session: { user: { id: 'member', displayName: 'Customer' } },
        store: { viewRevision: () => 0 },
      }),
    },
  };
  const workspace = compile('components/account/customer-account-workspace.tsx', value, {
    ...auth,
    './account-settings': { AccountSettings: 'AccountSettings' },
    '@/lib/account/account-overview': { loadAccountOverview() {} },
    '@/lib/account/customer-account-client': { readCustomerAccount() {} },
    '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
    './customer-account-workspace.css': {},
  });
  const component = compile('components/account/connected-account.tsx', value, {
    ...auth,
    './customer-account-workspace': workspace,
  });
  const tree = render((component.ConnectedAccount as () => Element)());
  assert.ok(elements(tree).some((node) => node.props.href === '/credit'));
  assert.ok(elements(tree).some((node) => node.props.href === '/orders'));
  assert.match(text(tree), /سوابق.*خرید چکی/);
});

test('retained cheque calculations cannot start a new order after their method is disabled', () => {
  for (const enabled of [false, true]) {
    const value = enabled ? chequeEnabled(snapshot()) : snapshot();
    const method = value.purchaseMethods.find(({ kind }) => kind === 'cheque')!;
    const component = compile(
      'components/credit/customer-credit-purchases.tsx',
      value,
      {
        '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
        '../auth/auth-provider': { useCustomerSession: () => ({ store: {} }) },
        '../providers/shop-context': { useShop: () => ({ retry() {} }) },
        '@sayman/web-shared/lib/credit/credit-order-contract.ts': {},
        '@sayman/web-shared/lib/credit/credit-checkout-quote-contract.ts': {},
        '@sayman/web-shared/lib/credit/credit-order-journal.ts': {
          customerCreditOrderJournal: { subscribe() {}, snapshot: () => null },
        },
        './credit-checkout-quote-panel': { CreditCheckoutQuoteSnapshot: 'RetainedCalculation' },
        './credit-order-form': { CreditOrderForm: 'NewChequeOrder' },
        '@sayman/web-shared/lib/shared/money.ts': money,
      },
      '\nexport { CreditPurchaseHistory };',
      { 2: { ordinaryQuote: { selectedMethod: method } } },
    );
    const tree = (component.CreditPurchaseHistory as (props: unknown) => Element)({
      owner: 'member',
    });
    assert.ok(elements(tree).some(({ type }) => type === 'RetainedCalculation'));
    assert.equal(
      elements(tree).some(({ type }) => type === 'NewChequeOrder'),
      enabled,
    );
  }
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
      const menu = compile('components/navigation/content-menu.tsx', value);
      const shell = compile('components/navigation/shell.tsx', value, {
        './content-menu': menu,
        '../content/store-identity-footer': { StoreIdentityFooter: () => null },
      });
      const header = render((shell.Header as () => Element)());
      const footer = render((shell.Footer as () => Element)());
      const notifications = elements(header).find((node) => node.props.href === '/notifications');
      assert.ok(notifications?.props['aria-label']);
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

test('the actual footer renders a direct-contact address only for populated fields', () => {
  for (const locale of ['fa', 'en'] as const) {
    const value = methodSnapshot(locale, 'online');
    const footer = () => {
      const menu = compile('components/navigation/content-menu.tsx', value);
      const shell = compile('components/navigation/shell.tsx', value, {
        './content-menu': menu,
        '../content/store-identity-footer': { StoreIdentityFooter: () => null },
      });
      return render((shell.Footer as () => Element)());
    };
    value.site.contact = { phone: '  ', address: '', hours: '  ' };
    assert.equal(
      elements(footer()).some((node) => node.type === 'address'),
      false,
    );
    value.site.contact = { phone: '+98 (21) 1234-5678', address: '  ' };
    value.isPreview = true; // The API snapshot still has the indexing guard enabled.
    const addresses = elements(footer()).filter((node) => node.type === 'address');
    assert.equal(addresses.length, 1);
    assert.deepEqual(hrefs(addresses[0]), ['tel:+982112345678']);
    assert.doesNotMatch(text(footer()), /این نسخه برای بررسی فروشگاه است|preview|example prices/i);
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
    '@/lib/catalog/catalog-server': {
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

test('homepage preserves the published collection scope, limit and action without a storewide preview notice', async () => {
  const value = homeSnapshot('en', 'online');
  const [first, second] = value.products;
  value.site.homeBlocks = [
    {
      id: 'edit',
      kind: 'collection',
      enabled: true,
      productIds: [first.id, second.id],
      categoryId: first.category,
      limit: 1,
      title: 'Phone picks',
      description: 'Published collection details',
      action: 'Explore this edit',
      href: '/pages/phone-edit',
    },
  ];
  const home = homeModule(value);
  const tree = render(await (home.default as () => Promise<Element>)());
  const collection = elements(tree).find((node) => node.type === 'HomeCollection');
  assert.equal(collection?.props.categoryId, first.category);
  assert.equal(collection?.props.pageSize, 1);
  assert.equal(collection?.props.href, '/pages/phone-edit');
  assert.equal(collection?.props.description, 'Published collection details');
  assert.deepEqual(collection?.props.initialProducts, [first]);
  assert.ok(elements(tree).every((node) => node.props.className !== 'preview-note'));

  const collectionModule = compile('components/content/home-collection.tsx', value);
  const content = render(
    (collectionModule.HomeCollection as (props: unknown) => Element)(collection?.props),
  );
  assert.ok(hrefs(content).includes('/pages/phone-edit'));
  assert.ok(text(content).includes('Published collection details'));
  assert.ok(elements(content).every((node) => node.props.role !== 'tablist'));
});

test('homepage exposes available brands through the catalog facet and hides an empty brand block', async () => {
  for (const locale of ['fa', 'en'] as const) {
    const value = homeSnapshot(locale, 'online');
    value.site.homeBlocks = [{ id: 'brands', kind: 'brands', enabled: true }];
    for (const brands of [[], [{ id: 'brand-123', name: 'Samsung' }]]) {
      const home = compile('app/[locale]/page.tsx', value, {
        '@/lib/catalog/catalog-server': { getCatalogFilters: async () => ({ brands }) },
      });
      const tree = render(await (home.default as () => Promise<Element>)());
      assert.equal(hrefs(tree).includes('/catalog?brand=brand-123'), brands.length > 0);
      assert.equal(
        elements(tree).some((node) => node.props['data-wordmark'] === 'samsung'),
        brands.length > 0,
      );
      assert.equal(
        elements(tree).some((node) => node.props.className === 'brands-section'),
        brands.length > 0,
      );
    }
  }
});

test('homepage separates the used catalog link from automatic new-product collections', async () => {
  for (const locale of ['fa', 'en'] as const) {
    const value = homeSnapshot(locale, 'online');
    value.site.homeBlocks = [
      { id: 'categories', kind: 'categories', enabled: true },
      { id: 'collection', kind: 'collection', enabled: true },
    ];
    const conditions: unknown[] = [];
    const home = compile('app/[locale]/page.tsx', value, {
      '@/lib/catalog/catalog-server': {
        getCatalogPage: async (_locale: unknown, query: { condition?: string }) => {
          conditions.push(query.condition);
          return { products: [] };
        },
      },
    });
    const tree = render(await (home.default as () => Promise<Element>)());
    const used = elements(tree).find((node) => node.props.href === '/catalog?condition=used');
    assert.ok(text(used).includes(locale === 'fa' ? 'کالاهای کارکرده' : 'Used products'));
    assert.ok(hrefs(tree).includes(`/catalog?category=${value.categories[0].key}`));
    assert.deepEqual(conditions, ['new']);
  }
});

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
      const component = compile('components/support/support.tsx', value);
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

test('connected support shows published LinkedIn and omits sample commercial terms', () => {
  for (const locale of ['fa', 'en'] as const) {
    const value = methodSnapshot(locale, 'online');
    const profile = 'https://www.linkedin.com/company/sayman';
    value.site.storeIdentity = {
      demonstration: true,
      socialLinks: [
        { platform: 'linkedin', url: profile, enabled: true },
        { platform: 'whatsapp', url: '', enabled: false },
      ],
    };
    const component = compile('components/support/support.tsx', value, {
      '../content/store-identity-footer': {
        StoreSocialLinks: ({ links }: { links: { url: string }[] }) =>
          links.map(({ url }) => ({ type: 'a', props: { href: url } })),
      },
    });
    const tree = render(
      (component.Support as (props: unknown) => Element)({
        contentLoad: {
          status: 'ready',
          page: { content: { isDemo: true, title: 'Test commercial terms' } },
        },
      }),
    );
    assert.ok(hrefs(tree).includes(profile));
    assert.ok(hrefs(tree).includes('/support/tickets'));
    assert.doesNotMatch(text(tree), /Test commercial terms|Development sample|محتوای نمونهٔ توسعه/);
  }
});

test('an opened preview support guide does not suggest cheque questions while the method is disabled', () => {
  for (const locale of ['fa', 'en'] as const) {
    const value = methodSnapshot(locale, null);
    value.dataSource = 'fixture';
    value.isPreview = true;
    const component = compile('components/support/support.tsx', value, {}, '', { 0: true });
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
        '@sayman/web-shared/components/credit/credit-applications-workspace',
        value,
        {
          '../../lib/data/request-generation': { advanceRequestGeneration },
          '../../lib/credit/credit-order-journal': {
            customerCreditOrderJournal: { subscribe: () => () => {}, snapshot: () => null },
          },
          '../../lib/credit/credit-application-contract': creditApplications,
          '../../lib/shared/money': money,
          '../../lib/orders/order-form': { normalizeOrderDigits },
          '../../lib/credit/credit-application-form': { parseCreditRequestedToman },
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
