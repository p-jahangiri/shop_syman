'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useCustomerSession } from './auth-provider';
import type { CustomerSession as Session } from '@/lib/customer-session';
import Link, { useRouter } from './localized-link';
import { useSearchParams } from 'next/navigation';
import { accountReturnTo } from '@/lib/order-form';
import { UserRound, ShieldCheck, KeyRound, LogOut, Heart, ArrowLeft } from 'lucide-react';
import { Button } from './ui';
import { useI18n, useStorefront } from './locale-provider';
import { useShop } from './shop-provider';
export function ConnectedAccount() {
  const { locale, t, digits } = useI18n();
  const { authSettings } = useStorefront();
  const { wishlist } = useShop();
  const { store, status, session, logoutPending } = useCustomerSession();
  const [pending, setPending] = useState<Session | null>(null);
  const restoring = status === 'restoring';
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = accountReturnTo(params.get('returnTo'), params.get('tab'));
  useEffect(() => {
    if (status === 'member' && returnTo) router.replace(returnTo);
  }, [status, returnTo, router]);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const value = await store.login(identifier, password, pending?.accessToken, code);
      setPassword('');
      setCode('');
      if (value.requiresMfa) {
        if (value.requiresEnrollment) {
          setError(
            text(
              'این حساب به راه‌اندازی تأیید دومرحله‌ای از پنل مدیریت نیاز دارد.',
              'This account requires authenticator enrollment in the admin panel.',
            ),
          );
          return;
        }
        setPending(value);
      } else {
        setPending(null);
        setIdentifier('');
      }
    } catch (e) {
      const key = e instanceof Error ? e.message : '';
      setError(
        key === 'invalid'
          ? text(
              'شناسه، رمز یا کد تأیید صحیح نیست.',
              'The identifier, password or verification code is incorrect.',
            )
          : key === 'limited'
            ? text(
                'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.',
                'Too many attempts. Please try again later.',
              )
            : text('سرویس ورود در دسترس نیست.', 'The sign-in service is unavailable.'),
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await store.logout();
    } catch {
      setError(
        text('خروج کامل انجام نشد؛ دوباره تلاش کنید.', 'Sign-out failed. Please try again.'),
      );
    } finally {
      setBusy(false);
    }
  }
  if (status === 'unavailable')
    return (
      <div className="container empty-state page-empty" role="alert">
        <h2>{text('ارتباط با حساب برقرار نشد', 'Account connection unavailable')}</h2>
        <p>
          {logoutPending
            ? text(
                'اطلاعات حساب از این صفحه پاک شد؛ برای تکمیل خروج دوباره تلاش کنید.',
                'Account details were cleared from this page. Retry to finish signing out.',
              )
            : text(
                'نشست شما هنوز بررسی نشده است. دوباره تلاش کنید.',
                'Your session could not be checked. Please retry.',
              )}
        </p>
        <Button
          onClick={() => {
            void store.restore().catch(() => {});
          }}
        >
          {t('تلاش دوباره')}
        </Button>
      </div>
    );
  if (restoring)
    return (
      <div className="container empty-state page-empty" role="status">
        {text('در حال بررسی نشست…', 'Checking your session…')}
      </div>
    );
  return (
    <div className="container account-page">
      <div className="page-top">
        <h1>{t('حساب کاربری')}</h1>
      </div>
      {session ? (
        <section className="card-panel account-main">
          <UserRound size={35} />
          <h2>{session.user.displayName}</h2>
          <p>
            {text(
              'ورود شما از طریق سرویس هویت تأیید شد.',
              'Your session has been verified by the identity service.',
            )}
          </p>
          <div className="account-stat-grid">
            <Link href="/wishlist">
              <Heart />
              <strong>{digits(wishlist.length)}</strong>
              <span>{t('علاقه‌مندی‌ها')}</span>
            </Link>
          </div>
          <Button asChild>
            <Link href="/orders">{text('سفارش‌های من', 'My orders')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/addresses">{text('نشانی‌های من', 'My addresses')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/phone-interests">
              {text('پیگیری موجودی گوشی‌ها', 'Phone availability alerts')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sourcing">{text('درخواست‌های تأمین من', 'My supply requests')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/support/tickets">
              {text('درخواست‌های پشتیبانی من', 'My support requests')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/notifications">{text('اعلان‌های من', 'My notifications')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/credit">
              {text('سوابق و پیگیری خرید چکی', 'Cheque history and applications')}
            </Link>
          </Button>
          <Button variant="outline" disabled={busy} onClick={logout}>
            <LogOut size={17} />
            {text('خروج از حساب', 'Sign out')}
          </Button>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section className="account-login">
          <div className="login-story">
            <span className="eyebrow">{t('انتخاب‌هایت، یک‌جا.')}</span>
            <h1>
              {t('به دنیای خودت')}
              <br />
              {t('در سایمان خوش آمدی.')}
            </h1>
            <p>{t('سفارش‌ها، علاقه‌مندی‌ها و همراه‌های دیجیتال تو، کنار هم.')}</p>
            <div>
              <ShieldCheck />
              <span>
                {text('نشست امن با سرویس هویت سایمان', 'A secure session with Sayman identity')}
              </span>
            </div>
          </div>
          <div className="login-form card-panel">
            <div className="login-icon">
              <KeyRound size={25} />
            </div>
            <h2>
              {pending
                ? text('تأیید دومرحله‌ای', 'Two-step verification')
                : t('به سایمان خوش آمدید')}
            </h2>
            {authSettings.emailPassword || authSettings.usernamePassword ? (
              <form onSubmit={login}>
                {pending ? (
                  <div className="field">
                    <label htmlFor="live-mfa">
                      {text('کد برنامهٔ Authenticator', 'Authenticator code')}
                    </label>
                    <input
                      id="live-mfa"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                    />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="live-identifier">
                        {authSettings.emailPassword && authSettings.usernamePassword
                          ? t('ایمیل یا نام کاربری')
                          : authSettings.emailPassword
                            ? t('ایمیل')
                            : t('نام کاربری')}
                      </label>
                      <input
                        id="live-identifier"
                        autoComplete="username"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="live-password">{t('رمز عبور')}</label>
                      <input
                        id="live-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        maxLength={128}
                        required
                      />
                    </div>
                  </>
                )}
                <Button type="submit" className="full" disabled={busy}>
                  {busy ? text('در حال بررسی…', 'Checking…') : text('ورود به حساب', 'Sign in')}
                  <ArrowLeft size={16} />
                </Button>
              </form>
            ) : (
              <div className="notice">{t('در حال حاضر هیچ روش ورودی فعال نیست.')}</div>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <p className="small-note">
              {text(
                'پیامک، ثبت‌نام و بازیابی رمز پس از اتصال سرویس تأیید هویت فعال می‌شوند.',
                'SMS, registration and password recovery will be enabled after a verification provider is connected.',
              )}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
