import { notFound } from 'next/navigation';
import { CustomerTickets } from '@/components/support/customer-tickets';
import { serverI18n } from '@/lib/navigation/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'گفت‌وگوی پشتیبانی' : 'Support conversation',
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id) || /^0+$/.test(id)) notFound();
  return <CustomerTickets id={id} />;
}
