import { serverI18n } from '@/lib/server-locale';
import { Checkout } from '@/components/checkout';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('اطلاعات و پرداخت') };
}
export default function Page() {
  return <Checkout />;
}
