import { CustomerAddresses } from '@/components/address/customer-addresses';
import { serverI18n } from '@/lib/navigation/server-locale';
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
