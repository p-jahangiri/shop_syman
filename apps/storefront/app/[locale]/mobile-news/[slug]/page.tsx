import { ArrowUpRight, BookOpen } from 'lucide-react';
import { notFound } from 'next/navigation';
import Link from '@/components/navigation/localized-link';
import { MagazineCover } from '@/components/magazine/magazine-cover';
import { magazineGuides, magazineGuidePath, magazinePath } from '@/lib/content/magazine';
import { serverI18n } from '@/lib/navigation/server-locale';
import { pageMetadata } from '@/lib/seo/seo';
import '@/components/magazine/magazine.css';

type Props = { params: Promise<{ slug: string }> };

async function getGuide(params: Props['params']) {
  const { slug } = await params;
  const guide = magazineGuides.find((entry) => entry.slug === slug);
  if (!guide) notFound();
  return guide;
}

export async function generateMetadata({ params }: Props) {
  const [snapshot, guide] = await Promise.all([serverI18n(), getGuide(params)]);
  const { locale } = snapshot;
  return pageMetadata(
    snapshot,
    locale,
    magazineGuidePath(guide.slug),
    guide.title[locale],
    guide.summary[locale],
  );
}

export default async function Page({ params }: Props) {
  const [{ locale }, guide] = await Promise.all([serverI18n(), getGuide(params)]);
  const fa = locale === 'fa';
  const related = magazineGuides.filter((entry) => entry.slug !== guide.slug).slice(0, 3);
  return (
    <div className="container magazine magazine-reading">
      <Link href={magazinePath} className="text-link magazine-back">
        <BookOpen size={18} aria-hidden="true" /> {fa ? 'مجلهٔ سایمان' : 'Sayman Magazine'}
      </Link>
      <article>
        <header>
          <span className="eyebrow">
            {guide.category[locale]} · {fa ? 'تحریریهٔ سایمان' : 'Sayman editorial'}
          </span>
          <h1>{guide.title[locale]}</h1>
          <p className="magazine-deck">{guide.summary[locale]}</p>
          <MagazineCover cover={guide.cover} priority sizes="(max-width: 800px) 92vw, 760px" />
        </header>
        <div className="magazine-reading-body">
          {guide.sections.map((section) => (
            <section key={section.heading.en}>
              <h2>{section.heading[locale]}</h2>
              <p>{section.body[locale]}</p>
            </section>
          ))}
          {guide.references && (
            <aside aria-label={fa ? 'منابع' : 'References'} className="magazine-references">
              <h2>{fa ? 'منابع و مشخصات رسمی' : 'Official references'}</h2>
              <ul>
                {guide.references.map((ref) => (
                  <li key={ref.href}>
                    <a
                      className="text-link"
                      href={ref.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {ref.label[locale]} <ArrowUpRight size={15} aria-hidden="true" />
                      <span className="sr-only"> {fa ? '(تب جدید)' : '(new tab)'}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </article>
      <nav className="magazine-reading-more" aria-label={fa ? 'بیشتر بخوانید' : 'Read more'}>
        <h2>{fa ? 'بیشتر بخوانید' : 'Read more'}</h2>
        <ul>
          {related.map((entry) => (
            <li key={entry.slug}>
              <Link className="text-link" href={magazineGuidePath(entry.slug)}>
                {entry.title[locale]}
              </Link>
            </li>
          ))}
        </ul>
        <Link className="button button-outline" href="/catalog">
          {fa ? 'مرور کالاهای فروشگاه' : 'Browse the shop'}
        </Link>
      </nav>
    </div>
  );
}
