import { serverI18n } from '@/lib/navigation/server-locale';
import { CartPage } from '@/components/checkout/checkout';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('سبد خرید') };
}
export default function Page() {
  return <CartPage />;
}
