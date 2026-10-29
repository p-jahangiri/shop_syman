import type { ReactNode } from 'react';
import type { CmsPageContent } from '../lib/cms-page-contract';
export function CmsPageView({
  content,
  locale,
  isDemo = false,
  link,
  afterHeader,
}: {
  content: CmsPageContent['fa'];
  locale: 'fa' | 'en';
  isDemo?: boolean;
  link: (href: string, label: string) => ReactNode;
  afterHeader?: ReactNode;
}) {
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
        {content.blocks.map((b) => (
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
              // eslint-disable-next-line @next/next/no-img-element -- This shared CMS preview also runs in Vite admin; preserve its runtime-independent renderer.
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
