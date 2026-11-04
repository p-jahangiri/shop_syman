import { cache } from 'react';
import { notFound } from 'next/navigation';
import { PhoneDetail } from '@/components/market/phone-market';
import { marketIdSchema } from '@sayman/web-shared/lib/market/market-contract.ts';
import { getPhoneItem } from '@/lib/market/phone-discovery-server';
import { PhoneReadError } from '@/lib/market/phone-discovery-http';
import { serverI18n } from '@/lib/navigation/server-locale';
import { pageMetadata } from '@/lib/seo/seo';
export const dynamic = 'force-dynamic';
const read = cache(async (locale: 'fa' | 'en', id: string) => {
  if (!marketIdSchema.safeParse(id).success) notFound();
  try {
    return await getPhoneItem(locale, id);
  } catch (e) {
    if (e instanceof PhoneReadError && e.status === 404) notFound();
    throw e;
  }
});
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    s = await serverI18n(),
    item = await read(s.locale, id);
  return pageMetadata(
    s,
    s.locale,
    '/market/' + encodeURIComponent(id),
    item.model.name,
    item.model.description,
    { noindex: true, image: item.model.image },
  );
}
export default async function PhonePage({ params }: { params: Promise<{ id: string }> }) {
  const { locale } = await serverI18n();
  return <PhoneDetail item={await read(locale, (await params).id)} />;
}
