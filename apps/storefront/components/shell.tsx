'use client';
import { UsedConditionReport } from './used-condition';
import { SourcingDrawerLink, SourcingCartIndicator } from './sourcing';
import { CartAmount, CartCheckoutLink } from './cart-summary';
import { AcceptedCartGroups } from './accepted-cart-groups';
import { CartCommandNotice } from './cart-command-notice';
import { cartV2BuyCount, cartV2HasBuyLines } from '@/lib/cart-v2-contract';
import { useI18n, useStorefront } from '@/components/locale-provider';
import Link from '@/components/localized-link';
import { searchProducts } from '@/lib/catalog-client';
import type { Product } from '@/lib/types';
import { LanguageSwitch } from './language-switch';
import { ContentMenu } from './content-menu';
import { filterPurchaseMenu, isPurchaseKindEnabled } from '@/lib/purchasing';
import Image from '@/components/content-image';
import { usePathname, useRouter } from '@/components/localized-link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpLeft,
  Search,
  ShoppingBag,
  UserRound,
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
  X,
  Plus,
  Minus,
  Trash2,
} from 'lucide-react';
import { findVariant } from '@/lib/commerce';
import { useShop } from './shop-provider';
import { Button, Modal } from './ui';
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
  const menuItems = filterPurchaseMenu(site.nav, purchaseMethods);
  const { cart, serverCart, wishlist, setCartOpen, ready } = useShop();
  const [query, setQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [menu, setMenu] = useState(false),
    [dark, setDark] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const searchContainer = useRef<HTMLDivElement>(null);
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
      )
        setSearchOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [searchOpen]);
  useEffect(() => {
    try {
      const value = localStorage.getItem('sayman:theme');
      const initial = value
        ? value === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      setDark(initial);
      document.documentElement.dataset.theme = initial ? 'dark' : 'light';
    } catch {
      /* Storage can be unavailable; the current tab still uses the selected theme. */
    }
  }, []);
  useEffect(() => {
    setMenu(false);
    setSearchOpen(false);
  }, [pathname]);
  const count = serverCart ? cartV2BuyCount(serverCart) : cart.reduce((s, x) => s + x.quantity, 0);
  const [results, setResults] = useState<Product[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState(false);
  useEffect(() => {
    const term = query.trim();
    setResults([]);
    setSearchError(false);
    if (!searchOpen || !term) {
      setSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    setSearchBusy(true);
    const timer = setTimeout(() => {
      searchProducts(locale, { query: term, pageSize: 4 }, controller.signal)
        .then((page) => {
          if (!controller.signal.aborted) setResults(page.products);
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
  }, [query, locale, searchOpen]);
  function submit(e: FormEvent) {
    e.preventDefault();
    setSearchOpen(false);
    router.push(`/catalog?q=${encodeURIComponent(query)}`);
  }
  function theme() {
    const value = !dark;
    setDark(value);
    document.documentElement.dataset.theme = value ? 'dark' : 'light';
    try {
      localStorage.setItem('sayman:theme', value ? 'dark' : 'light');
    } catch {
      /* Storage can be unavailable; the current tab still uses the selected theme. */
    }
  }
  return (
    <>
      <div className="announcement">
        <div className="container">
          <span>
            <span className="live-dot" />
            {t(site.announcement)}
          </span>
          {chequeEnabled && (
            <Link href="/installments">
              {t('یک انتخاب، چند پرداخت')}
              <ArrowLeft size={13} />
            </Link>
          )}
        </div>
      </div>
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
          <div className="search-wrap" ref={searchContainer}>
            <form className="search-box" onSubmit={submit} role="search">
              <Search size={20} />
              <input
                id="storefront-search"
                name="q"
                maxLength={200}
                aria-label={t('جست‌وجوی محصولات')}
                placeholder={t('دنبال چه چیزی می‌گردی؟')}
                value={query}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
              />
              <kbd>{t('جست‌وجو')}</kbd>
              {t(
                query && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      setQuery('');
                      setSearchOpen(false);
                    }}
                    aria-label={t('پاک کردن جست‌وجو')}
                  >
                    <X size={15} />
                  </button>
                ),
              )}
            </form>
            {t(
              searchOpen && query && (
                <div className="search-results">
                  <div className="search-results-heading">
                    <span>{t('پیشنهادهای جست‌وجو')}</span>
                    <button
                      className="icon-button"
                      onClick={() => setSearchOpen(false)}
                      aria-label={t('بستن پیشنهادها')}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {t(
                    results.length ? (
                      results.map((p) => (
                        <Link
                          key={p.id}
                          href={`/product/${p.slug}`}
                          onClick={() => setSearchOpen(false)}
                        >
                          <Image src={p.image} width={48} height={40} alt="" />
                          <span>{t(p.name)}</span>
                          <ArrowUpLeft size={15} />
                        </Link>
                      ))
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
                  <Link
                    href={`/catalog?q=${encodeURIComponent(query)}`}
                    onClick={() => setSearchOpen(false)}
                    className="search-all"
                  >
                    {t('مشاهدهٔ همهٔ نتایج')}
                    <ArrowLeft size={16} />
                  </Link>
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
              <SourcingCartIndicator />
              {t(ready && count > 0 && <span className="count-badge">{t(digits(count))}</span>)}
            </button>
          </div>
        </div>
        <div className="container nav-row">
          <nav aria-label={t('منوی اصلی')}>
            <div className="all-categories">
              <Grid2X2 size={17} aria-hidden="true" />
              <ContentMenu
                items={[
                  {
                    label: t('همهٔ دسته‌ها'),
                    href: '/catalog',
                    children: categories.map((category) => ({
                      label: category.name,
                      href: `/catalog?category=${encodeURIComponent(category.key)}`,
                    })),
                  },
                ]}
              />
            </div>
            <span className="nav-divider" />
            <ContentMenu items={menuItems} />
            {chequeEnabled && (
              <Link href="/installments" className="nav-credit">
                <CreditCard size={16} />
                {t('خرید چکی')}
                <span>{t('آسان‌تر')}</span>
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
          <Link
            href="/catalog"
            aria-current={pathname === '/catalog' ? 'page' : undefined}
            onClick={() => setMenu(false)}
          >
            <Grid2X2 size={19} />
            {t('همهٔ محصولات')}
          </Link>
          <ContentMenu items={menuItems} onNavigate={() => setMenu(false)} />
          {chequeEnabled && (
            <Link href="/installments" onClick={() => setMenu(false)}>
              {t('خرید چکی')}
            </Link>
          )}
          <Link href="/compare" onClick={() => setMenu(false)}>
            {t('مقایسهٔ محصولات')}
          </Link>
          <Link href="/support" onClick={() => setMenu(false)}>
            {t('راهنما و پشتیبانی')}
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
  const source = useStorefront().dataSource;
  const { t, locale } = useI18n();
  const { site, purchaseMethods } = useStorefront();
  const chequeEnabled = isPurchaseKindEnabled(purchaseMethods, 'cheque');
  const menuItems = filterPurchaseMenu(site.nav, purchaseMethods);
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
      <footer className="footer">
        <div className="container footer-grid">
          <div className="footer-about">
            <Brand />
            <p>{t(site.about)}</p>
            {site.contact && (
              <address className="store-contact">
                {site.contact.phone && (
                  <a dir="ltr" href={`tel:${site.contact.phone.replace(/[^0-9+]/g, '')}`}>
                    {site.contact.phone}
                  </a>
                )}
                {site.contact.email && (
                  <a dir="ltr" href={`mailto:${site.contact.email}`}>
                    {site.contact.email}
                  </a>
                )}
                {site.contact.address && <span>{site.contact.address}</span>}
                {site.contact.hours && <small>{site.contact.hours}</small>}
              </address>
            )}
            <span className="footer-signature">{t('تکنولوژی، کمی نزدیک‌تر.')}</span>
          </div>
          <div>
            <h3>{t('کشف سایمان')}</h3>
            <ContentMenu items={menuItems} />
          </div>
          <div>
            <h3>{t('همراه شما')}</h3>
            {chequeEnabled && <Link href="/installments">{t('راهنمای خرید چکی')}</Link>}
            <Link href="/support">{t('گارانتی و مرجوعی')}</Link>
            <Link href={source === 'api' ? '/orders' : '/account?tab=orders'}>
              {t('پیگیری سفارش')}
            </Link>
            <Link href="/support">{t('پرسش‌های متداول')}</Link>
            <Link href="/install">
              {locale === 'fa' ? 'نصب و مرور آفلاین' : 'Install and browse offline'}
            </Link>
          </div>
          <div className="footer-note">
            <span className="eyebrow">{t('یک تجربهٔ در حال شکل‌گیری')}</span>
            <h3>
              {t('برای انتخاب بعدی،')}
              <br />
              {t('وقت بگذار.')}
            </h3>
            <p>
              {t(
                'این نسخه برای بررسی فروشگاه است؛ قیمت‌ها، موجودی و شرایط، نمونه هستند و پرداخت واقعی فعال نیست.',
              )}
            </p>
            <Link href="/catalog">
              {t('بریم برای انتخاب')}
              <ArrowUpLeft size={17} />
            </Link>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>
            ©{' '}
            {t(
              new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                year: 'numeric',
                calendar: locale === 'fa' ? 'persian' : 'gregory',
              }).format(new Date()),
            )}
            {t('سایمان. طراحی برای یک انتخاب بهتر.')}
          </span>
          <span>
            {t('ساخته‌شده با توجه به جزئیات')}
            <span className="little-spark">✳</span>
          </span>
        </div>
      </footer>
    </>
  );
}
export function MobileNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { setCartOpen, cart, serverCart } = useShop();
  const destinations = [
    { href: '/', label: t('خانه'), Icon: Home },
    { href: '/catalog', label: t('دسته‌ها'), Icon: Grid2X2 },
    { href: '/wishlist', label: t('علاقه‌مندی'), Icon: Heart },
    { href: '/account', label: t('حساب من'), Icon: UserRound },
  ];
  const cartButton = (
    <button type="button" key="cart" onClick={() => setCartOpen(true)} aria-haspopup="dialog">
      <span className="mobile-nav-icon">
        <ShoppingBag size={20} />
        <SourcingCartIndicator />
        {(serverCart ? cartV2HasBuyLines(serverCart) : cart.length > 0) && (
          <i className="cart-has-items" />
        )}
      </span>
      {t('سبد خرید')}
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
      <SourcingDrawerLink onNavigate={() => setCartOpen(false)} />
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
  if (!compare.length || path === '/compare' || path === '/market' || path.startsWith('/market/'))
    return null;
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
