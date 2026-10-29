import ContentImage from '@/components/content-image';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import NextLink from 'next/link';
import { serverI18n } from '@/lib/server-locale';
import { fetchBlogPost } from '@/lib/cms-blog-fetch';
import { pageMetadata, jsonLd } from '@/lib/seo';
import { blogPostStructuredData } from '@/lib/blog-seo';
import { localeHref } from '@/lib/i18n';
import { CmsPageView } from '@/components/cms-page-view';
import type { Locale } from '@/lib/types';
import '@/components/cms-page.css';
import '@/components/blog.css';
export const dynamic = 'force-dynamic';
const load = cache((slug: string, locale: Locale) =>
  fetchBlogPost(slug, locale, {
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_API_URL: process.env.SHOP_API_URL,
  }),
);
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const snapshot = await serverI18n(),
    { slug } = await params,
    result = await load(slug, snapshot.locale);
  if (result.status !== 'ready') return { robots: { index: false, follow: false } };
  const p = result.post;
  return pageMetadata(snapshot, snapshot.locale, '/blog/' + p.slug, p.title, p.description, {
    noindex: p.isDemo,
    ...(p.cover ? { image: p.cover } : {}),
  });
}
export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const snapshot = await serverI18n(),
    locale = snapshot.locale,
    { slug } = await params,
    result = await load(slug, locale);
  if (result.status === 'missing') notFound();
  if (result.status !== 'ready') throw Error('Article temporarily unavailable');
  const p = result.post,
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    format = (v: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
        dateStyle: 'medium',
        timeZone: 'Asia/Tehran',
      }).format(new Date(v)),
    data = blogPostStructuredData(snapshot, p, locale);
  return (
    <div className="container blog-article">
      <NextLink className="blog-back" href={localeHref('/blog', locale)}>
        {text('همهٔ مقاله‌ها', 'All articles')}
      </NextLink>
      {data.length > 0 && (
        <script
          nonce={(await headers()).get('x-nonce') ?? undefined}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
        />
      )}
      <CmsPageView
        content={{ title: p.title, description: p.description, blocks: p.blocks }}
        locale={locale}
        isDemo={p.isDemo}
        link={(href, label) => <NextLink href={localeHref(href, locale)}>{label}</NextLink>}
        afterHeader={
          <div className="blog-article-meta">
            <p>
              {text('نویسنده: ', 'By: ')}
              {p.byline}
            </p>
            <p>
              {text('اولین انتشار: ', 'First published: ')}
              <time dateTime={p.firstPublishedAt}>{format(p.firstPublishedAt)}</time>
              {p.publishedAt !== p.firstPublishedAt && (
                <>
                  {' '}
                  · {text('به‌روزرسانی: ', 'Updated: ')}
                  <time dateTime={p.publishedAt}>{format(p.publishedAt)}</time>
                </>
              )}
            </p>
            <div className="blog-tags">
              {p.tags.map((tag) => (
                <NextLink key={tag.slug} href={localeHref('/blog?tag=' + tag.slug, locale)}>
                  {tag.name}
                </NextLink>
              ))}
            </div>
            {p.cover && (
              <div className="blog-cover">
                <ContentImage
                  fill
                  sizes="(max-width: 1100px) 100vw, 1100px"
                  src={p.cover}
                  alt={p.coverAlt ?? ''}
                  decoding="async"
                  fetchPriority="high"
                />
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
