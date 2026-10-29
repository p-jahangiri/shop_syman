import { serverI18n } from '@/lib/server-locale';
import { Suspense } from 'react';
import { Account } from '@/components/account';
import Loading from '../loading';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('حساب کاربری') };
}
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Account />
    </Suspense>
  );
}
