import { getLocale, serverI18n } from '@/lib/server-locale';
import { Support } from '@/components/support';
import { fetchSupportContent } from '@/lib/support-content-fetch';
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
