import { headers } from 'next/headers';
import { GuideCards } from '@/components/guides/guide-discovery';
import { BudgetFinderLink } from '@/components/budget-finder/budget-finder-link';
import Link from '@/components/navigation/localized-link';
import { guidesIntro, guidesPath } from '@/lib/content/buying-guides';
import { serverI18n } from '@/lib/navigation/server-locale';
import { guideStructuredData } from '@/lib/seo/guide-seo';
import { jsonLd, pageMetadata } from '@/lib/seo/seo';

export async function generateMetadata() {
  const snapshot = await serverI18n();
  const { title, description } = guidesIntro[snapshot.locale];
  return pageMetadata(snapshot, snapshot.locale, guidesPath, title, description);
}

export default async function GuidesPage() {
  const snapshot = await serverI18n();
  const { locale, site } = snapshot;
  const { title, description } = guidesIntro[locale];
  const data = guideStructuredData(snapshot, locale);
  return (
    <div className="container guide-page">
      {data.length > 0 && (
        <script
          type="application/ld+json"
          nonce={(await headers()).get('x-nonce') ?? undefined}
          dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
        />
      )}
      <nav className="guide-crumbs" aria-label={locale === 'fa' ? 'مسیر صفحه' : 'Breadcrumb'}>
        <Link href="/">{site.name}</Link>
        <span aria-current="page">{title}</span>
      </nav>
      <header className="guide-hero">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <GuideCards locale={locale} />
      <BudgetFinderLink locale={locale} />
    </div>
  );
}
