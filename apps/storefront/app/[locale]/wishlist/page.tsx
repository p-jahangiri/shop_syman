import { serverI18n } from '@/lib/server-locale';
import { Wishlist } from '@/components/collections';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('علاقه‌مندی‌ها') };
}
export default function Page() {
  return <Wishlist />;
}
