import { CustomerTickets } from '@/components/support/customer-tickets';
import { notFound } from 'next/navigation';

export const metadata = {
  title: 'Sayman · Purchase request',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) notFound();
  return <CustomerTickets id={id} shoppingRequest={{ kind: 'phone' }} />;
}
