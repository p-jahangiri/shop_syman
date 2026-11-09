import Link from 'next/link';

export const metadata = { robots: { index: false, follow: false } };

export default async function BrowseAccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const fa = locale !== 'en';

  return (
    <section className="container install-page">
      <div className="page-top">
        <h1>{fa ? 'دسترسی به حساب و خرید' : 'Account and shopping access'}</h1>
        <p>
          {fa
            ? 'این اتصال برای مرور عمومی فروشگاه است. ورود به حساب، علاقه‌مندی‌ها و خرید از اتصال مجاز آزمایشی در دسترس‌اند.'
            : 'This connection is for public browsing. Sign-in, favourites and purchasing are available on the authorised test connection.'}
        </p>
        <Link className="button button-primary" href={fa ? '/fa/catalog' : '/en/catalog'}>
          {fa ? 'بازگشت به محصولات' : 'Back to products'}
        </Link>
      </div>
    </section>
  );
}
