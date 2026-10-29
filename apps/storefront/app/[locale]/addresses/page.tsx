import { CustomerAddresses } from '@/components/customer-addresses';
import { serverI18n } from '@/lib/server-locale';
export async function generateMetadata() {
  const { locale } = await serverI18n();
  return {
    title: locale === 'fa' ? 'نشانی‌های من' : 'My addresses',
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <CustomerAddresses />;
}
