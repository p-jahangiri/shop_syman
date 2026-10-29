import { notFound } from 'next/navigation';
import { CustomerOrders } from '@/components/customer-orders';
import { serverI18n } from '@/lib/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'جزئیات سفارش' : 'Order details',
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) notFound();
  return <CustomerOrders id={id} />;
}
