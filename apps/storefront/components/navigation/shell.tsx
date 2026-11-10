'use client';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import { StoreIdentityFooter } from '../content/store-identity-footer';
import { CartAmount, CartCheckoutLink } from '../checkout/cart-summary';
import { AcceptedCartGroups } from '../checkout/accepted-cart-groups';
import { CartCommandNotice } from '../checkout/cart-command-notice';
import { cartV2BuyCount, cartV2HasBuyLines } from '@/lib/checkout/cart-v2-contract';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import { searchProducts } from '@/lib/catalog/catalog-client';
import { catalogInputSchema, type CatalogSearchSuggestion } from '@/lib/catalog/catalog-contract';
import type { MenuItem, Product } from '@sayman/web-shared/lib/shared/types.ts';
import { isUsedCatalogHref } from '@sayman/web-shared/lib/content/appearance.ts';
import { LanguageSwitch } from './language-switch';
import { ContentMenu } from './content-menu';
import { CatalogCategoryIcon } from '../catalog/category-icon';
import { filterPurchaseMenu, isPurchaseKindEnabled } from '@/lib/catalog/purchasing';
import Image from '@/components/media/content-image';
import { usePathname, useRouter } from '@/components/navigation/localized-link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpLeft,
  Search,
  ShoppingBag,
  UserRound,
  Bell,
  Heart,
  Menu,
  Sun,
  Moon,
  Grid2X2,
  Home,
  GitCompareArrows,
  Headphones,
  ShieldCheck,
  CreditCard,
  PackageCheck,
  Smartphone,
  X,
  Plus,
  Minus,
  Trash2,
} from 'lucide-react';
import { findVariant } from '@sayman/web-shared/lib/shared/commerce.ts';
import { useShop } from '../providers/shop-provider';
import { Button, Modal } from '../shared/ui';
import './shop-navigation.css';

function filterUsedCatalogMenu(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => {
    if (isUsedCatalogHref(item.href)) return [];
    if (!item.children?.length) return [item];
    const children = filterUsedCatalogMenu(item.children);
    return !children.length && item.href === '#' ? [] : [{ ...item, children }];
  });
}

export function Brand() {
  const { t } = useI18n();
  const { site } = useStorefront();
  const logoUrl = site.logoUrl || '/products/sayman-mark-olive-v1.png';
  const saymanMark = logoUrl === '/products/sayman-mark-olive-v1.png';
  return (
    <Link href="/" className="brand" aria-label={t('سایمان، صفحه اصلی')}>
      <span className={`brand-mark${saymanMark ? ' brand-mark--sayman' : ''}`}>
        <Image
          src={saymanMark ? '/products/sayman-mark-olive-v1-128.webp' : logoUrl}
          alt=""
          width={50}
          height={50}
          sizes="50px"
          unoptimized={saymanMark}
          loading="eager"
        />
      </span>
      <span>
        {t(site.name)}
        <small>{t(site.latinName)}</small>
      </span>
    </Link>
  );
}
export function Header() {
  const { t, digits, locale } = useI18n();
  const { site, categories, purchaseMethods } = useStorefront();
  const chequeEnabled = isPurchaseKindEnabled(purchaseMethods, 'cheque');
  const showUsed = site.appearance?.showUsedProducts !== false;
  const purchaseMenu = filterPurchaseMenu(site.nav, purchaseMethods);
  const menuItems = showUsed ? purchaseMenu : filterUsedCatalogMenu(purchaseMenu);
  const usedHref = '/catalog?condition=used';
  const usedLabel = locale === 'fa' ? 'کالاهای کارکرده' : 'Used products';
  const hasUsedMenu = menuItems.some((item) => isUsedCatalogHref(item.href));
  const categoryLinks = categories.map((category) => ({
    label: category.name,
    href: `/catalog?category=${encodeURIComponent(category.key)}`,
    categoryKey: category.key,
  }));
  const categoryKeys = new Map(categoryLinks.map(({ href, categoryKey }) => [href, categoryKey]));
  const categoryMenu = [{ label: t('همهٔ دسته‌ها'), href: '/catalog', children: categoryLinks }];
  const categoryIcon = (item: MenuItem) => {
    const key = categoryKeys.get(item.href);
    return key === undefined ? (
      <Grid2X2 size={17} />
    ) : (
      <CatalogCategoryIcon categoryKey={key} size={17} />
    );
  };
  const notificationsLabel = locale === 'fa' ? 'اعلان‌های من' : 'My notifications';
  const { cart, serverCart, wishlist, setCartOpen, ready } = useShop();
  const [query, setQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [menu, setMenu] = useState(false),
    [dark, setDark] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const searchContainer = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!searchOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchContainer.current?.contains(event.target))
        setSearchOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        event.target instanceof Node &&
        searchContainer.current?.contains(event.target)
      ) {
        searchInput.current?.focus();
        setSearchOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [searchOpen]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.code !== 'KeyK' ||
        document.querySelector('[role="dialog"]')
      )
        return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);
  const defaultTheme = site.design?.theme ?? 'system';
  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const root = document.documentElement;
      let saved = root.dataset.themePreference;
      try {
        saved ??= localStorage.getItem('sayman:theme') ?? undefined;
      } catch {
        /* The cookie-backed preference is already available on the root. */
      }
      const selected = saved === 'dark' || saved === 'light' ? saved : defaultTheme;
      const dark = selected === 'system' ? preference.matches : selected === 'dark';
      setDark(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (defaultTheme === 'system') preference.addEventListener('change', apply);
    return () => preference.removeEventListener('change', apply);
  }, [defaultTheme]);
  useEffect(() => {
    setMenu(false);
    setSearchOpen(false);
  }, [pathname]);
  const count = serverCart ? cartV2BuyCount(serverCart) : cart.reduce((s, x) => s + x.quantity, 0);
  const [results, setResults] = useState<{ product: Product; variantId: string }[]>([]);
  const [suggestion, setSuggestion] = useState<CatalogSearchSuggestion>();
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const term = query.trim();
  const searchValid = catalogInputSchema.safeParse({ query: term }).success;
  const showResults = searchOpen && Boolean(term);
  useEffect(() => {
    setResults([]);
    setSuggestion(undefined);
    setSearchError(false);
    if (!searchOpen || !term || !searchValid) {
      setSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    setSearchBusy(true);
    const timer = setTimeout(() => {
      searchProducts(
        locale,
        { query: term, pageSize: 4, condition: showUsed ? undefined : 'new' },
        controller.signal,
      )
        .then((page) => {
          if (!controller.signal.aborted) {
            setResults(
              page.products.map((product) => ({
                product,
                variantId: page.matchingVariantIds[product.id],
              })),
            );
            setSuggestion(page.suggestion);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearchError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, locale, searchOpen, searchValid, showUsed]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!searchValid || !term) return;
    setSearchOpen(false);
    router.push(`/catalog?q=${encodeURIComponent(term)}`);
  }
  function theme() {
    const value = !dark;
    setDark(value);
    const selected = value ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    document.documentElement.dataset.themePreference = selected;
    document.cookie = `sayman-theme=${selected}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    try {
      localStorage.setItem('sayman:theme', selected);
    } catch {
      /* Storage can be unavailable; the current tab still uses the selected theme. */
    }
  }
  return (
    <>
      {site.announcement?.trim() && (
        <div className="announcement">
          <div className="container">
            <span>{t(site.announcement)}</span>
          </div>
        </div>
      )}
      <header className="header">
        <div className="container header-main">
          <button
            ref={menuTrigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={menu}
            className="icon-button mobile-menu"
            onClick={() => setMenu(true)}
            aria-label={t('باز کردن منو')}
          >
            <Menu />
          </button>
          <Brand />
          <div
            className="search-wrap"
            ref={searchContainer}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
                setSearchOpen(false);
            }}
          >
            <form className="search-box" onSubmit={submit} role="search">
              <Search className="search-leading-icon" size={19} aria-hidden="true" />
              <input
                ref={searchInput}
                id="storefront-search"
                name="q"
                maxLength={200}
                enterKeyHint="search"
                aria-invalid={!searchValid || undefined}
                aria-describedby={
                  searchOpen && !searchValid ? 'storefront-search-error' : undefined
                }
                aria-label={t('جست‌وجوی محصولات')}
                aria-controls={showResults ? 'storefront-search-results' : undefined}
                placeholder={locale === 'fa' ? 'نام کالا، مدل یا برند' : 'Product, model or brand'}
                value={query}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
              />
              {query && (
                <button
                  type="button"
                  className="icon-button search-clear"
                  onClick={() => {
                    setQuery('');
                    searchInput.current?.focus();
                    setSearchOpen(false);
                  }}
                  aria-label={t('پاک کردن جست‌وجو')}
                >
                  <X size={16} />
                </button>
              )}
              <button
                type="submit"
                className="search-submit"
                aria-label={t('جست‌وجوی محصولات')}
                disabled={!searchValid || !term}
              >
                {locale === 'fa' ? 'جست‌وجو' : 'Search'}
              </button>
            </form>
            {t(
              showResults && (
                <div className="search-results" id="storefront-search-results">
                  <div className="search-results-heading">
                    <span>{t('پیشنهادهای جست‌وجو')}</span>
                    <button
                      className="icon-button"
                      onClick={() => {
                        searchInput.current?.focus();
                        setSearchOpen(false);
                      }}
                      aria-label={t('بستن پیشنهادها')}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {t(
                    !searchValid ? (
                      <p id="storefront-search-error" role="status">
                        {locale === 'fa'
                          ? 'عبارت جست‌وجو می‌تواند حداکثر ۸ واژهٔ متفاوت داشته باشد.'
                          : 'Use no more than eight distinct search words.'}
                      </p>
                    ) : results.length ? (
                      results.map(({ product: p, variantId }) => (
                        <Link
                          key={p.id}
                          href={`/product/${p.slug}?variant=${encodeURIComponent(variantId)}`}
                          onClick={() => setSearchOpen(false)}
                        >
                          <Image src={p.image} width={48} height={40} alt="" />
                          <span>{t(p.name)}</span>
                          <ArrowUpLeft size={15} />
                        </Link>
                      ))
                    ) : suggestion ? (
                      <Link
                        href={`/catalog?q=${encodeURIComponent(suggestion.query)}`}
                        className="search-correction"
                        onClick={() => {
                          setQuery(suggestion.query);
                          setSearchOpen(false);
                        }}
                      >
                        <Search size={16} aria-hidden="true" />
                        <span>
                          {locale === 'fa' ? 'پیشنهاد جست‌وجو' : 'Suggested search'}{' '}
                          <bdi>{suggestion.query}</bdi>
                        </span>
                        <small>
                          {digits(suggestion.total)} {t('محصول')}
                        </small>
                      </Link>
                    ) : (
                      <p role="status">
                        {t(
                          searchBusy
                            ? 'در حال دریافت محصولات…'
                            : searchError
                              ? 'دریافت محصولات انجام نشد.'
                              : 'محصولی پیدا نشد. نام یا برند دیگری را امتحان کن.',
                        )}
                      </p>
                    ),
                  )}
                  {searchValid && (
                    <Link
                      href={`/catalog?q=${encodeURIComponent(term)}`}
                      onClick={() => setSearchOpen(false)}
                      className="search-all"
                    >
                      {t('مشاهدهٔ همهٔ نتایج')}
                      <ArrowLeft size={16} />
                    </Link>
                  )}
                </div>
              ),
            )}
          </div>
          <div className="header-actions">
            <LanguageSwitch />
            <button
              onClick={theme}
              className="icon-button theme-toggle"
              aria-label={dark ? t('فعال کردن حالت روشن') : t('فعال کردن حالت تاریک')}
            >
              {t(dark ? <Sun size={20} /> : <Moon size={20} />)}
            </button>
            <Link
              href="/wishlist"
              className="icon-button wishlist-header"
              aria-label={t('علاقه‌مندی‌ها{0}', [ready ? t('، {0} کالا', [wishlist.length]) : ''])}
            >
              <Heart size={21} />
              {t(ready && wishlist.length > 0 && <i className="tiny-dot" />)}
            </Link>
            <Link
              href="/notifications"
              prefetch={false}
              className="icon-button notifications-header"
              aria-label={notificationsLabel}
              aria-current={pathname === '/notifications' ? 'page' : undefined}
              title={notificationsLabel}
            >
              <Bell size={20} aria-hidden="true" />
            </Link>
            <Link href="/account" className="account-link">
              <UserRound size={21} />
              <span>{t('حساب کاربری')}</span>
            </Link>
            <span className="header-divider" />
            <button
              className="cart-header"
              onClick={() => setCartOpen(true)}
              aria-label={t('سبد خرید{0}', [ready ? t('، {0} کالا', [digits(count)]) : ''])}
            >
              <ShoppingBag size={21} />
              {t(ready && count > 0 && <span className="count-badge">{t(digits(count))}</span>)}
            </button>
          </div>
        </div>
        <div className="container nav-row">
          <nav aria-label={t('منوی اصلی')}>
            <div className="all-categories category-menu">
              <ContentMenu items={categoryMenu} iconFor={categoryIcon} />
            </div>
            <span className="nav-divider" />
            <ContentMenu items={menuItems} />
            {showUsed && !hasUsedMenu && (
              <Link href={usedHref} className="nav-used">
                <PackageCheck size={16} aria-hidden="true" />
                {usedLabel}
              </Link>
            )}
            {chequeEnabled && (
              <Link
                href="/installments"
                className="nav-credit"
                aria-current={pathname === '/installments' ? 'page' : undefined}
              >
                <CreditCard size={16} aria-hidden="true" />
                {t('خرید چکی')}
              </Link>
            )}
          </nav>
          <Link href="/support" className="support-link">
            <Headphones size={16} />
            {t('راهنما و پشتیبانی')}
          </Link>
        </div>
      </header>
      <Modal
        open={menu}
        onOpenChange={setMenu}
        title={t('به سایمان خوش آمدید')}
        className="mobile-menu-drawer"
        restoreFocusRef={menuTrigger}
        drawer
      >
        <div className="mobile-menu-intro">
          <Brand />
          <p>{site.tagline}</p>
        </div>
        <nav className="mobile-links" aria-label={t('منوی اصلی')}>
          <Link
            href="/"
            aria-current={pathname === '/' ? 'page' : undefined}
            onClick={() => setMenu(false)}
          >
            <Home size={19} />
            {t('خانه')}
          </Link>
          <div className="category-menu">
            <ContentMenu
              items={categoryMenu}
              iconFor={categoryIcon}
              onNavigate={() => setMenu(false)}
            />
          </div>
          <ContentMenu items={menuItems} onNavigate={() => setMenu(false)} />
          {showUsed && !hasUsedMenu && (
            <Link href={usedHref} className="nav-used" onClick={() => setMenu(false)}>
              <PackageCheck size={19} aria-hidden="true" />
              {usedLabel}
            </Link>
          )}
          {chequeEnabled && (
            <Link
              href="/installments"
              className="nav-credit"
              aria-current={pathname === '/installments' ? 'page' : undefined}
              onClick={() => setMenu(false)}
            >
              <CreditCard size={19} aria-hidden="true" />
              {t('خرید چکی')}
            </Link>
          )}
          <Link href="/compare" onClick={() => setMenu(false)}>
            {t('مقایسهٔ محصولات')}
          </Link>
          <Link href="/support" onClick={() => setMenu(false)}>
            {t('راهنما و پشتیبانی')}
          </Link>
          <Link href="/install" onClick={() => setMenu(false)}>
            <Smartphone size={19} aria-hidden="true" />
            {locale === 'fa' ? 'نصب فروشگاه' : 'Install the store'}
          </Link>
        </nav>
        <div className="mobile-menu-footer">
          <Link href="/account" onClick={() => setMenu(false)}>
            <UserRound size={19} />
            {t('حساب کاربری')}
          </Link>
          <LanguageSwitch />
        </div>
      </Modal>
    </>
  );
}
export function Footer() {
  const { t, locale } = useI18n();
  const { dataSource, isPreview, site, purchaseMethods } = useStorefront();
  const fa = locale === 'fa';
  const chequeEnabled = isPurchaseKindEnabled(purchaseMethods, 'cheque');
  const purchaseMenu = filterPurchaseMenu(site.nav, purchaseMethods);
  const menuItems =
    site.appearance?.showUsedProducts === false
      ? filterUsedCatalogMenu(purchaseMenu)
      : purchaseMenu;
  const phone = site.contact?.phone?.trim();
  const email = site.contact?.email?.trim();
  const address = site.contact?.address?.trim();
  const hours = site.contact?.hours?.trim();
  return (
    <>
      <section className="confidence container">
        <div>
          <ShieldCheck />
          <span>
            <strong>{t('انتخاب با اطمینان')}</strong>
            <small>{t('جزئیات گارانتی کنار هر کالا')}</small>
          </span>
        </div>
        {chequeEnabled && (
          <div>
            <CreditCard />
            <span>
              <strong>{t('خرید متناسب با شما')}</strong>
              <small>{t('بررسی شرایط پرداخت چکی')}</small>
            </span>
          </div>
        )}
        <div>
          <PackageCheck />
          <span>
            <strong>{t('پیگیری در هر مرحله')}</strong>
            <small>{t('از انتخاب تا دریافت سفارش')}</small>
          </span>
        </div>
        <div>
          <Headphones />
          <span>
            <strong>{t('کنارتان هستیم')}</strong>
            <small>{t('راهنمایی برای انتخاب بهتر')}</small>
          </span>
        </div>
      </section>
      <footer className="footer storefront-footer">
        <div className="container footer-grid">
          <div className="footer-about">
            <Brand />
            <p>{t(site.about)}</p>
            {(phone || email || address || hours) && (
              <address className="store-contact">
                {phone && (
                  <a dir="ltr" href={`tel:${phone.replace(/[^0-9+]/g, '')}`}>
                    {phone}
                  </a>
                )}
                {email && (
                  <a dir="ltr" href={`mailto:${email}`}>
                    {email}
                  </a>
                )}
                {address && <span>{address}</span>}
                {hours && <small>{hours}</small>}
              </address>
            )}
          </div>
          <div>
            <h3>{t('کشف سایمان')}</h3>
            {!menuItems.some(({ href }) => href === '/catalog') && (
              <Link href="/catalog">{fa ? 'همهٔ کالاها' : 'All products'}</Link>
            )}
            <ContentMenu items={menuItems} />
          </div>
          <div>
            <h3>{t('همراه شما')}</h3>
            {chequeEnabled && <Link href="/installments">{t('راهنمای خرید چکی')}</Link>}
            <Link href="/support">{fa ? 'راهنما و پشتیبانی' : 'Help and support'}</Link>
            <Link href={dataSource === 'api' ? '/orders' : '/account?tab=orders'}>
              {t('پیگیری سفارش')}
            </Link>
            <Link href="/install">{fa ? 'نصب و مرور آفلاین' : 'Install and browse offline'}</Link>
          </div>
          <div className="footer-identity">
            <StoreIdentityFooter value={site.storeIdentity} locale={locale} part="social" />
            <StoreIdentityFooter
              value={site.storeIdentity}
              locale={locale}
              part="licenses"
              showExamples={dataSource === 'api' && isPreview}
            />
          </div>
        </div>
        <div className="footer-end">
          <div className="container footer-bottom">
            <StoreIdentityFooter value={site.storeIdentity} locale={locale} part="policies" />
            <span>
              ©{' '}
              {new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', {
                year: 'numeric',
                calendar: fa ? 'persian' : 'gregory',
              }).format(new Date())}{' '}
              {site.name}
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
export function MobileNav() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const { setCartOpen, cart, serverCart } = useShop();
  const destinations = [
    { href: '/', label: t('خانه'), Icon: Home },
    { href: '/catalog', label: t('دسته‌ها'), Icon: Grid2X2 },
    { href: '/wishlist', label: t('علاقه‌مندی'), Icon: Heart },
    { href: '/account', label: locale === 'fa' ? 'حساب من' : 'Account', Icon: UserRound },
  ];
  const cartButton = (
    <button
      type="button"
      key="cart"
      onClick={() => setCartOpen(true)}
      aria-label={t('سبد خرید')}
      aria-haspopup="dialog"
    >
      <span className="mobile-nav-icon">
        <ShoppingBag size={20} />
        {(serverCart ? cartV2HasBuyLines(serverCart) : cart.length > 0) && (
          <i className="cart-has-items" />
        )}
      </span>
      {locale === 'fa' ? t('سبد خرید') : 'Bag'}
    </button>
  );
  return (
    <nav className="mobile-bottom" aria-label={t('پیمایش موبایل')}>
      {destinations.flatMap(({ href, label, Icon }, index) => {
        const active =
          href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
        const link = (
          <Link
            key={href}
            href={href}
            className={active ? 'active' : ''}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mobile-nav-icon">
              <Icon size={20} />
            </span>
            {label}
          </Link>
        );
        return index === 1 ? [link, cartButton] : [link];
      })}
    </nav>
  );
}
export function CartLines() {
  const { t, digits, toman, locale } = useI18n();
  const { products } = useStorefront();
  const { cart, serverCart, cartBusy, loadError, quantity, setCartOpen } = useShop();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  return (
    <div className="cart-lines" aria-busy={cartBusy}>
      {cart.map((line) => {
        const found = findVariant(products, line.variantId);
        const live = serverCart?.ordinaryLines.find((l) => l.variantId === line.variantId);
        const name = live
          ? (live.name ?? text('کالای خارج از فهرست فعلی', 'Item outside the current catalogue'))
          : (found?.product.name ?? text('کالای ناموجود', 'Unavailable item'));
        const label = live ? live.label : found?.variant.label;
        const slug = live ? live.slug : found?.product.slug;
        const image = live?.issue === 'unavailable' ? undefined : found?.product.image;
        const total = live
          ? live.lineTotalRial
          : found
            ? (BigInt(found.variant.priceRial) * BigInt(line.quantity)).toString()
            : null;
        const available = live?.available ?? found?.variant.stock ?? 0;
        const content = (
          <>
            {image ? (
              <Image src={image} alt={name} width={110} height={100} />
            ) : (
              <ShoppingBag size={46} aria-hidden="true" />
            )}
          </>
        );
        return (
          <article className="cart-line" key={line.variantId}>
            {slug ? (
              <Link
                href={`/product/${slug}?variant=${line.variantId}`}
                onClick={() => setCartOpen(false)}
              >
                {content}
              </Link>
            ) : (
              <div className="cart-line-placeholder">{content}</div>
            )}
            <div className="cart-line-info">
              {slug ? (
                <Link
                  href={`/product/${slug}?variant=${line.variantId}`}
                  onClick={() => setCartOpen(false)}
                >
                  {name}
                </Link>
              ) : (
                <strong>{name}</strong>
              )}
              <small>{label}</small>
              {live?.issue !== 'unavailable' && (
                <UsedConditionReport condition={found?.variant.usedCondition} locale={locale} />
              )}
              <span className="line-price">
                {total !== null ? (
                  <>
                    {toman(total)} <small>{t('تومان')}</small>
                  </>
                ) : (
                  text('نیاز به بررسی', 'Needs review')
                )}
              </span>
              {live?.issue && (
                <p className="field-error" role="status">
                  {live.issue === 'insufficient_stock'
                    ? text(
                        `موجودی فعلی: ${digits(available)}؛ تعداد را اصلاح کنید.`,
                        `Current stock: ${digits(available)}. Adjust the quantity.`,
                      )
                    : live.issue === 'unavailable'
                      ? text(
                          'این کالا فعلاً قابل خرید نیست؛ می‌توانید آن را حذف کنید.',
                          'This item is unavailable. You can remove it.',
                        )
                      : text(
                          'مبلغ نیاز به بررسی دارد؛ سبد را اصلاح کنید.',
                          'The amount needs review. Please edit the cart.',
                        )}
                </p>
              )}
              <div className="quantity-row">
                <div className="quantity-control">
                  <button
                    type="button"
                    disabled={cartBusy || loadError || line.quantity >= available}
                    onClick={() => quantity(line.variantId, line.quantity + 1)}
                    aria-label={t('افزایش تعداد {0}', [name])}
                  >
                    <Plus size={15} />
                  </button>
                  <span>{digits(line.quantity)}</span>
                  <button
                    type="button"
                    disabled={cartBusy || loadError}
                    onClick={() => quantity(line.variantId, line.quantity - 1)}
                    aria-label={t('کاهش تعداد {0}', [name])}
                  >
                    {line.quantity === 1 ? <Trash2 size={14} /> : <Minus size={15} />}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={cartBusy || loadError}
                  className="text-button muted"
                  onClick={() => quantity(line.variantId, 0)}
                >
                  {t('حذف')}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
export function CartDrawer() {
  const { locale, t, digits } = useI18n(),
    { cart, serverCart, cartOpen, setCartOpen, ready, loadError, retry, cartBusy } = useShop(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const count = serverCart
      ? cartV2BuyCount(serverCart)
      : cart.reduce((sum, line) => sum + line.quantity, 0),
    nonempty = serverCart ? cartV2HasBuyLines(serverCart) : cart.length > 0;
  return (
    <Modal
      open={cartOpen}
      onOpenChange={setCartOpen}
      title={text('سبد خرید شما', 'Your cart') + (count ? ' (' + digits(count) + ')' : '')}
      drawer
    >
      <CartCommandNotice />
      {!ready ? (
        <div className="empty-state" role="status">
          <p>
            {loadError
              ? text(
                  'بازیابی سبد انجام نشد؛ اطلاعات قبلی محفوظ است.',
                  'Cart could not be loaded. Previous selections remain saved.',
                )
              : text('در حال بازیابی سبد…', 'Loading cart…')}
          </p>
          {loadError && (
            <Button variant="outline" onClick={retry}>
              {t('تلاش دوباره')}
            </Button>
          )}
        </div>
      ) : nonempty ? (
        <>
          {loadError && (
            <p className="notice" role="alert">
              {text(
                'ارتباط سبد کامل نشد؛ پیش از ادامه بازخوانی کنید.',
                'The cart connection failed. Refresh before continuing.',
              )}{' '}
              <button onClick={retry}>{t('تلاش دوباره')}</button>
            </p>
          )}
          {cartBusy && (
            <p role="status">
              {text('فرمان سبد در حال بررسی است…', 'A cart command is being checked…')}
            </p>
          )}
          {cart.length > 0 && (
            <>
              <h3>{text('کالاهای عادی فروشگاه', 'Ordinary store products')}</h3>
              <CartLines />
            </>
          )}
          <AcceptedCartGroups compact />
          <div className="drawer-summary">
            <div>
              <span>{t('جمع کالاها')}</span>
              <strong>
                <CartAmount />
              </strong>
            </div>
            <CartCheckoutLink onClick={() => setCartOpen(false)} />
            <Link className="drawer-cart-link" href="/cart" onClick={() => setCartOpen(false)}>
              {text('مشاهدهٔ هر سه بخش سبد', 'Review all three cart sections')}
            </Link>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <ShoppingBag size={52} />
          <h3>{text('کالایی برای خرید در سبد نیست', 'No purchase items in your cart')}</h3>
          <Button asChild>
            <Link href="/catalog" onClick={() => setCartOpen(false)}>
              {t('کشف محصولات')}
              <ArrowLeft size={17} />
            </Link>
          </Button>
        </div>
      )}
    </Modal>
  );
}
export function CompareTray() {
  const { t, digits } = useI18n();
  useStorefront();
  const { compare, toggleCompare } = useShop();
  const path = usePathname();
  if (!compare.length || path === '/compare') return null;
  return (
    <div className={`compare-tray ${path.startsWith('/product/') ? 'on-product' : ''}`}>
      <div>
        <GitCompareArrows size={20} />
        <span>
          {t(digits(compare.length))}
          {t('محصول برای مقایسه')}
        </span>
      </div>
      <Link href="/compare">
        {t('مشاهدهٔ مقایسه')}
        <ArrowLeft size={16} />
      </Link>
      <button
        className="icon-button"
        aria-label={t('پاک کردن فهرست مقایسه')}
        onClick={() => compare.forEach((id) => toggleCompare(id))}
      >
        <X size={17} />
      </button>
    </div>
  );
}
