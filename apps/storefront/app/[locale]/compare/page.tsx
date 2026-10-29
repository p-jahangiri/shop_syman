import { serverI18n } from '@/lib/server-locale';
import { Compare } from '@/components/collections';
import type { ComparisonQuery } from '@/lib/comparison';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('مقایسهٔ محصولات'), robots: { index: false, follow: true } };
}
export default async function Page({ searchParams }: { searchParams: Promise<ComparisonQuery> }) {
  return <Compare query={await searchParams} />;
}
