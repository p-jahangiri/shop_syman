import { CustomerCreditApplications } from '@/components/credit/customer-credit-applications';
import { serverI18n } from '@/lib/navigation/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'درخواست‌های خرید چکی' : 'Cheque applications',
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <CustomerCreditApplications />;
}
