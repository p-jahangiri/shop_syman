import { CustomerCreditPurchases } from '@/components/credit/customer-credit-purchases';
import { serverI18n } from '@/lib/navigation/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'محاسبات و سفارش‌های چکی' : 'Cheque calculations and orders',
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <CustomerCreditPurchases />;
}
