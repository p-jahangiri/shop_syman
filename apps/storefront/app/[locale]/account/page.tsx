import { serverI18n } from '@/lib/navigation/server-locale';
import { Suspense } from 'react';
import { Account } from '@/components/account/account';
import Loading from './loading';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('حساب کاربری'), robots: { index: false, follow: false } };
}
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Account />
    </Suspense>
  );
}
