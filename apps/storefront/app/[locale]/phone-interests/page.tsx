import { CustomerPhoneInterests } from '@/components/market/phone-interest';
import { serverI18n } from '@/lib/navigation/server-locale';
import { pageMetadata } from '@/lib/seo/seo';
import '@/components/market/phone-market.css';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const s = await serverI18n();
  return pageMetadata(
    s,
    s.locale,
    '/phone-interests',
    s.locale === 'fa' ? 'پیگیری موجودی گوشی‌ها' : 'Phone availability alerts',
    '',
    { noindex: true },
  );
}
export default function Page() {
  return <CustomerPhoneInterests />;
}
