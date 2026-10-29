import { PhoneComparison } from '@/components/phone-market';
import { getPhoneItem } from '@/lib/phone-discovery-server';
import { marketIdSchema } from '@/lib/market-contract';
import { serverI18n } from '@/lib/server-locale';
import { pageMetadata, type SearchQuery } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const s = await serverI18n();
  return pageMetadata(
    s,
    s.locale,
    '/market/compare',
    s.locale === 'fa' ? 'مقایسه گوشی‌ها' : 'Compare phones',
    '',
    { noindex: true },
  );
}
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchQuery>;
}) {
  const s = await searchParams,
    { locale } = await serverI18n(),
    raw = s.id,
    ids = typeof raw === 'string' ? [raw] : (raw ?? []);
  if (
    Object.keys(s).some((k) => k !== 'id') ||
    ids.length > 4 ||
    ids.some((id) => !marketIdSchema.safeParse(id).success) ||
    new Set(ids).size !== ids.length
  )
    return (
      <main className="container empty-state">
        {locale === 'fa' ? 'انتخاب مقایسه معتبر نیست.' : 'Invalid comparison selection.'}
      </main>
    );
  return <PhoneComparison items={await Promise.all(ids.map((id) => getPhoneItem(locale, id)))} />;
}
