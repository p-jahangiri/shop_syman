import { ArrowLeft, BookOpen, ClipboardList, GitCompareArrows } from 'lucide-react';
import Link from '@/components/navigation/localized-link';
import {
  buyingGuides,
  guideSlugs,
  guidePath,
  guidesIntro,
  guidesPath,
  type GuideSlug,
} from '@/lib/content/buying-guides';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
import './guides.css';

export function GuideCards({ locale }: { locale: Locale }) {
  return (
    <div className="guide-card-grid">
      {guideSlugs.map((slug) => {
        const guide = buyingGuides[slug][locale];
        const Icon = slug === 'used-device-checklist' ? ClipboardList : GitCompareArrows;
        return (
          <Link className="guide-card" key={slug} href={guidePath(slug)}>
            <Icon className="guide-icon" size={24} aria-hidden="true" />
            <div>
              <strong>{guide.title}</strong>
              <p>{guide.description}</p>
            </div>
            <ArrowLeft className="guide-arrow" size={17} aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}

export function GuideDiscovery({ locale }: { locale: Locale }) {
  return (
    <section className="guide-discovery" aria-labelledby="buying-guides-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{locale === 'fa' ? 'پیش از انتخاب' : 'Before you choose'}</span>
          <h2 id="buying-guides-heading">{guidesIntro[locale].title}</h2>
        </div>
        <Link className="text-link" href={guidesPath}>
          {locale === 'fa' ? 'همهٔ راهنماها' : 'All buying guides'}
        </Link>
      </div>
      <GuideCards locale={locale} />
    </section>
  );
}

export function GuideLink({ locale, slug }: { locale: Locale; slug: GuideSlug }) {
  return (
    <Link className="guide-inline-link" href={guidePath(slug)}>
      <BookOpen size={19} aria-hidden="true" />
      <span>{buyingGuides[slug][locale].title}</span>
      <ArrowLeft className="guide-arrow" size={17} aria-hidden="true" />
    </Link>
  );
}
