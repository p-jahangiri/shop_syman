import { getLocale, serverI18n } from '@/lib/navigation/server-locale';
import { Support } from '@/components/support/support';
import { fetchSupportContent } from '@/lib/content/support-content-fetch';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('راهنما و پشتیبانی') };
}
export default async function Page() {
  const locale = await getLocale();
  const contentLoad = await fetchSupportContent(locale, {
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_API_URL: process.env.SHOP_API_URL,
  });
  return <Support contentLoad={contentLoad} />;
}
