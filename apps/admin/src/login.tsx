import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { api, save, setToken, ApiError } from './api';
import { ErrorBox, Field } from './ui';
import { InitialStaffPassword } from './initial-staff-password';
import { RecoverMfaForm } from './recover-mfa-form';
import { normalizeMfaCode } from './mfa-recovery-contract';
import {
  authenticatorUri,
  mfaSetupSchema,
  mfaGrantDeadline,
  mfaRemainingSeconds,
  formatMfaRemaining,
  type MfaSetup,
} from './mfa-setup-contract';
import type { Session } from './types';
const storefrontUrl = (import.meta.env.VITE_STOREFRONT_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const loginSchema = z.object({
  identifier: z.string().min(1, 'نام کاربری یا ایمیل را وارد کنید.').max(256),
  password: z.string().min(1, 'رمز را وارد کنید.').max(128),
});

export function Login({ onSession }: { onSession: (session: Session) => void }) {
  const [pending, setPending] = useState<Session | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = useRef(false);
  const generation = useRef(0);
  const renderedGeneration = generation.current;
  const [code, setCode] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: 'admin', password: '' },
  });
  const remaining = mfaRemainingSeconds(deadline, now);
  const expired = !!pending && remaining === 0;
  const hasPending = pending !== null;
  useEffect(() => {
    if (!hasPending) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [hasPending]);
  function challenge(result: Session) {
    const time = Date.now();
    setToken(result.accessToken);
    setPending(result);
    setDeadline(mfaGrantDeadline(result.accessToken, result.expiresIn, time));
    setNow(time);
  }
  function back() {
    generation.current++;
    setPending(null);
    setSetup(null);
    setCode('');
    setRecovering(false);
    setError(undefined);
    setDeadline(0);
    setToken('');
    resetField('password');
  }
  function begin() {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    return true;
  }
  function finish() {
    locked.current = false;
    setBusy(false);
  }
  function active() {
    const time = Date.now();
    setNow(time);
    if (mfaRemainingSeconds(deadline, time) > 0) return true;
    setCode('');
    return false;
  }
  function failed(error: unknown) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      (error.code === 'request_failed' || pending?.requiresPasswordChange)
    ) {
      setDeadline(0);
      setCode('');
      setError(undefined);
    } else
      setError(
        error instanceof ApiError && error.status === 401 && error.code === 'invalid_credentials'
          ? new Error(
              'کد تأیید پذیرفته نشد. کد تازهٔ برنامه را وارد کنید و تنظیم خودکار ساعت گوشی را بررسی کنید.',
            )
          : error,
      );
  }
  async function password(values: z.infer<typeof loginSchema>) {
    if (!begin()) return;
    try {
      const result = await api<Session>('/auth/password', {
        method: 'POST',
        headers: { 'X-Sayman-Admin': '1' },
        body: JSON.stringify(values),
      });
      if (result.requiresMfa || result.requiresPasswordChange) challenge(result);
      else onSession(result);
    } catch (e) {
      setError(e);
    } finally {
      resetField('password');
      finish();
    }
  }
  async function enroll() {
    if (pending?.requiresPasswordChange || !pending?.requiresEnrollment || !active() || !begin())
      return;
    try {
      const raw = await save<unknown>('/auth/mfa/setup', {});
      const parsed = mfaSetupSchema.safeParse(raw);
      if (!parsed.success)
        throw new Error('اطلاعات راه‌اندازی Authenticator قابل تأیید نیست. دوباره وارد شوید.');
      setSetup(parsed.data);
      challenge({ ...pending, accessToken: parsed.data.accessToken });
    } catch (e) {
      failed(e);
    } finally {
      finish();
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!active() || code.length !== 6 || !begin()) return;
    try {
      const session = await save<Session>('/auth/mfa/verify', { code });
      setSetup(null);
      setCode('');
      onSession(session);
    } catch (e) {
      failed(e);
    } finally {
      setCode('');
      finish();
    }
  }
  const passwordChange = pending?.requiresPasswordChange === true;
  const recovery =
    !passwordChange && !!pending && (recovering || pending.requiresRecovery === true);
  const needsSetup = !!pending?.requiresEnrollment && !setup;
  return (
    <main className="login">
      <div className="login-story">
        <a className="brand" href={`${storefrontUrl}/fa`} target="_blank" rel="noreferrer">
          S<span>AYMAN</span>
          <i />
        </a>
        <div>
          <span className="eyebrow">فضای مدیریت فروشگاه</span>
          <h1>
            هر انتخاب خوب، <br />
            از جزئیات شروع می‌شود.
          </h1>
          <p>کالا، محتوا و عملیات فروشگاه را از یک نقطه مدیریت کنید.</p>
        </div>
        <small>سایمان · پنل عملیات</small>
      </div>
      <div className="login-area">
        <section className="login-card">
          <div className="login-icon">
            <ShieldCheck size={27} />
          </div>
          <h2>
            {passwordChange
              ? 'رمز اختصاصی خود را بسازید'
              : recovery
                ? 'بازیابی تأیید دومرحله‌ای'
                : pending
                  ? 'تأیید دومرحله‌ای'
                  : 'ورود به مدیریت'}
          </h2>
          <p className="muted">
            {passwordChange
              ? 'برای اولین ورود، تغییر رمز اولیه الزامی است.'
              : recovery
                ? 'از یکی از کدهای پشتیبان حساب خود استفاده کنید.'
                : pending
                  ? needsSetup
                    ? 'Authenticator حساب خود را راه‌اندازی کنید.'
                    : 'کد برنامهٔ Authenticator را وارد کنید.'
                  : 'از حساب مدیریتی اختصاصی خود استفاده کنید.'}
          </p>
          <ErrorBox error={error} />
          {expired ? (
            <div className="notice" role="alert">
              <strong>مهلت تأیید تمام شد</strong>
              <p>
                برای ادامه دوباره با رمز عبور وارد شوید. اگر این حساب را به Authenticator اضافه
                کرده‌اید، همان مدخل را نگه دارید و کد تازهٔ آن را وارد کنید.
              </p>
              <button className="primary" disabled={busy} type="button" onClick={back}>
                ورود دوباره
              </button>
            </div>
          ) : (
            <>
              {pending && (
                <p className="mfa-countdown">
                  زمان باقی‌ماندهٔ این مرحله: <bdi>{formatMfaRemaining(remaining)}</bdi>
                </p>
              )}
              {passwordChange ? (
                <InitialStaffPassword
                  active={active}
                  busy={busy}
                  onBegin={begin}
                  onFinish={finish}
                  onBack={back}
                  onFailure={failed}
                  onChanged={(result) => {
                    if (generation.current !== renderedGeneration) return;
                    setSetup(null);
                    setCode('');
                    setError(undefined);
                    challenge(result);
                  }}
                />
              ) : recovery ? (
                <RecoverMfaForm
                  onBack={back}
                  onRecovered={(result) => {
                    if (generation.current !== renderedGeneration) return;
                    challenge(result);
                    setSetup(null);
                    setCode('');
                    setRecovering(false);
                    setError(undefined);
                  }}
                />
              ) : pending ? (
                <form onSubmit={verify}>
                  {needsSetup ? (
                    <div className="notice">
                      <p>
                        با انتخاب راه‌اندازی، QR و کلید خصوصی ورود دومرحله‌ای نمایش داده می‌شود. آن
                        را فقط در برنامهٔ Authenticator خود ثبت کنید.
                      </p>
                      <button className="primary" type="button" disabled={busy} onClick={enroll}>
                        {busy ? 'در حال آماده‌سازی…' : 'راه‌اندازی Authenticator'}
                      </button>
                    </div>
                  ) : (
                    <>
                      {setup && (
                        <div className="notice mfa-setup">
                          <strong>راه‌اندازی Authenticator</strong>
                          <p>
                            در برنامهٔ Authenticator گزینهٔ افزودن حساب و اسکن QR را انتخاب کنید.
                          </p>
                          <div className="mfa-qr">
                            <QRCodeSVG
                              value={authenticatorUri(setup)}
                              size={224}
                              marginSize={4}
                              level="M"
                              bgColor="#ffffff"
                              fgColor="#000000"
                              role="img"
                              title="QR راه‌اندازی Authenticator"
                            />
                          </div>
                          <p>یا کلید زیر را دستی با نوع «بر اساس زمان» وارد کنید:</p>
                          <code dir="ltr" className="mfa-secret">
                            {setup.secret}
                          </code>
                          <small>
                            حساب <bdi>{setup.account}</bdi> · صادرکننده <bdi>{setup.issuer}</bdi> ·
                            ۶ رقم · ۳۰ ثانیه
                          </small>
                          <small className="mfa-private-note">
                            QR و کلید خصوصی را فقط نزد خود نگه دارید.
                          </small>
                        </div>
                      )}
                      <Field label="کد شش‌رقمی">
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(normalizeMfaCode(e.target.value))}
                          required
                          dir="ltr"
                        />
                      </Field>
                      <button className="primary" disabled={busy || code.length !== 6}>
                        {busy ? 'در حال بررسی…' : 'تأیید و ورود'}
                      </button>
                    </>
                  )}
                  {!pending.requiresEnrollment && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setCode('');
                        setError(undefined);
                        setRecovering(true);
                      }}
                    >
                      به Authenticator دسترسی ندارم
                    </button>
                  )}
                  <button disabled={busy} type="button" onClick={back}>
                    بازگشت
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSubmit(password)}>
                  <Field label="نام کاربری یا ایمیل">
                    <input autoComplete="username" dir="ltr" {...register('identifier')} />
                  </Field>
                  {errors.identifier && (
                    <small className="invalid">{errors.identifier.message}</small>
                  )}
                  <Field label="رمز عبور">
                    <input
                      type="password"
                      autoComplete="current-password"
                      dir="ltr"
                      {...register('password')}
                    />
                  </Field>
                  {errors.password && <small className="invalid">{errors.password.message}</small>}
                  <button className="primary" disabled={busy}>
                    {busy ? 'در حال ورود…' : 'ورود امن'}
                  </button>
                </form>
              )}
            </>
          )}
          <p className="login-note">
            پس از ورود، از بخش امنیت حساب کدهای پشتیبان بسازید. بدون Authenticator و کد پشتیبان،
            بازیابی خودکار ممکن نیست.
          </p>
        </section>
      </div>
    </main>
  );
}
