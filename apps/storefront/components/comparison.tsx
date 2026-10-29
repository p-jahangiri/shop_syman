'use client';
import { UsedConditionReport } from './used-condition';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  Copy,
  GitCompareArrows,
  Search,
  ShoppingBag,
  X,
} from 'lucide-react';
import Link, { useRouter } from './localized-link';
import Image from './content-image';
import { Button } from './ui';
import { useI18n, useStorefront } from './locale-provider';
import { useShop } from './shop-provider';
import { lookupProducts, searchProducts } from '@/lib/catalog-client';
import {
  comparisonColumns,
  comparisonHref,
  comparisonRows,
  parseComparisonSelection,
  type ComparisonQuery,
} from '@/lib/comparison';
import { localeHref } from '@/lib/i18n';
import type { Product } from '@/lib/types';
import './comparison.css';

export function Compare({ query = {} }: { query?: ComparisonQuery }) {
  const { locale, t, digits, toman } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const { categories, attributeDefinitions, attributeLabels } = useStorefront();
  const shop = useShop(),
    router = useRouter();
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const selection = useMemo(() => parseComparisonSelection(query), [query]);
  const shared = selection.valid && selection.shared;
  const ids = selection.valid ? (shared ? selection.ids : shop.compare) : [];
  const ready = interactive && selection.valid && (shared || shop.preferencesReady);
  const requestKey = JSON.stringify([locale, ids]);
  const [attempt, retry] = useState(0),
    [loaded, setLoaded] = useState<{ key: string; products: Product[]; error: boolean } | null>(
      null,
    );
  const selectionScope =
    shared && selection.valid ? JSON.stringify([selection.ids, selection.variants]) : 'saved';
  const [chosen, setChosen] = useState<{ scope: string; values: Record<string, string> }>({
    scope: 'saved',
    values: {},
  });
  const incoming = Object.fromEntries(
    shared && selection.valid
      ? selection.ids.map((id, i) => [id, selection.variants[i] ?? ''])
      : [],
  );
  const selected = { ...incoming, ...(chosen.scope === selectionScope ? chosen.values : {}) };
  const [onlyDifferent, setOnlyDifferent] = useState(false),
    [shareUrl, setShareUrl] = useState(''),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(),
      [language, requested] = JSON.parse(requestKey) as [typeof locale, string[]];
    if (!requested.length) {
      setLoaded({ key: requestKey, products: [], error: false });
      return;
    }
    void lookupProducts(language, { productIds: requested }, controller.signal)
      .then((products) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, products, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, products: [], error: true });
      });
    return () => controller.abort();
  }, [ready, requestKey, attempt]);
  const current = loaded?.key === requestKey ? loaded : null,
    pending = !ready || current === null;
  const columns = comparisonColumns(current?.products ?? [], ids, selected);
  const missing =
    !pending && !current?.error
      ? ids.filter((id) => !columns.some((c) => c.product.id === id))
      : [];
  const category = categories.find((c) => c.key === columns[0]?.product.category);
  const mixed = columns.some((c) => c.product.category !== columns[0]?.product.category);
  const rows =
    category && !mixed
      ? comparisonRows(columns, category, attributeDefinitions, attributeLabels)
      : [];
  const displayed = onlyDifferent ? rows.filter((row) => row.different) : rows;
  const shareable =
    !pending &&
    !current?.error &&
    !mixed &&
    !!category &&
    columns.length >= 2 &&
    !missing.length &&
    columns.every((c) => c.variant !== null);
  function changeVariant(productId: string, variantId: string) {
    setChosen({
      scope: selectionScope,
      values: { ...(chosen.scope === selectionScope ? chosen.values : {}), [productId]: variantId },
    });
    setShareUrl('');
    setCopied(false);
  }
  function remove(productId: string) {
    setShareUrl('');
    setCopied(false);
    if (!shared) {
      shop.toggleCompare(productId);
      return;
    }
    const remaining = ids.filter((id) => id !== productId);
    router.replace(
      comparisonHref(
        remaining,
        remaining.map(
          (id) => columns.find((c) => c.product.id === id)?.variant?.id ?? selected[id] ?? '',
        ),
      ),
    );
  }
  async function share() {
    if (!shareable) return;
    const url = new URL(
      localeHref(
        comparisonHref(
          ids,
          columns.map((c) => c.variant!.id),
        ),
        locale,
      ),
      window.location.origin,
    ).href;
    setShareUrl(url);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* The visible readonly field remains a manual-copy fallback. */
    }
  }
  const [searchText, setSearchText] = useState(''),
    [categoryChoice, setCategoryChoice] = useState(''),
    [submitted, setSubmitted] = useState<string | null>(null),
    [searchAttempt, setSearchAttempt] = useState(0);
  const searchCategory = columns[0]?.product.category ?? categoryChoice;
  const searchKey = JSON.stringify([locale, searchCategory, submitted]);
  const [searchResult, setSearchResult] = useState<{
    key: string;
    products: Product[];
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (submitted === null || !selection.valid) return;
    const controller = new AbortController();
    const [language, categoryId, term] = JSON.parse(searchKey) as [typeof locale, string, string];
    void searchProducts(
      language,
      { query: term, categoryId: categoryId || undefined, pageSize: 6 },
      controller.signal,
    )
      .then((page) => {
        if (!controller.signal.aborted)
          setSearchResult({ key: searchKey, products: page.products, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSearchResult({ key: searchKey, products: [], error: true });
      });
    return () => controller.abort();
  }, [searchKey, searchAttempt, submitted, selection.valid]);
  const matches = searchResult?.key === searchKey ? searchResult : null;
  function choose(product: Product) {
    if (
      pending ||
      current?.error ||
      ids.length >= 4 ||
      ids.includes(product.id) ||
      (columns[0] && product.category !== columns[0].product.category)
    )
      return;
    if (shared)
      router.replace(
        comparisonHref(
          [...ids, product.id],
          [
            ...ids.map(
              (id) => columns.find((c) => c.product.id === id)?.variant?.id ?? selected[id] ?? '',
            ),
            '',
          ],
        ),
      );
    else shop.toggleCompare(product.id, product);
    setShareUrl('');
    setCopied(false);
  }
  return (
    <div className="container collection-page comparison-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <span>{t('مقایسه')}</span>
        </div>
        <div className="page-title-row">
          <div>
            <span className="eyebrow">{t('کنار هم، واضح‌تر می‌بینی')}</span>
            <h1>{t('مقایسهٔ انتخاب‌ها')}</h1>
            <p>
              {text(
                'دو تا چهار محصول از یک دسته؛ رنگ و حافظهٔ هر ستون را جدا انتخاب کنید.',
                'Compare two to four products in one category. Choose a variant for each column.',
              )}
            </p>
          </div>
          <Link className="text-link" href="/catalog">
            {t('همهٔ محصولات')}
            <ArrowLeft size={16} />
          </Link>
        </div>
      </div>
      {!selection.valid ? (
        <div className="card-panel empty-state" role="alert">
          <h2>{text('لینک مقایسه معتبر نیست', 'Invalid comparison link')}</h2>
          <p>
            {text(
              'حداکثر چهار شناسهٔ متفاوت و تنوع‌های متناظر را انتخاب کنید.',
              'Choose up to four distinct products with matching variant selections.',
            )}
          </p>
          <Button onClick={() => router.replace('/compare')}>
            {text('بازگشت به انتخاب‌های من', 'Back to my selection')}
          </Button>
        </div>
      ) : (
        <>
          {shared && (
            <p className="notice">
              {text(
                'این انتخاب از لینک باز شده و فهرست ذخیره‌شدهٔ شما را تغییر نمی‌دهد.',
                'This shared selection leaves your saved comparison unchanged.',
              )}{' '}
              <Link href="/compare">{text('انتخاب‌های من', 'My selection')}</Link>
            </p>
          )}
          <section
            className="card-panel comparison-picker"
            aria-label={text('افزودن به مقایسه', 'Add to comparison')}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(searchText.trim());
                setSearchAttempt((n) => n + 1);
              }}
            >
              <label>
                {text('نام، برند یا SKU کالا', 'Product name, brand or SKU')}
                <input
                  disabled={!ready}
                  value={searchText}
                  maxLength={200}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={text('جست‌وجو برای انتخاب محصول', 'Search for a product')}
                />
              </label>
              <label>
                {text('دسته', 'Category')}
                <select
                  value={searchCategory}
                  disabled={!ready || columns.length > 0}
                  onChange={(e) => setCategoryChoice(e.target.value)}
                >
                  <option value="">{text('همهٔ دسته‌ها', 'All categories')}</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="outline" disabled={!ready || ids.length >= 4 || mixed}>
                <Search size={16} />
                {text('جست‌وجو', 'Search')}
              </Button>
            </form>
            {ids.length >= 4 && (
              <p role="status">
                {text(
                  'چهار محصول انتخاب شده؛ برای افزودن، یکی را حذف کنید.',
                  'Four products selected. Remove one to add another.',
                )}
              </p>
            )}
            {submitted !== null &&
              (!matches ? (
                <p role="status">{text('در حال جست‌وجو…', 'Searching…')}</p>
              ) : matches.error ? (
                <div role="alert">
                  <p>
                    {text(
                      'جست‌وجو انجام نشد؛ عبارت را کوتاه‌تر کنید یا دوباره تلاش کنید.',
                      'Search failed. Try fewer words or retry.',
                    )}
                  </p>
                  <button type="button" onClick={() => setSearchAttempt((n) => n + 1)}>
                    {t('تلاش دوباره')}
                  </button>
                </div>
              ) : (
                <ul className="comparison-search-results">
                  {matches.products
                    .filter((p) => !searchCategory || p.category === searchCategory)
                    .map((p) => (
                      <li key={p.id}>
                        <span>
                          {p.name}
                          <small>{p.brand}</small>
                        </span>
                        <button
                          type="button"
                          disabled={
                            !ready ||
                            pending ||
                            !!current?.error ||
                            ids.length >= 4 ||
                            ids.includes(p.id) ||
                            mixed
                          }
                          onClick={() => choose(p)}
                        >
                          {ids.includes(p.id)
                            ? text('انتخاب شده', 'Selected')
                            : text('افزودن به مقایسه', 'Add to comparison')}
                        </button>
                      </li>
                    ))}
                  {!matches.products.length && (
                    <li role="status">{text('محصولی پیدا نشد.', 'No products found.')}</li>
                  )}
                </ul>
              ))}
          </section>
          {pending ? (
            <div className="card-panel" role="status">
              {text('در حال دریافت مشخصات جاری…', 'Loading current specifications…')}
            </div>
          ) : current?.error ? (
            <div className="card-panel" role="alert">
              <p>
                {text(
                  'مشخصات دریافت نشد؛ انتخاب‌های قبلی محفوظ‌اند.',
                  'Specifications could not be loaded. Your selections are preserved.',
                )}
              </p>
              <Button variant="outline" onClick={() => retry((n) => n + 1)}>
                {t('تلاش دوباره')}
              </Button>
            </div>
          ) : (
            <>
              {!!missing.length && (
                <div className="notice" role="status">
                  <p>
                    {text(
                      'بعضی انتخاب‌ها دیگر در فهرست عمومی نیستند؛ اطلاعات قدیمی آن‌ها نمایش داده نمی‌شود.',
                      'Some selections are no longer public. Their previous information is hidden.',
                    )}
                  </p>
                  {missing.map((id, i) => (
                    <button key={id} type="button" onClick={() => remove(id)}>
                      {text('حذف انتخاب در دسترس‌نبودنی', 'Remove unavailable selection')}{' '}
                      {digits(i + 1)}
                    </button>
                  ))}
                </div>
              )}
              {mixed || (columns.length > 0 && !category) ? (
                <div className="notice" role="alert">
                  {text(
                    'محصولات باید از یک دستهٔ فعال باشند. انتخاب‌ها را اصلاح کنید.',
                    'Products must belong to one active category. Adjust your selection.',
                  )}
                  {columns.map((c) => (
                    <button key={c.product.id} type="button" onClick={() => remove(c.product.id)}>
                      {text('حذف', 'Remove')} {c.product.name}
                    </button>
                  ))}
                </div>
              ) : columns.length < 2 ? (
                <div className="empty-state card-panel">
                  <GitCompareArrows size={40} />
                  <h2>{t('برای مقایسه، دو انتخاب لازم است')}</h2>
                  <p>
                    {text(
                      'از جست‌وجوی بالا یا علامت مقایسه کنار کالاها استفاده کنید.',
                      'Use the search above or the compare button on product cards.',
                    )}
                  </p>
                  {columns.map((c) => (
                    <button key={c.product.id} type="button" onClick={() => remove(c.product.id)}>
                      {text('حذف', 'Remove')} {c.product.name}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="comparison-tools">
                    <label>
                      <input
                        type="checkbox"
                        checked={onlyDifferent}
                        onChange={(e) => setOnlyDifferent(e.target.checked)}
                      />
                      {text('فقط مشخصات متفاوت', 'Only different specifications')}
                    </label>
                    <Button variant="outline" disabled={!shareable} onClick={() => void share()}>
                      <Copy size={16} />
                      {text('اشتراک مقایسه', 'Share comparison')}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        router.refresh();
                        retry((n) => n + 1);
                      }}
                    >
                      {text('تازه‌سازی مشخصات', 'Refresh specifications')}
                    </button>
                  </div>
                  {shareUrl && (
                    <label className="comparison-share" role="status">
                      {copied
                        ? text(
                            'لینک کپی شد؛ قیمت و موجودی هنگام بازکردن دوباره خوانده می‌شوند.',
                            'Link copied. Prices and availability are refreshed when opened.',
                          )
                        : text('این لینک را کپی کنید:', 'Copy this link:')}
                      <input
                        readOnly
                        dir="ltr"
                        aria-label={text('لینک مقایسه', 'Comparison link')}
                        value={shareUrl}
                      />
                    </label>
                  )}
                  <p className="comparison-note">
                    {text(
                      'قیمت، موجودی و گارانتی مربوط به تنوع انتخاب‌شده است. این صفحه رزرو یا تضمین قیمت نیست؛ سبد دوباره در سرور بررسی می‌شود. مقدار نامشخص به معنی نبودن آن ویژگی نیست.',
                      'Price, availability and warranty belong to the selected variant. This page does not reserve stock or guarantee a price; the server checks the cart again. Unknown values do not mean a feature is absent.',
                    )}
                  </p>
                  <div
                    className="compare-scroll"
                    role="region"
                    tabIndex={0}
                    aria-label={text(
                      'جدول مقایسهٔ محصولات؛ قابل پیمایش افقی',
                      'Product comparison table; horizontally scrollable',
                    )}
                  >
                    <table className="compare-table">
                      <caption className="sr-only">{t('جدول مقایسهٔ مشخصات محصولات')}</caption>
                      <thead>
                        <tr>
                          <th scope="col">
                            {text('انتخاب و مشخصات', 'Selection and specifications')}
                          </th>
                          {columns.map(({ product, variant, requestedVariant }) => (
                            <th scope="col" key={product.id}>
                              <button
                                type="button"
                                className="compare-remove icon-button"
                                onClick={() => remove(product.id)}
                                aria-label={t('حذف {0} از مقایسه', [product.name])}
                              >
                                <X size={17} />
                              </button>
                              <Link
                                href={`/product/${product.slug}${variant ? `?variant=${encodeURIComponent(variant.id)}` : ''}`}
                              >
                                <Image src={product.image} width={230} height={184} alt="" />
                                <strong>{product.name}</strong>
                              </Link>
                              <label className="comparison-variant">
                                {text('تنوع', 'Variant')}
                                <select
                                  aria-label={text(
                                    `تنوع ${product.name}`,
                                    `Variant for ${product.name}`,
                                  )}
                                  value={variant?.id ?? requestedVariant}
                                  onChange={(e) => changeVariant(product.id, e.target.value)}
                                >
                                  {!variant && (
                                    <option value={requestedVariant} disabled>
                                      {text(
                                        'تنوع قبلی دیگر در دسترس نیست',
                                        'Previous variant is unavailable',
                                      )}
                                    </option>
                                  )}
                                  {product.variants.map((v) => (
                                    <option value={v.id} key={v.id}>
                                      {v.label} · {v.colorName || v.sku}
                                      {v.stock === 0 ? text(' · ناموجود', ' · Out of stock') : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {variant ? (
                                <>
                                  <span>
                                    {toman(variant.priceRial)} <small>{t('تومان')}</small>
                                  </span>
                                  <small className="comparison-rial">
                                    <bdi>{digits(variant.priceRial)}</bdi> {text('ریال', 'rial')}
                                  </small>
                                </>
                              ) : (
                                <p role="status">
                                  {text(
                                    'یک تنوع معتبر انتخاب کنید.',
                                    'Select an available variant.',
                                  )}
                                </p>
                              )}
                              <Button
                                variant="outline"
                                disabled={
                                  !variant ||
                                  variant.stock === 0 ||
                                  shop.cartBusy ||
                                  shop.loadError ||
                                  !shop.ready
                                }
                                onClick={() => {
                                  if (variant) shop.add(variant.id, 1, product);
                                }}
                              >
                                {text('افزودن به سبد', 'Add to cart')}
                                <ShoppingBag size={15} />
                              </Button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">{text('برند', 'Brand')}</th>
                          {columns.map((c) => (
                            <td key={c.product.id}>{c.product.brand}</td>
                          ))}
                        </tr>
                        <tr>
                          <th scope="row">SKU</th>
                          {columns.map((c) => (
                            <td key={c.product.id}>
                              <bdi>{c.variant?.sku ?? text('نامشخص', 'Unknown')}</bdi>
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th scope="row">{text('موجودی تنوع', 'Variant availability')}</th>
                          {columns.map((c) => (
                            <td key={c.product.id}>
                              {!c.variant
                                ? text('نامشخص', 'Unknown')
                                : c.variant.stock > 0
                                  ? text('موجود', 'In stock')
                                  : text('ناموجود', 'Out of stock')}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th scope="row">{text('وضعیت دستگاه', 'Device condition')}</th>
                          {columns.map((c) => (
                            <td key={c.product.id}>
                              {c.variant ? (
                                <UsedConditionReport
                                  condition={c.variant.usedCondition}
                                  locale={locale}
                                />
                              ) : (
                                text('نامشخص', 'Unknown')
                              )}
                              {c.variant &&
                                !c.variant.usedCondition &&
                                text('گزارش کارکرده ندارد', 'No used-device report')}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th scope="row">{text('گارانتی تنوع', 'Variant warranty')}</th>
                          {columns.map((c) => (
                            <td key={c.product.id}>
                              {c.variant?.warranty.trim() || text('ثبت نشده', 'Not specified')}
                            </td>
                          ))}
                        </tr>
                        {displayed.map((row) => (
                          <tr key={row.key} className={row.different ? 'different' : ''}>
                            <th scope="row">
                              {row.label}
                              {row.different && <span>{t('متفاوت')}</span>}
                            </th>
                            {row.values.map((value, i) => (
                              <td key={columns[i].product.id}>
                                {value ?? (
                                  <span className="comparison-unknown">
                                    {text('نامشخص', 'Unknown')}
                                  </span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {displayed.length === 0 && (
                          <tr>
                            <td colSpan={columns.length + 1}>
                              {onlyDifferent
                                ? text(
                                    'در مشخصات قابل مقایسهٔ ثبت‌شده تفاوتی پیدا نشد.',
                                    'No differences found in the recorded comparable specifications.',
                                  )
                                : text(
                                    'مشخصات قابل مقایسه برای این دسته هنوز ثبت نشده‌اند.',
                                    'Comparable specifications have not been recorded for this category.',
                                  )}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
