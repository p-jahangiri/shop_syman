import { CustomerSourcing } from '@/components/market/customer-sourcing';
import { serverI18n } from '@/lib/navigation/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'درخواست‌های تأمین من' : 'My supply requests',
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <CustomerSourcing />;
}
