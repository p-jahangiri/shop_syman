import { CustomerOrders } from '@/components/orders/customer-orders';
import { serverI18n } from '@/lib/navigation/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'سفارش‌های من' : 'My orders',
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <CustomerOrders />;
}
