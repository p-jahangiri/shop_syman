'use client';
import { useEffect, useRef, useState, useTransition, isValidElement, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Search,
  SlidersHorizontal,
  Smartphone,
  X,
  GitCompareArrows,
  ShoppingBag,
} from 'lucide-react';
import Link from '../navigation/localized-link';
import Image from '../media/content-image';
import { useI18n } from '../navigation/locale-provider';
import { useSourcing } from './sourcing-provider';
import { SourcingError } from './sourcing';
import { PhoneInterestAction } from './phone-interest';
import { Button, Modal } from '../shared/ui';
import { localeHref } from '@/lib/navigation/i18n';
import {
  phoneHref,
  phoneQueryParams,
  matchingPhoneChoices,
  type PhoneChoice,
  type PhoneItem,
  type PhonePage,
  type PhoneSearch,
} from '@sayman/web-shared/lib/market/phone-discovery-contract.ts';
import './phone-market.css';
const compareKey = 'sayman-phone-comparison-v1';
function readComparison() {
  try {
    const v = JSON.parse(localStorage.getItem(compareKey) ?? '[]');
    return Array.isArray(v) &&
      v.length <= 4 &&
      v.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x))
      ? ([...new Set(v)] as string[])
      : [];
  } catch {
    return [];
  }
}
function useComparison() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(readComparison());
    const sync = () => setIds(readComparison());
    window.addEventListener('storage', sync);
    window.addEventListener('phone-comparison', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('phone-comparison', sync);
    };
  }, []);
  const toggle = (id: string) => {
    const old = readComparison(),
      next = old.includes(id) ? old.filter((v) => v !== id) : old.length < 4 ? [...old, id] : old;
    try {
      localStorage.setItem(compareKey, JSON.stringify(next));
    } catch {
      /* Continue with in-memory state when browser storage is unavailable. */
    }
    setIds(next);
    window.dispatchEvent(new Event('phone-comparison'));
  };
  return { ids, toggle };
}
function CompareButton({ id }: { id: string }) {
  const { ids, toggle } = useComparison(),
    { locale } = useI18n();
  return (
    <button
      className="phone-compare-button"
      aria-pressed={ids.includes(id)}
      disabled={!ids.includes(id) && ids.length >= 4}
      onClick={() => toggle(id)}
    >
      <GitCompareArrows size={16} />
      {ids.includes(id)
        ? locale === 'fa'
          ? 'در مقایسه'
          : 'Selected'
        : locale === 'fa'
          ? 'مقایسه'
          : 'Compare'}
    </button>
  );
}
function CompareTray() {
  const { ids } = useComparison(),
    { locale, digits } = useI18n();
  return ids.length ? (
    <aside className="phone-compare-tray">
      <span>
        <GitCompareArrows size={18} />
        {digits(ids.length)} {locale === 'fa' ? 'گوشی برای مقایسه' : 'phones to compare'}
      </span>
      <Link
        href={'/market/compare?' + ids.map((id) => 'id=' + encodeURIComponent(id)).join('&')}
        className="button button-primary"
      >
        {locale === 'fa' ? 'مقایسه مشخصات' : 'Compare specifications'}
      </Link>
    </aside>
  ) : null;
}
export function PhoneBrowse({ query, page }: { query: PhoneSearch; page: PhonePage }) {
  const { locale, digits } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    router = useRouter(),
    [pending, startTransition] = useTransition(),
    [draft, setDraft] = useState(query.query ?? ''),
    [mobile, setMobile] = useState(false),
    mobileFilterTrigger = useRef<HTMLButtonElement | null>(null),
    latest = useRef(query),
    searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    sent = useRef('');
  const serialized = phoneQueryParams(query).toString();
  useEffect(() => {
    latest.current = query;
    setDraft(query.query ?? '');
    sent.current = serialized;
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, [serialized, query]);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );
  function update(change: Partial<PhoneSearch>) {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    const next = { ...latest.current, ...change, page: change.page ?? 1 };
    latest.current = next;
    const href = phoneHref(next);
    sent.current = phoneQueryParams(next).toString();
    startTransition(() => router.replace(localeHref(href, locale), { scroll: false }));
  }
  function clear() {
    setDraft('');
    update({
      query: undefined,
      brandId: undefined,
      ramGb: undefined,
      storageGb: undefined,
      colorKey: undefined,
    });
  }
  const activeCount = [
    query.query,
    query.brandId,
    query.ramGb,
    query.storageGb,
    query.colorKey,
  ].filter(Boolean).length;
  const brand = page.facets.brands.find((v) => v.id === query.brandId),
    color = page.facets.colors.find((v) => v.key === query.colorKey);
  const option = (
    label: ReactNode,
    value: string | number,
    selected: boolean,
    onClick: () => void,
    count: number,
    searchText?: string,
  ) => (
    <button
      key={value}
      data-search={searchText ?? (typeof label === 'string' ? label : String(value))}
      type="button"
      className={'phone-facet-option' + (selected ? ' selected' : '')}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="phone-check" aria-hidden="true">
        {selected && <Check size={12} />}
      </span>
      <span>{label}</span>
      <small aria-label={digits(count) + ' ' + text('مدل', 'models')}>{digits(count)}</small>
    </button>
  );
  const filters = (
    <>
      <section className="phone-filter-category" aria-label={text('دسته‌بندی', 'Category')}>
        <span>{text('دسته‌بندی', 'Category')}</span>
        <div>
          <Smartphone size={19} />
          <strong>{text('گوشی موبایل', 'Mobile phones')}</strong>
          <Check size={15} />
        </div>
      </section>
      <PhoneFacet
        title={text('برند', 'Brand')}
        count={page.facets.brands.length}
        selected={
          brand?.name ?? (query.brandId ? text('برند انتخاب‌شده', 'Selected brand') : undefined)
        }
        searchable
      >
        {page.facets.brands.map((v) =>
          option(
            v.name,
            v.id,
            query.brandId === v.id,
            () => update({ brandId: latest.current.brandId === v.id ? undefined : v.id }),
            v.count,
          ),
        )}
      </PhoneFacet>
      <PhoneFacet
        title={text('حافظه رم', 'RAM')}
        memory
        count={page.facets.ramGb.length}
        selected={query.ramGb ? digits(query.ramGb) + ' ' + text('گیگابایت', 'GB') : undefined}
        initiallyOpen
      >
        {page.facets.ramGb.map((v) =>
          option(
            digits(v.value) + ' ' + text('گیگابایت', 'GB'),
            v.value,
            query.ramGb === v.value,
            () => update({ ramGb: latest.current.ramGb === v.value ? undefined : v.value }),
            v.count,
          ),
        )}
      </PhoneFacet>
      <PhoneFacet
        title={text('حافظه داخلی', 'Storage')}
        memory
        count={page.facets.storageGb.length}
        selected={
          query.storageGb ? digits(query.storageGb) + ' ' + text('گیگابایت', 'GB') : undefined
        }
        initiallyOpen
      >
        {page.facets.storageGb.map((v) =>
          option(
            digits(v.value) + ' ' + text('گیگابایت', 'GB'),
            v.value,
            query.storageGb === v.value,
            () => update({ storageGb: latest.current.storageGb === v.value ? undefined : v.value }),
            v.count,
          ),
        )}
      </PhoneFacet>
      <PhoneFacet
        title={text('رنگ', 'Colour')}
        count={page.facets.colors.length}
        selected={
          color
            ? locale === 'fa'
              ? color.nameFa
              : color.nameEn
            : query.colorKey
              ? text('رنگ انتخاب‌شده', 'Selected colour')
              : undefined
        }
        searchable
      >
        {page.facets.colors.map((v) =>
          option(
            <>
              <i className="phone-color-dot" style={{ background: v.hex ?? '#aaa' }} />
              {locale === 'fa' ? (
                <>
                  {v.nameFa}
                  {page.facets.colors.some(
                    (other) => other.key !== v.key && other.nameFa === v.nameFa,
                  ) && (
                    <>
                      {' '}
                      · <bdi>{v.nameEn}</bdi>
                    </>
                  )}
                </>
              ) : (
                v.nameEn
              )}
            </>,
            v.key,
            query.colorKey === v.key,
            () => update({ colorKey: latest.current.colorKey === v.key ? undefined : v.key }),
            v.count,
            v.nameFa + ' ' + v.nameEn,
          ),
        )}
      </PhoneFacet>
      <p className="phone-filter-hint">
        <Check size={14} />
        {text(
          'تغییرات خودکار روی نتایج اعمال می‌شوند.',
          'Your changes update the results automatically.',
        )}
      </p>
      {page.facets.truncated && (
        <p className="small-note">
          {text(
            'برای دیدن گزینه‌های دقیق‌تر، جست‌وجو را محدود کنید.',
            'Narrow your search to see more specific options.',
          )}
        </p>
      )}
    </>
  );
  const clearButton = (
    <button
      type="button"
      className="phone-filter-clear"
      disabled={!activeCount && !draft}
      onClick={clear}
    >
      {text('پاک کردن', 'Clear')}
    </button>
  );
  return (
    <main className="container phone-market">
      <nav className="phone-breadcrumb">
        <Link href="/">{text('خانه', 'Home')}</Link>
        <span>/</span>
        <span>{text('کاتالوگ گوشی', 'Phone discovery')}</span>
      </nav>
      <header className="phone-market-hero">
        <div className="phone-hero-icon">
          <Smartphone size={29} />
        </div>
        <div>
          <p className="phone-eyebrow">
            {text('انتخاب شما، تأمین سایمان', 'Your choice, sourced by Sayman')}
          </p>
          <h1>{text('گوشی دلخواهت را پیدا کن', 'Find your next phone')}</h1>
          <p>
            {text(
              'مدل، رنگ و حافظه را انتخاب کن؛ قیمت و زمان تأمین را از فروشگاه بگیر.',
              'Choose a model, colour and memory. Get a price and sourcing timeline from the store.',
            )}
          </p>
        </div>
        <Link href="/sourcing" className="button button-outline">
          {text('درخواست‌های من', 'My requests')}
          <ArrowLeft size={16} />
        </Link>
      </header>
      <div className="phone-journey">
        <span>
          <b>{digits(1)}</b>
          {text('انتخاب مدل و مشخصات', 'Choose your configuration')}
        </span>
        <span>
          <b>{digits(2)}</b>
          {text('اعلام قیمت توسط فروشگاه', 'Receive a store quote')}
        </span>
        <span>
          <b>{digits(3)}</b>
          {text('تأیید شما، تأمین و ارسال', 'Accept, source and deliver')}
        </span>
      </div>
      <div className="phone-market-toolbar">
        <label className="phone-search">
          <Search size={19} />
          <input
            aria-label={text('جست‌وجوی مدل گوشی', 'Search phone models')}
            placeholder={text(
              'جست‌وجوی نام مدل، مثلاً Galaxy A56',
              'Search a model, e.g. Galaxy A56',
            )}
            maxLength={120}
            value={draft}
            onChange={(e) => {
              const value = e.target.value;
              setDraft(value);
              latest.current = { ...latest.current, query: value || undefined, page: 1 };
              if (searchTimer.current) clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => update({ query: value || undefined }), 350);
            }}
          />
        </label>
        <button
          ref={mobileFilterTrigger}
          type="button"
          className="button button-outline phone-mobile-filter"
          aria-expanded={mobile}
          aria-haspopup="dialog"
          onClick={() => setMobile(true)}
        >
          <SlidersHorizontal size={18} />
          {text('فیلترها', 'Filters')}
          {activeCount > 0 && <b>{digits(activeCount)}</b>}
        </button>
        <span aria-live="polite">
          {pending ? (
            text('در حال به‌روزرسانی…', 'Updating…')
          ) : (
            <>
              <strong>{digits(page.total)}</strong> {text('مدل گوشی', 'phone models')}
            </>
          )}
        </span>
      </div>
      <div className="phone-market-layout">
        <aside className="phone-filter-panel" aria-label={text('فیلتر گوشی‌ها', 'Phone filters')}>
          <div className="phone-filter-heading">
            <h2>
              <SlidersHorizontal size={17} />
              {text('فیلترها', 'Filters')}
              {activeCount > 0 && <b>{digits(activeCount)}</b>}
            </h2>
            {clearButton}
          </div>
          {filters}
        </aside>
        <section className="phone-results" aria-busy={pending} inert={pending}>
          <div
            className="phone-active-filters"
            aria-label={text('فیلترهای انتخاب‌شده', 'Selected filters')}
          >
            {query.query && (
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  update({ query: undefined });
                }}
              >
                <Search size={13} />
                {query.query}
                <X size={13} />
                <span className="sr-only">{text('حذف جست‌وجو', 'Remove search')}</span>
              </button>
            )}
            {query.brandId && (
              <button type="button" onClick={() => update({ brandId: undefined })}>
                {brand?.name ?? text('برند انتخاب‌شده', 'Selected brand')}
                <X size={13} />
                <span className="sr-only">{text('حذف برند', 'Remove brand')}</span>
              </button>
            )}
            {query.ramGb && (
              <button type="button" onClick={() => update({ ramGb: undefined })}>
                {text('رم', 'RAM')} {digits(query.ramGb)} GB
                <X size={13} />
                <span className="sr-only">{text('حذف رم', 'Remove RAM')}</span>
              </button>
            )}
            {query.storageGb && (
              <button type="button" onClick={() => update({ storageGb: undefined })}>
                {text('حافظه', 'Storage')} {digits(query.storageGb)} GB
                <X size={13} />
                <span className="sr-only">{text('حذف حافظه', 'Remove storage')}</span>
              </button>
            )}
            {query.colorKey && (
              <button type="button" onClick={() => update({ colorKey: undefined })}>
                {color
                  ? locale === 'fa'
                    ? color.nameFa
                    : color.nameEn
                  : text('رنگ انتخاب‌شده', 'Selected colour')}
                <X size={13} />
                <span className="sr-only">{text('حذف رنگ', 'Remove colour')}</span>
              </button>
            )}
          </div>
          {page.items.length ? (
            <div className="phone-grid">
              {page.items.map((item) => (
                <PhoneCard key={item.id} item={item} query={query} />
              ))}
            </div>
          ) : (
            <div className="card-panel empty-state">
              <Smartphone size={40} />
              <h2>{text('مدلی با این انتخاب‌ها پیدا نشد', 'No models match these choices')}</h2>
              <p>
                {text(
                  'یک فیلتر را بردارید یا نام مدل دیگری را جست‌وجو کنید.',
                  'Remove a filter or search for another model.',
                )}
              </p>
              <button
                type="button"
                className="button button-outline phone-empty-clear"
                onClick={clear}
              >
                {text('پاک کردن فیلترها', 'Clear filters')}
              </button>
            </div>
          )}
          {page.totalPages > 1 && (
            <nav
              className="phone-pagination"
              aria-label={text('صفحه‌های کاتالوگ', 'Catalogue pages')}
            >
              <Button
                variant="outline"
                disabled={pending || query.page <= 1}
                onClick={() => update({ page: query.page - 1 })}
              >
                {text('قبلی', 'Previous')}
              </Button>
              <span>
                {digits(query.page)} / {digits(page.totalPages)}
              </span>
              <Button
                variant="outline"
                disabled={pending || query.page >= page.totalPages}
                onClick={() => update({ page: query.page + 1 })}
              >
                {text('بعدی', 'Next')}
              </Button>
            </nav>
          )}
        </section>
      </div>
      <Modal
        open={mobile}
        onOpenChange={setMobile}
        restoreFocusRef={mobileFilterTrigger}
        title={text('فیلتر گوشی‌ها', 'Phone filters')}
        description={text(
          'انتخاب‌ها بلافاصله نتایج را تغییر می‌دهند.',
          'Your selections update the results immediately.',
        )}
        drawer
      >
        <div className="phone-filter-sheet">
          <div className="phone-filter-sheet-scroll">{filters}</div>
          <footer>
            <div>
              <span aria-live="polite">
                {pending
                  ? text('در حال به‌روزرسانی…', 'Updating…')
                  : digits(page.total) + ' ' + text('مدل گوشی', 'phone models')}
              </span>
              {clearButton}
            </div>
            <button
              type="button"
              className="button button-primary full"
              onClick={() => setMobile(false)}
            >
              {text('دیدن نتایج', 'View results')}
              <ArrowLeft size={17} />
            </button>
          </footer>
        </div>
      </Modal>
      <CompareTray />
    </main>
  );
}
function PhoneFacet({
  title,
  count,
  children,
  selected,
  searchable = false,
  initiallyOpen = false,
  memory = false,
}: {
  title: string;
  count: number;
  children: ReactNode[];
  selected?: string;
  searchable?: boolean;
  initiallyOpen?: boolean;
  memory?: boolean;
}) {
  const { locale } = useI18n(),
    [search, setSearch] = useState('');
  const normalize = (value: string) =>
      value.toLocaleLowerCase(locale).replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').trim(),
    needle = normalize(search),
    showSearch = searchable && count > 8;
  const visible = children.filter(
    (child) =>
      !showSearch ||
      !needle ||
      (isValidElement(child) &&
        normalize(String((child.props as Record<string, unknown>)['data-search'] ?? '')).includes(
          needle,
        )),
  );
  return (
    <details
      className={
        'phone-facet' + (selected ? ' has-selection' : '') + (memory ? ' phone-facet-memory' : '')
      }
      open={initiallyOpen || !!selected}
    >
      <summary>
        <span>
          {title}
          <small>{selected ?? (locale === 'fa' ? 'همه' : 'All')}</small>
        </span>
        <ChevronDown size={16} />
      </summary>
      <div className="phone-facet-content">
        {showSearch && (
          <label className="phone-facet-search">
            <Search size={15} />
            <input
              aria-label={(locale === 'fa' ? 'جست‌وجو در ' : 'Search ') + title}
              placeholder={locale === 'fa' ? 'جست‌وجو در ' + title + '…' : 'Search ' + title + '…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={120}
            />
            {search && (
              <button
                type="button"
                aria-label={
                  locale === 'fa' ? 'پاک کردن جست‌وجوی ' + title : 'Clear ' + title + ' search'
                }
                onClick={() => setSearch('')}
              >
                <X size={13} />
              </button>
            )}
          </label>
        )}
        <div className="phone-facet-values">
          {visible.length ? (
            visible
          ) : (
            <p className="phone-facet-empty">
              {locale === 'fa' ? 'گزینه‌ای پیدا نشد.' : 'No options found.'}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
function PhoneCard({ item, query }: { item: PhoneItem; query: PhoneSearch }) {
  const { locale, digits } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    matches = matchingPhoneChoices(item.configurations, query),
    choice = matches[0] ?? item.configurations[0],
    href =
      '/market/' +
      item.id +
      '?configuration=' +
      choice.id +
      '&' +
      new URLSearchParams({ back: phoneQueryParams(query).toString() }).toString(),
    colors = [...new Map(matches.map((c) => [c.colorKey, c])).values()],
    specs = item.specifications.slice(0, 3),
    capacities = (key: 'ramGb' | 'storageGb') =>
      [...new Set(matches.map((c) => c[key]))]
        .sort((a, b) => a - b)
        .map(digits)
        .join(' / ');
  return (
    <article className="phone-card">
      <div className="phone-card-top">
        <span>{item.model.brand}</span>
        <CompareButton id={item.id} />
      </div>
      <Link className="phone-card-image" href={href}>
        <Image
          src={choice.imageUrl ?? item.model.image}
          alt={item.model.name}
          width={260}
          height={250}
        />
      </Link>
      <div className="phone-card-body">
        <div className="phone-card-colors" aria-label={text('رنگ‌های مدل', 'Model colours')}>
          {colors.map((c) => (
            <i
              key={c.colorKey}
              className="phone-color-dot"
              title={locale === 'fa' ? c.colorNameFa : c.colorNameEn}
              style={{ background: c.colorHex ?? '#aaa' }}
            />
          ))}
        </div>
        <Link href={href}>
          <h2>{item.model.name}</h2>
        </Link>
        <p className="phone-card-english" dir="ltr">
          {item.model.englishName}
        </p>
        <div className="phone-memory-chips">
          <span>
            {text('رم', 'RAM')} {query.ramGb ? digits(choice.ramGb) : capacities('ramGb')} GB
          </span>
          <span>{query.storageGb ? digits(choice.storageGb) : capacities('storageGb')} GB</span>
          <span>
            {digits(colors.length)} {text('رنگ', 'colours')}
          </span>
        </div>
        <dl className="phone-card-specs">
          {specs.map((spec) => (
            <div key={spec.key}>
              <dt>{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          ))}
        </dl>
        <p className="phone-card-state">
          {choice.availableInStore
            ? text('این ترکیب در فروشگاه موجود است', 'This configuration is in store')
            : text('قابل درخواست برای تأمین', 'Available to request')}
        </p>
        {item.isDemo && (
          <small className="phone-demo">
            {text('نمونهٔ توسعه از مدل واقعی', 'Development sample of a real model')}
          </small>
        )}
        <Link className="button button-primary full" href={href}>
          {text('انتخاب رنگ و حافظه', 'Choose colour and memory')}
          <ArrowLeft size={16} />
        </Link>
      </div>
    </article>
  );
}
export function PhoneDetail({ item }: { item: PhoneItem }) {
  const { locale, digits } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    params = useSearchParams(),
    initial =
      item.configurations.find((c) => c.id === params.get('configuration')) ??
      item.configurations[0],
    [choiceId, setChoiceId] = useState(initial.id),
    [memoryChangedFor, setMemoryChangedFor] = useState<string>(),
    [quantity, setQuantity] = useState(1),
    sourcing = useSourcing(),
    colors = [...new Map(item.configurations.map((c) => [c.colorKey, c])).values()],
    memories = [
      ...new Map(item.configurations.map((c) => [c.ramGb + ':' + c.storageGb, c])).values(),
    ];
  const choice = item.configurations.find((c) => c.id === choiceId) ?? initial;
  useEffect(() => {
    setChoiceId(initial.id);
  }, [initial.id, item.id]);
  let back = '/market';
  try {
    const p = new URLSearchParams(params.get('back') ?? '');
    if (
      [...p.keys()].every((k) =>
        ['q', 'brand', 'ram', 'storage', 'color', 'page', 'size'].includes(k),
      )
    )
      back = '/market' + (p.size ? '?' + p.toString() : '');
  } catch {
    /* Keep the bounded default catalogue return path. */
  }
  const current = sourcing?.cart?.lines.find((l) => l.listingId === item.id),
    selected = current?.configurationId === choice.id;
  function choose(c: PhoneChoice) {
    setMemoryChangedFor(
      c.colorKey !== choice.colorKey &&
        (c.ramGb !== choice.ramGb || c.storageGb !== choice.storageGb)
        ? c.id
        : undefined,
    );
    setChoiceId(c.id);
    const p = new URLSearchParams(params.toString());
    p.set('configuration', c.id);
    window.history.replaceState(null, '', '?' + p.toString());
  }
  return (
    <main className="container phone-market phone-detail">
      <nav className="phone-breadcrumb">
        <Link href={back}>{text('بازگشت به گوشی‌ها', 'Back to phones')}</Link>
        <span>/</span>
        <span>{item.model.name}</span>
      </nav>
      <section className="phone-detail-grid">
        <div className="phone-gallery">
          <Image
            src={choice.imageUrl ?? item.model.image}
            alt={
              item.model.name + ' ' + (locale === 'fa' ? choice.colorNameFa : choice.colorNameEn)
            }
            width={560}
            height={560}
            priority
          />
          <div className="phone-gallery-thumbs">
            {colors.map((c) => (
              <button
                key={c.colorKey}
                aria-label={locale === 'fa' ? c.colorNameFa : c.colorNameEn}
                aria-pressed={c.colorKey === choice.colorKey}
                onClick={() =>
                  choose(
                    item.configurations.find(
                      (v) =>
                        v.colorKey === c.colorKey &&
                        v.ramGb === choice.ramGb &&
                        v.storageGb === choice.storageGb,
                    ) ?? c,
                  )
                }
              >
                <Image src={c.imageUrl ?? item.model.image} alt="" width={70} height={70} />
              </button>
            ))}
          </div>
        </div>
        <div className="phone-detail-information">
          <div className="phone-detail-brand">
            <span>{item.model.brand}</span>
            <CompareButton id={item.id} />
          </div>
          <h1>{item.model.name}</h1>
          <p className="phone-card-english" dir="ltr">
            {item.model.englishName}
          </p>
          <p>{item.model.description}</p>
          {item.isDemo && (
            <p className="phone-demo">
              {text(
                'مدل واقعی، دادهٔ نمونهٔ توسعه؛ به‌معنی موجودی قابل فروش نیست.',
                'Real model, Development sample data. This does not assert store stock.',
              )}
            </p>
          )}
          <fieldset className="phone-choice-group">
            <legend>
              {text('رنگ', 'Colour')}:{' '}
              <strong>{locale === 'fa' ? choice.colorNameFa : choice.colorNameEn}</strong>
            </legend>
            <div>
              {colors.map((c) => (
                <button
                  key={c.colorKey}
                  className="phone-choice"
                  aria-pressed={c.colorKey === choice.colorKey}
                  onClick={() =>
                    choose(
                      item.configurations.find(
                        (v) =>
                          v.colorKey === c.colorKey &&
                          v.ramGb === choice.ramGb &&
                          v.storageGb === choice.storageGb,
                      ) ?? c,
                    )
                  }
                >
                  <i className="phone-color-dot" style={{ background: c.colorHex ?? '#aaa' }} />
                  {locale === 'fa' ? c.colorNameFa : c.colorNameEn}
                  {c.colorKey === choice.colorKey && <Check size={15} />}
                </button>
              ))}
            </div>
          </fieldset>
          {memoryChangedFor === choice.id && (
            <p className="phone-choice-notice" role="status">
              {text(
                `این رنگ با حافظهٔ قبلی ارائه نشده؛ انتخاب به رم ${digits(choice.ramGb)} و حافظهٔ ${digits(choice.storageGb)} گیگابایت تغییر کرد.`,
                `This colour is not offered with the previous memory. Selection changed to ${digits(choice.ramGb)} GB RAM and ${digits(choice.storageGb)} GB storage.`,
              )}
            </p>
          )}
          <fieldset className="phone-choice-group">
            <legend>{text('رم و حافظه داخلی', 'RAM and storage')}</legend>
            <div>
              {memories.map((c) => {
                const valid = item.configurations.find(
                  (v) =>
                    v.ramGb === c.ramGb &&
                    v.storageGb === c.storageGb &&
                    v.colorKey === choice.colorKey,
                );
                return (
                  <button
                    key={c.ramGb + ':' + c.storageGb}
                    className="phone-choice"
                    disabled={!valid}
                    aria-pressed={c.ramGb === choice.ramGb && c.storageGb === choice.storageGb}
                    onClick={() => valid && choose(valid)}
                  >
                    <bdi>
                      {digits(c.ramGb)} / {digits(c.storageGb)} GB
                    </bdi>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <section className="phone-request-box">
            <h2>
              {choice.availableInStore
                ? text('قابل خرید از فروشگاه', 'Available in store')
                : text('این ترکیب را برایت تأمین کنیم', 'Let us source this configuration')}
            </h2>
            <p>
              {text(
                'قیمت و زمان تأمین را فروشگاه پس از بررسی اعلام می‌کند. قبل از تأیید پیشنهاد، مبلغی پرداخت نمی‌کنی.',
                'The store confirms price and timing after review. No payment is due before you accept its offer.',
              )}
            </p>
            {choice.availableInStore && choice.storeSlug && choice.variantId ? (
              <Link
                className="button button-primary full"
                href={
                  '/product/' +
                  choice.storeSlug +
                  '?variant=' +
                  encodeURIComponent(choice.variantId)
                }
              >
                <ShoppingBag size={18} />
                {text('دیدن پیشنهاد موجود فروشگاه', 'View available store offer')}
              </Link>
            ) : (
              <>
                <label className="phone-quantity">
                  {text('تعداد', 'Quantity')}
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    value={quantity}
                    onChange={(e) => {
                      setQuantity(Number(e.target.value));
                    }}
                  />
                </label>
                {current && !selected && (
                  <p className="small-note">
                    {text(
                      'یک ترکیب دیگر از این مدل در سبد است؛ افزودن، انتخاب قبلی را با همین رنگ و حافظه جایگزین می‌کند.',
                      'Another configuration of this model is in your cart. Adding this choice replaces that configuration.',
                    )}
                  </p>
                )}
                <Button
                  className="full"
                  disabled={
                    !sourcing?.ready ||
                    sourcing.busy ||
                    sourcing.locked ||
                    sourcing.unknown ||
                    !choice.canRequest ||
                    !Number.isSafeInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 1000000
                  }
                  onClick={() => void sourcing?.add(item.id, quantity, choice.id)}
                >
                  {sourcing?.busy
                    ? text('در حال ذخیره…', 'Saving…')
                    : text('افزودن پیش‌سفارش به سبد', 'Add sourcing preorder to cart')}
                  <ShoppingBag size={18} />
                </Button>
                {sourcing?.error && (
                  <SourcingError code={sourcing.error} unknown={sourcing.unknown} />
                )}
                <p className="small-note">
                  {text(
                    'پیش‌سفارش بدون قیمت، درخواست بررسی تأمین است.',
                    'An unpriced preorder is a sourcing enquiry.',
                  )}
                </p>
              </>
            )}
            {selected && (
              <p className="phone-added" role="status">
                <Check size={17} />
                {text('انتخاب شما در سبد قرار گرفت.', 'Your choice is in the cart.')}{' '}
                <Link href="/cart#sourcing">{text('دیدن و ثبت درخواست', 'Review and submit')}</Link>
              </p>
            )}
            <PhoneInterestAction
              listingId={item.id}
              configurationId={choice.id}
              canNotify={choice.canNotify}
            />
          </section>
        </div>
      </section>
      <section className="card-panel phone-full-specs">
        <h2>{text('مشخصات مدل', 'Model specifications')}</h2>
        <p className="small-note">
          {text(
            'رنگ و حافظهٔ انتخابی بالا ملاک درخواست شماست.',
            'Your selected colour and memory above define your request.',
          )}
        </p>
        <dl>
          {item.specifications.map((spec) => (
            <div key={spec.key}>
              <dt>{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <CompareTray />
    </main>
  );
}
export function PhoneComparison({ items }: { items: PhoneItem[] }) {
  const { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    keys = [...new Set(items.flatMap((i) => i.specifications.map((s) => s.key)))];
  return (
    <main className="container phone-market">
      <Link href="/market">{text('بازگشت به کاتالوگ گوشی', 'Back to phone discovery')}</Link>
      <h1>{text('مقایسه مشخصات گوشی‌ها', 'Compare phone specifications')}</h1>
      <p>
        {text(
          'تا چهار مدل؛ برای قیمت و زمان تأمین، ترکیب دلخواه را انتخاب کنید.',
          'Compare up to four models. Choose a configuration to request a price and sourcing time.',
        )}
      </p>
      {items.length ? (
        <div className="phone-compare-scroll">
          <table className="phone-compare-table">
            <thead>
              <tr>
                <th>{text('مدل', 'Model')}</th>
                {items.map((i) => (
                  <th key={i.id}>
                    <Image src={i.model.image} alt={i.model.name} width={180} height={180} />
                    <Link href={'/market/' + i.id}>{i.model.name}</Link>
                    <CompareButton id={i.id} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{text('رنگ‌ها', 'Colours')}</th>
                {items.map((i) => (
                  <td key={i.id}>
                    {[
                      ...new Map(
                        i.configurations.map((c) => [
                          c.colorKey,
                          locale === 'fa' ? c.colorNameFa : c.colorNameEn,
                        ]),
                      ).values(),
                    ].join('، ')}
                  </td>
                ))}
              </tr>
              <tr>
                <th>{text('رم / حافظه', 'RAM / storage')}</th>
                {items.map((i) => (
                  <td key={i.id}>
                    {[
                      ...new Set(
                        i.configurations.map((c) => c.ramGb + ' / ' + c.storageGb + ' GB'),
                      ),
                    ].join('، ')}
                  </td>
                ))}
              </tr>
              {keys.map((k) => (
                <tr key={k}>
                  <th>
                    {items.flatMap((i) => i.specifications).find((s) => s.key === k)?.label ?? k}
                  </th>
                  {items.map((i) => (
                    <td key={i.id}>{i.specifications.find((s) => s.key === k)?.value ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          {text(
            'از کاتالوگ، مدل‌هایی برای مقایسه انتخاب کنید.',
            'Choose models from the catalogue to compare.',
          )}
        </p>
      )}
    </main>
  );
}
