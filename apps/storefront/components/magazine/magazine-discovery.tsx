import { ArrowUpRight, BookOpen } from 'lucide-react';
import Link from '@/components/navigation/localized-link';
import { magazineGuides, magazineGuidePath, magazinePath } from '@/lib/content/magazine';
import { MagazineCover } from './magazine-cover';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
import './magazine.css';

export function MagazineDiscovery({ locale }: { locale: Locale }) {
  const fa = locale === 'fa';
  const [lead, ...rest] = magazineGuides;
  return (
    <section className="magazine-discovery" aria-labelledby="home-magazine">
      <Link href={magazineGuidePath(lead.slug)} className="magazine-discovery-lead">
        <MagazineCover cover={lead.cover} sizes="(max-width: 680px) 90vw, 40vw" />
        <span>
          <small>{lead.category[locale]}</small>
          <strong>{lead.title[locale]}</strong>
        </span>
      </Link>
      <div className="magazine-discovery-copy">
        <span className="magazine-kicker">
          <BookOpen size={17} aria-hidden="true" />{' '}
          {fa ? 'خواندنی‌های سایمان' : 'The Sayman reading list'}
        </span>
        <h2 id="home-magazine">{fa ? 'مجلهٔ سایمان' : 'Sayman Magazine'}</h2>
        <p>
          {fa
            ? 'تازه‌های موبایل، مقایسه و نکته‌های کاربردی برای خرید.'
            : 'Mobile news, comparisons and practical buying advice.'}
        </p>
        <ul>
          {rest.slice(0, 2).map((guide) => (
            <li key={guide.slug}>
              <Link href={magazineGuidePath(guide.slug)}>{guide.title[locale]}</Link>
            </li>
          ))}
        </ul>
        <Link className="magazine-action" href={magazinePath}>
          {fa ? 'خبرها و راهنماهای مجله' : 'Explore news and guides'}{' '}
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
