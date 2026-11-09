import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from '@/components/navigation/localized-link';
import { GuideChecklist } from '@/components/guides/guide-checklist';
import { GuideLink } from '@/components/guides/guide-discovery';
import {
  findBuyingGuide,
  guidePath,
  guidesIntro,
  guidesPath,
  type GuideSlug,
} from '@/lib/content/buying-guides';
import { serverI18n } from '@/lib/navigation/server-locale';
import { guideStructuredData } from '@/lib/seo/guide-seo';
import { jsonLd, pageMetadata } from '@/lib/seo/seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const snapshot = await serverI18n();
  const guide = findBuyingGuide(slug, snapshot.locale);
  if (!guide) notFound();
  return pageMetadata(
    snapshot,
    snapshot.locale,
    guidePath(slug as GuideSlug),
    guide.title,
    guide.description,
  );
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const snapshot = await serverI18n();
  const { locale, site } = snapshot;
  const guide = findBuyingGuide(slug, locale);
  if (!guide) notFound();
  const fa = locale === 'fa';
  const used = slug === 'used-device-checklist';
  const showUsedCatalog = used && site.appearance?.showUsedProducts !== false;
  const data = guideStructuredData(snapshot, locale, slug as GuideSlug);
  return (
    <div className="container guide-page guide-article">
      {data.length > 0 && (
        <script
          type="application/ld+json"
          nonce={(await headers()).get('x-nonce') ?? undefined}
          dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
        />
      )}
      <nav className="guide-crumbs" aria-label={fa ? 'مسیر صفحه' : 'Breadcrumb'}>
        <Link href="/">{site.name}</Link>
        <Link href={guidesPath}>{guidesIntro[locale].title}</Link>
        <span aria-current="page">{guide.title}</span>
      </nav>
      <article>
        <header className="guide-hero">
          <h1>{guide.title}</h1>
          <p>{guide.description}</p>
          <p className="guide-byline">
            {fa ? 'تهیه‌شده توسط' : 'Prepared by'} {site.name}
          </p>
        </header>
        <div className="guide-body">
          <ol className="guide-steps">
            {guide.steps.map((step) => (
              <li key={step.title}>
                <h2>{step.title}</h2>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          {used && <GuideChecklist locale={locale} items={guide.steps.map((step) => step.title)} />}
        </div>
        <p className="guide-takeaway">{guide.takeaway}</p>
      </article>
      <div className="guide-actions">
        <Link
          className="button button-primary"
          href={showUsedCatalog ? '/catalog?condition=used' : '/catalog'}
        >
          {showUsedCatalog
            ? fa
              ? 'دیدن کالاهای کارکرده'
              : 'Browse used products'
            : fa
              ? 'دیدن کالاها'
              : 'Browse products'}
        </Link>
        <Link className="button button-outline" href={used ? '/support' : '/compare'}>
          {used
            ? fa
              ? 'پرسش از پشتیبانی'
              : 'Ask support'
            : fa
              ? 'باز کردن مقایسه'
              : 'Open comparison'}
        </Link>
      </div>
      <GuideLink locale={locale} slug={used ? 'compare-products' : 'used-device-checklist'} />
    </div>
  );
}
