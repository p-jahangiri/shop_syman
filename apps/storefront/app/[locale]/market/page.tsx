import Link from '@/components/navigation/localized-link';
import { PhoneBrowse } from '@/components/market/phone-market';
import { getPhonePage } from '@/lib/market/phone-discovery-server';
import { phoneQueryFromParams } from '@sayman/web-shared/lib/market/phone-discovery-contract.ts';
import { serverI18n } from '@/lib/navigation/server-locale';
import { pageMetadata, type SearchQuery } from '@/lib/seo/seo';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const s = await serverI18n();
  return pageMetadata(
    s,
    s.locale,
    '/market',
    s.locale === 'fa'
      ? 'کاتالوگ گوشی؛ انتخاب و درخواست تأمین'
      : 'Discover phones and request sourcing',
    s.locale === 'fa'
      ? 'مدل، رنگ و حافظه گوشی را انتخاب کنید و پیشنهاد تأمین فروشگاه را بگیرید.'
      : 'Choose a phone configuration and receive a store sourcing quote.',
    { noindex: true },
  );
}
export default async function MarketPage({ searchParams }: { searchParams: Promise<SearchQuery> }) {
  const { locale } = await serverI18n(),
    params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.set(key, value);
  }
  let query;
  try {
    query = phoneQueryFromParams(params);
  } catch {
    return (
      <main className="container empty-state">
        <h1>{locale === 'fa' ? 'فیلترها معتبر نیستند' : 'Invalid filters'}</h1>
        <Link href="/market">{locale === 'fa' ? 'بازگشت به گوشی‌ها' : 'Back to phones'}</Link>
      </main>
    );
  }
  return <PhoneBrowse query={query} page={await getPhonePage(locale, query)} />;
}
