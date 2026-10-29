import { notFound } from 'next/navigation';
import { CustomerSourcing } from '@/components/customer-sourcing';
import { serverI18n } from '@/lib/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'پیگیری درخواست تأمین' : 'Supply request tracking',
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) notFound();
  return <CustomerSourcing id={id} />;
}
