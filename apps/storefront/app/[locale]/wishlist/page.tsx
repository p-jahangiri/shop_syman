import { serverI18n } from '@/lib/navigation/server-locale';
import { Wishlist } from '@/components/catalog/collections';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('علاقه‌مندی‌ها') };
}
export default function Page() {
  return <Wishlist />;
}
