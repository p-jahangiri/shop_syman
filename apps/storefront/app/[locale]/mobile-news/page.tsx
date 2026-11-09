import { Suspense } from 'react';
import { ArrowUpRight, BookOpen, Newspaper } from 'lucide-react';
import { developmentExamples, getOfficialNews } from '@/lib/content/shopping-content';
import { magazineGuides, magazineGuidePath, magazinePath } from '@/lib/content/magazine';
import { serverI18n } from '@/lib/navigation/server-locale';
import { pageMetadata } from '@/lib/seo/seo';
import Link from '@/components/navigation/localized-link';
import { MagazineCover } from '@/components/magazine/magazine-cover';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
import '@/components/magazine/magazine.css';

type Query = { examples?: string; source?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }) {
  const [snapshot, query] = await Promise.all([serverI18n(), searchParams]);
  const fa = snapshot.locale === 'fa';
  return pageMetadata(
    snapshot,
    snapshot.locale,
    magazinePath,
    fa
      ? 'مجلهٔ سایمان | خبر موبایل، راهنمای خرید و مقایسه'
      : 'Sayman Magazine | Mobile news and buying guides',
    fa
      ? 'خبرهای فارسی موبایل، مقایسهٔ گوشی و راهنماهای کاربردی برای خرید، باتری و لوازم جانبی.'
      : 'Mobile headlines, model comparisons and practical buying guides.',
    { noindex: query.examples !== undefined || query.source !== undefined },
  );
}

function newsAngle(title: string, locale: Locale) {
  const fa = locale === 'fa';
  if (/رجیستر|همتا|بازار|قیمت|واردات/i.test(title))
    return {
      cover: 'daily',
      note: fa
        ? 'پیش از تصمیم خرید، شرایط عرضه و هزینهٔ نهایی همان مدل در ایران را بررسی کنید.'
        : 'Check the exact model’s local availability and total cost before buying.',
    };
  if (/باتری|شارژ|charg|battery/i.test(title))
    return {
      cover: 'charging',
      note: fa
        ? 'برای مقایسه، توان شارژ گوشی، استاندارد آداپتور و کابل سازگار را کنار هم ببینید.'
        : 'Compare the phone’s charging limit, adapter standard and compatible cable together.',
    };
  if (/سیری|siri/i.test(title))
    return {
      cover: 'inspection',
      note: fa
        ? 'اگر قابلیت تازه هنوز در حد گزارش است، مدل‌های سازگار و زبان‌های پشتیبانی‌شده را پس از اعلام رسمی بررسی کنید.'
        : 'For a reported feature, check supported models and languages after the official announcement.',
    };
  if (/5g|سیم‌کارت|ایرانسل/i.test(title))
    return {
      cover: 'daily',
      note: fa
        ? 'برای استفاده از شبکهٔ نسل پنجم، پوشش در مسیرهای روزمره و سازگاری نسخهٔ گوشی با اپراتور را بررسی کنید.'
        : 'For 5G, check coverage along your daily routes and whether your phone variant works with your carrier.',
    };
  if (/آپدیت|به.روزرسانی|اندروید \d|one ui|ios|update/i.test(title))
    return {
      cover: 'inspection',
      note: fa
        ? 'مدل و منطقهٔ دستگاه تعیین می‌کند چه زمانی می‌توانید به‌روزرسانی را دریافت کنید.'
        : 'Check the rollout for your device model and region.',
    };
  return {
    cover: 'compare',
    note: fa
      ? 'اگر این مدل را برای خرید بررسی می‌کنید، نسخهٔ دقیق، حافظه و زمان عرضه را در منبع ببینید.'
      : 'If you are considering this model, check its exact version, storage and availability at the source.',
  };
}

async function NewsDesk({ locale, source }: { locale: Locale; source?: string }) {
  const result = await getOfficialNews(locale);
  const fa = locale === 'fa';
  const date = new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Tehran',
  });
  const items = result?.feed.items ?? [];
  const sources = [...new Set(items.flatMap((item) => (item.source ? [item.source] : [])))];
  const selected = sources.find((entry) => entry === source);
  if (!items.length)
    return (
      <p className="magazine-empty">
        {fa
          ? 'دریافت خبرهای تازه موقتاً در دسترس نیست. راهنماهای سایمان در همین صفحه در دسترس‌اند.'
          : 'Fresh headlines are temporarily unavailable. Sayman’s guides are available below.'}
      </p>
    );
  const lead = items.find((item) => item.imageUrl) ?? items[0];
  const firstBySource = sources
    .filter((entry) => entry !== lead.source)
    .map((entry) => items.find((item) => item.source === entry)!)
    .sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)));
  const front = [lead, ...firstBySource];
  const displayed = selected
    ? items.filter((item) => item.source === selected)
    : [...front, ...items.filter((item) => !front.includes(item))];
  const cards = displayed.map((item, index) => {
    const angle = newsAngle(item.title, locale);
    return (
      <article className="magazine-news-card" data-lead={!selected && index === 0} key={item.url}>
        <MagazineCover
          cover={angle.cover}
          imageUrl={item.imageUrl}
          sizes="(max-width: 650px) 92vw, (max-width: 1000px) 45vw, 30vw"
          labels={{
            source: fa ? 'تصویر از منبع' : 'Image from publisher',
            illustration: fa ? 'تصویر موضوعی' : 'Topic illustration',
          }}
        />
        <div className="magazine-news-copy">
          <p className="magazine-news-meta">
            <strong>{item.source}</strong>
            <time dateTime={item.publishedAt}>{date.format(new Date(item.publishedAt))}</time>
          </p>
          <h3>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title}
              <span className="sr-only"> {fa ? '(تب جدید)' : '(new tab)'}</span>
            </a>
          </h3>
          {item.summary && <p className="magazine-summary">{item.summary}</p>}
          <p className="magazine-angle">
            <strong>{fa ? 'نکتهٔ خرید' : 'Buying note'}</strong> {angle.note}
          </p>
          <a
            className="text-link magazine-source-link"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={
              fa
                ? `خواندن «${item.title}» در منبع، تب جدید`
                : `Read “${item.title}” at the source, new tab`
            }
          >
            {fa ? 'خواندن اصل خبر' : 'Read the original'}{' '}
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
      </article>
    );
  });
  return (
    <>
      <div className="magazine-news-toolbar">
        {sources.length > 1 && (
          <nav
            className="magazine-source-filters"
            aria-label={fa ? 'فیلتر رسانهٔ خبر' : 'Filter news by publisher'}
          >
            <Link
              href={magazinePath + '#latest-mobile'}
              aria-current={!selected ? 'true' : undefined}
            >
              {fa ? 'همهٔ رسانه‌ها' : 'All publishers'}
            </Link>
            {sources.map((entry) => (
              <Link
                key={entry}
                href={`${magazinePath}?source=${encodeURIComponent(entry)}#latest-mobile`}
                aria-current={selected === entry ? 'true' : undefined}
              >
                {entry}
              </Link>
            ))}
          </nav>
        )}
        {result?.feed.refreshedAt && (
          <p className="magazine-status">
            {result.feed.stale
              ? fa
                ? 'آخرین خبرهای دریافت‌شده'
                : 'Last available headlines'
              : fa
                ? 'آخرین دریافت'
                : 'Last checked'}{' '}
            ·{' '}
            <time dateTime={result.feed.refreshedAt}>
              {date.format(new Date(result.feed.refreshedAt))}
            </time>
          </p>
        )}
      </div>
      <div className="magazine-news-grid" data-front-page={!selected}>
        {cards.slice(0, 5)}
      </div>
      {cards.length > 5 && (
        <details className="magazine-news-more">
          <summary>{fa ? 'خبرهای بیشتر' : 'More headlines'}</summary>
          <div className="magazine-news-grid">{cards.slice(5)}</div>
        </details>
      )}
    </>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const [snapshot, query] = await Promise.all([serverI18n(), searchParams]);
  const { locale } = snapshot;
  const fa = locale === 'fa';
  const examples = query.examples === '1' && (await developmentExamples());
  const [lead] = magazineGuides;
  return (
    <div className="container magazine">
      <header className="magazine-hero">
        <div className="magazine-intro">
          <span className="magazine-kicker">
            <BookOpen size={18} aria-hidden="true" />{' '}
            {fa ? 'راهنمای خرید دیجیتال' : 'The tech buying magazine'}
          </span>
          <h1>{fa ? 'مجلهٔ سایمان' : 'Sayman Magazine'}</h1>
          <p>
            {fa
              ? 'از خبرهای تازهٔ موبایل تا سؤال‌هایی که پیش از خرید باید بپرسید.'
              : 'From the latest mobile stories to the questions worth asking before you buy.'}
          </p>
          <nav className="magazine-actions" aria-label={fa ? 'بخش‌های مجله' : 'Magazine sections'}>
            <a className="magazine-action" href="#latest-mobile">
              {fa ? 'تازه‌های موبایل' : 'Latest mobile news'}
            </a>
            <a className="magazine-action magazine-action-outline" href="#sayman-guides">
              {fa ? 'راهنما و مقایسه' : 'Guides and comparisons'}
            </a>
          </nav>
        </div>
        <Link className="magazine-hero-feature" href={magazineGuidePath(lead.slug)}>
          <MagazineCover cover={lead.cover} priority sizes="(max-width: 680px) 90vw, 45vw" />
          <span>
            <small>{fa ? 'پیشنهاد تحریریه' : 'Editor’s pick'}</small>
            <strong>{lead.title[locale]}</strong>
            <ArrowUpRight size={20} aria-hidden="true" />
          </span>
        </Link>
      </header>
      <section id="latest-mobile" aria-labelledby="latest-mobile-heading">
        <div className="magazine-section-heading">
          <div>
            <span className="eyebrow">
              {fa ? 'از رسانه‌های فناوری' : 'From technology publishers'}
            </span>
            <h2 id="latest-mobile-heading">{fa ? 'تازه‌های موبایل' : 'Latest mobile news'}</h2>
          </div>
          <span className="magazine-section-note">
            <Newspaper size={17} aria-hidden="true" />
            {fa ? 'اصل خبر در تب جدید باز می‌شود' : 'Original stories open in a new tab'}
          </span>
        </div>
        <Suspense
          fallback={
            <p className="magazine-empty" role="status">
              {fa ? 'در حال دریافت تازه‌های موبایل…' : 'Loading mobile news…'}
            </p>
          }
        >
          <NewsDesk locale={locale} source={query.source} />
        </Suspense>
      </section>
      <section id="sayman-guides" aria-labelledby="sayman-guides-heading">
        <div className="magazine-section-heading">
          <div>
            <span className="eyebrow">{fa ? 'از تحریریهٔ سایمان' : 'From our editors'}</span>
            <h2 id="sayman-guides-heading">{fa ? 'پیش از خرید بخوانید' : 'Read before you buy'}</h2>
          </div>
          <Link className="text-link" href="/blog">
            {fa ? 'همهٔ نوشته‌های سایمان' : 'All Sayman articles'}{' '}
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="magazine-editorial">
          {magazineGuides.map((guide) => (
            <Link
              id={guide.anchor}
              href={magazineGuidePath(guide.slug)}
              className="magazine-article-card"
              key={guide.slug}
            >
              <MagazineCover
                cover={guide.cover}
                sizes="(max-width: 650px) 92vw, (max-width: 1000px) 45vw, 30vw"
              />
              <div className="magazine-article-copy">
                <span className="eyebrow">{guide.category[locale]}</span>
                <h3>{guide.title[locale]}</h3>
                <p>{guide.summary[locale]}</p>
                <span className="magazine-source-link">
                  {fa ? 'مطالعهٔ راهنما' : 'Read the guide'}{' '}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      {examples && (
        <p className="magazine-empty">
          {fa
            ? 'نمای نمونهٔ محیط توسعه. تیترهای رسانه‌ها از خوراک زنده دریافت می‌شوند.'
            : 'Development example view. Headlines come from live publisher feeds.'}
        </p>
      )}
      <nav className="magazine-footer" aria-label={fa ? 'خرید و مقایسه' : 'Shop and compare'}>
        <Link className="button button-outline" href="/catalog">
          {fa ? 'رفتن به فروشگاه' : 'Browse the shop'}
        </Link>
        <Link className="button button-outline" href="/budget-finder">
          {fa ? 'انتخاب با بودجهٔ من' : 'Shop by my budget'}
        </Link>
      </nav>
    </div>
  );
}
