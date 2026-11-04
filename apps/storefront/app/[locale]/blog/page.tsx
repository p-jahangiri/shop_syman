import ContentImage from '@/components/media/content-image';
import { cache } from 'react';
import NextLink from 'next/link';
import { serverI18n } from '@/lib/navigation/server-locale';
import { fetchBlogList } from '@/lib/content/cms-blog-fetch';
import { pageMetadata } from '@/lib/seo/seo';
import { localeHref } from '@/lib/navigation/i18n';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
import '@sayman/web-shared/components/content/blog.css';
export const dynamic = 'force-dynamic';
type Query = Record<string, string | string[] | undefined>;
const load = cache((locale: Locale, tag: unknown, cursor: unknown) =>
  fetchBlogList(locale, tag, cursor, {
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_API_URL: process.env.SHOP_API_URL,
  }),
);
export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }) {
  const snapshot = await serverI18n(),
    q = await searchParams;
  return pageMetadata(
    snapshot,
    snapshot.locale,
    '/blog',
    snapshot.locale === 'fa' ? 'مجلهٔ ' + snapshot.site.name : snapshot.site.name + ' Journal',
    snapshot.locale === 'fa' ? 'نوشته‌های منتشرشدهٔ فروشگاه' : 'Published articles from the store',
    { noindex: !!q.tag || !!q.cursor },
  );
}
export default async function BlogIndex({ searchParams }: { searchParams: Promise<Query> }) {
  const snapshot = await serverI18n(),
    locale = snapshot.locale,
    q = await searchParams,
    result = await load(locale, q.tag, q.cursor);
  if (result.status !== 'ready') throw Error('Articles temporarily unavailable');
  const list = result.list,
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    format = (v: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
        dateStyle: 'medium',
        timeZone: 'Asia/Tehran',
      }).format(new Date(v)),
    href = (tag: string | null, cursor: string | null) => {
      const params = new URLSearchParams();
      if (tag) params.set('tag', tag);
      if (cursor) params.set('cursor', cursor);
      return localeHref('/blog' + (params.size ? '?' + params : ''), locale);
    };
  return (
    <div className="container blog-index">
      <header className="blog-heading">
        <p className="eyebrow">{text('از مجلهٔ فروشگاه', 'From the store journal')}</p>
        <h1>{text('مجلهٔ ' + snapshot.site.name, snapshot.site.name + ' Journal')}</h1>
        <p>
          {text(
            'نوشته‌ها و راهنماهای منتشرشدهٔ فروشگاه؛ با جزئیات و تاریخ انتشار روشن.',
            'Published articles and guides, with clear details and publication dates.',
          )}
        </p>
        {list.tag && (
          <NextLink href={href(null, null)}>
            {text('دیدن همهٔ مقاله‌ها', 'View all articles')}
          </NextLink>
        )}
      </header>
      {list.items.length === 0 ? (
        <div className="card-panel">
          <p>
            {list.tag
              ? text(
                  'مقاله‌ای با این برچسب منتشر نشده است.',
                  'No articles have been published with this tag.',
                )
              : text('هنوز مقاله‌ای منتشر نشده است.', 'No articles have been published yet.')}
          </p>
        </div>
      ) : (
        <div className="blog-grid">
          {list.items.map((post) => (
            <article className="blog-card" key={post.id}>
              {post.cover && (
                <NextLink href={localeHref('/blog/' + post.slug, locale)}>
                  <ContentImage
                    src={post.cover}
                    alt={post.coverAlt ?? ''}
                    width={800}
                    height={500}
                    sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
                    style={{ height: 'auto' }}
                    loading="lazy"
                  />
                </NextLink>
              )}
              <div>
                {post.isDemo && (
                  <p className="cms-page-demo">
                    {text('محتوای نمونهٔ توسعه', 'Development sample')}
                  </p>
                )}
                <time dateTime={post.firstPublishedAt}>{format(post.firstPublishedAt)}</time>
                <h2>
                  <NextLink href={localeHref('/blog/' + post.slug, locale)}>{post.title}</NextLink>
                </h2>
                <p>{post.description}</p>
                <p className="blog-byline">
                  {text('نویسنده: ', 'By: ')}
                  {post.byline}
                </p>
                <div className="blog-tags">
                  {post.tags.map((tag) => (
                    <NextLink key={tag.slug} href={href(tag.slug, null)}>
                      {tag.name}
                    </NextLink>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <nav
        className="blog-pagination"
        aria-label={text('صفحه‌بندی مقاله‌ها', 'Article pagination')}
      >
        {q.cursor && (
          <NextLink href={href(list.tag, null)}>
            {text('تازه‌ترین مقاله‌ها', 'Newest articles')}
          </NextLink>
        )}
        {list.nextCursor && (
          <NextLink className="button button-secondary" href={href(list.tag, list.nextCursor)}>
            {text('مقاله‌های بیشتر', 'More articles')}
          </NextLink>
        )}
      </nav>
    </div>
  );
}
