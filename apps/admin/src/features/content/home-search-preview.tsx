import { homeSearchText } from '@sayman/web-shared/lib/content/home-search-text.ts';
import type { SiteContent } from '@sayman/web-shared/lib/shared/types.ts';

type SearchSite = Pick<SiteContent, 'name' | 'tagline' | 'about' | 'seo'>;

function publishedSite(json?: string): SearchSite | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json);
    return value &&
      typeof value.name === 'string' &&
      typeof value.tagline === 'string' &&
      typeof value.about === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}

export function HomeSearchPreview({
  draft,
  publishedJson,
  sharedPublishedJson,
  locale,
}: {
  draft: SearchSite;
  publishedJson?: string;
  sharedPublishedJson?: string;
  locale: 'fa' | 'en';
}) {
  const published = publishedSite(publishedJson);
  const shared = publishedSite(sharedPublishedJson);
  if (published && shared)
    published.seo = { ...published.seo, allowIndexing: shared.seo?.allowIndexing };
  const entries = [
    { label: 'پیش‌نمایش ویرایش فعلی', site: draft },
    { label: 'متن نسخهٔ منتشرشده', site: published },
  ];
  return (
    <div className="cms-search-review" dir="rtl">
      <div className="cms-search-review-grid">
        {entries.map(({ label, site }) => {
          const snippet = site && homeSearchText(site);
          return (
            <article key={label}>
              <h3>{label}</h3>
              {snippet ? (
                <>
                  <div dir={locale === 'en' ? 'ltr' : 'rtl'} lang={locale}>
                    <strong>
                      {snippet.title} | {snippet.name}
                    </strong>
                    <p>{snippet.description}</p>
                  </div>
                  <small>
                    {site?.seo?.allowIndexing === true
                      ? 'اجازهٔ نمایه‌سازی در سند روشن است.'
                      : 'اجازهٔ نمایه‌سازی در سند خاموش است.'}
                  </small>
                </>
              ) : (
                <p>هنوز نسخهٔ منتشرشده‌ای برای این زبان در دسترس نیست.</p>
              )}
            </article>
          );
        })}
      </div>
      <small>
        این پیش‌نمایش متن ارسالی فروشگاه است. گوگل ممکن است متن دیگری از صفحه نمایش دهد.
      </small>
    </div>
  );
}
