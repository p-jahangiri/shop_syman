import { CustomerDevices } from '@/components/shopping/customer-devices';
import { developmentExamples } from '@/lib/content/shopping-content';
import { getLocale } from '@/lib/navigation/server-locale';

export async function generateMetadata() {
  const locale = await getLocale();
  return {
    title: locale === 'fa' ? 'دستگاه‌های من' : 'My devices',
    robots: { index: false, follow: false },
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ examples?: string }>;
}) {
  const { examples } = await searchParams;
  return <CustomerDevices examples={examples === '1' && (await developmentExamples())} />;
}
