'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import type { CustomerSession as Session } from '@/lib/account/customer-session';
import { useRouter } from '../navigation/localized-link';
import { useSearchParams } from 'next/navigation';
import { accountReturnTo } from '@sayman/web-shared/lib/orders/order-form.ts';
import { ShieldCheck, KeyRound, Smartphone, ArrowLeft } from 'lucide-react';
import { Button } from '../shared/ui';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import { CustomerAccountWorkspace } from './customer-account-workspace';
import { CustomerOtpLogin } from '../auth/customer-otp-login';
import { normalizeOtpDigits } from '@/lib/auth/customer-otp-contract';
export function ConnectedAccount() {
  const { locale, t } = useI18n();
  const { authSettings } = useStorefront();
  const { store, status, session, logoutPending } = useCustomerSession();
  const [pending, setPending] = useState<Session | null>(null);
  const [method, setMethod] = useState<'otp' | 'password'>(
    authSettings.mobileOtp ? 'otp' : 'password',
  );
  const passwordEnabled = authSettings.emailPassword || authSettings.usernamePassword;
  const otpSelected = authSettings.mobileOtp && (!passwordEnabled || method === 'otp');
  const submitting = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const restoring = status === 'restoring';
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState<'changed' | 'unknown' | null>(null);
  const sessionRevision = store.viewRevision();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = accountReturnTo(params.get('returnTo'), params.get('tab'));
  useEffect(() => {
    if (status === 'member' && returnTo) router.replace(returnTo);
  }, [status, returnTo, router]);
  async function login(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const current = generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await store.login(identifier, password, pending?.accessToken, code);
      if (current !== generation.current) return;
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
        setPasswordNotice(null);
        setPending(null);
        setIdentifier('');
      }
    } catch (e) {
      if (current !== generation.current) return;
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
      submitting.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  async function logout() {
    setPasswordNotice(null);
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
    <div className="container account-page customer-account-page">
      <div className="page-top">
        <h1>{t('حساب کاربری')}</h1>
      </div>
      {session ? (
        <CustomerAccountWorkspace
          key={session.user.id + ':' + sessionRevision}
          session={session}
          busy={busy}
          error={error}
          onLogout={logout}
          onPasswordChanged={async (outcome) => {
            try {
              if (await store.credentialsChanged(session.user.id, sessionRevision))
                setPasswordNotice(outcome);
            } catch {
              if (store.viewRevision() === sessionRevision + 1) setPasswordNotice(outcome);
            }
          }}
        />
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
            {passwordNotice && (
              <p role="status" className="notice">
                {passwordNotice === 'changed'
                  ? text(
                      'رمز عبور تغییر کرد و نشست‌های قبلی بسته شدند. با رمز جدید دوباره وارد شوید.',
                      'Your password was changed and previous sessions were ended. Sign in again with your new password.',
                    )
                  : text(
                      'نتیجهٔ تغییر رمز مشخص نشد. برای بررسی، دوباره وارد شوید؛ در صورت موفقیت از رمز جدید استفاده کنید.',
                      'The password change could not be confirmed. Sign in again to check; use the new password if the change succeeded.',
                    )}
              </p>
            )}
            {!pending && authSettings.mobileOtp && passwordEnabled && (
              <div
                className="auth-tabs"
                role="group"
                aria-label={text('روش ورود', 'Sign-in method')}
              >
                <button
                  type="button"
                  aria-pressed={otpSelected}
                  onClick={() => {
                    setMethod('otp');
                    setError('');
                    setPassword('');
                  }}
                  disabled={busy}
                >
                  <Smartphone size={15} aria-hidden="true" />
                  {text('کد پیامکی', 'SMS code')}
                </button>
                <button
                  type="button"
                  aria-pressed={!otpSelected}
                  onClick={() => {
                    setMethod('password');
                    setError('');
                  }}
                  disabled={busy}
                >
                  <KeyRound size={15} aria-hidden="true" />
                  {text('رمز عبور', 'Password')}
                </button>
              </div>
            )}
            {!pending && otpSelected ? (
              <CustomerOtpLogin
                registration={authSettings.registration}
                onMfa={(value) => {
                  setCode('');
                  setError('');
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
                  setPasswordNotice(null);
                }}
              />
            ) : pending || passwordEnabled ? (
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
                      onChange={(e) => setCode(normalizeOtpDigits(e.target.value))}
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
                {pending && (
                  <Button
                    type="button"
                    variant="outline"
                    className="full"
                    disabled={busy}
                    onClick={() => {
                      setPending(null);
                      setCode('');
                      setError('');
                    }}
                  >
                    {text('بازگشت به روش ورود', 'Back to sign-in methods')}
                  </Button>
                )}
              </form>
            ) : (
              <div className="notice">{t('در حال حاضر هیچ روش ورودی فعال نیست.')}</div>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            {!authSettings.mobileOtp && (
              <p className="small-note">
                {text(
                  'ورود پیامکی در حال حاضر فعال نیست. بازیابی رمز به سرویس تأیید هویت نیاز دارد.',
                  'SMS sign-in is currently disabled. Password recovery requires a verification provider.',
                )}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
