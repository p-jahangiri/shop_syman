import { CustomerNotifications } from '@/components/customer-notifications';
import { getLocale } from '@/lib/server-locale';
export async function generateMetadata() {
  const locale = await getLocale();
  return {
    title: locale === 'fa' ? 'اعلان‌های من' : 'My notifications',
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <CustomerNotifications />;
}
