import type { ReactNode } from 'react';
import type { CmsPageContent } from '../../lib/content/cms-page-contract';
export function CmsPageView({
  content,
  locale,
  isDemo = false,
  link,
  canLink,
  afterHeader,
}: {
  content: CmsPageContent['fa'];
  locale: 'fa' | 'en';
  isDemo?: boolean;
  link: (href: string, label: string) => ReactNode;
  canLink?: (href: string) => boolean;
  afterHeader?: ReactNode;
}) {
  const blocks = content.blocks.flatMap((block) => {
    if (block.kind !== 'Links' || !canLink) return [block];
    const links = block.links.filter(({ href }) => canLink(href));
    return links.length ? [{ ...block, links }] : [];
  });
  return (
    <article className="cms-page-view" lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {isDemo && (
        <p className="cms-page-demo" role="note">
          {locale === 'fa'
            ? 'محتوای نمونهٔ توسعه؛ سیاست واقعی فروشگاه نیست.'
            : 'Development sample; not store policy.'}
        </p>
      )}
      <header>
        <h1>{content.title}</h1>
        {content.description && <p>{content.description}</p>}
      </header>
      {afterHeader}
      <div className="cms-page-blocks">
        {blocks.map((b) => (
          <section
            key={b.id}
            className={`cms-page-block cms-page-${b.kind.toLowerCase()} cms-page-${b.visibility.toLowerCase()}`}
          >
            {b.kind === 'Text' || b.kind === 'Callout' ? (
              <>
                {b.heading && <h2>{b.heading}</h2>}
                <p>{b.text}</p>
              </>
            ) : b.kind === 'Image' ? (
              <img src={b.image} alt={b.alt} loading="lazy" decoding="async" />
            ) : (
              <>
                {b.heading && <h2>{b.heading}</h2>}
                <ul>
                  {b.links.map((item, i) => (
                    <li key={i}>{link(item.href, item.label)}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
