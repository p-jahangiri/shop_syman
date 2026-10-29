import { CustomerTickets } from '@/components/customer-tickets';
import { serverI18n } from '@/lib/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'پیگیری پشتیبانی' : 'Support requests',
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <CustomerTickets />;
}
