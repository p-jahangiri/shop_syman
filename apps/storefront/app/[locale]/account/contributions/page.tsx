import { CustomerContributions } from '@/components/account/customer-contributions';
import { getLocale } from '@/lib/navigation/server-locale';

export async function generateMetadata() {
  const locale = await getLocale();
  return {
    title: locale === 'fa' ? 'دیدگاه‌ها و پرسش‌های من' : 'My reviews and questions',
    robots: { index: false, follow: false },
  };
}

export default function Page() {
  return <CustomerContributions />;
}
