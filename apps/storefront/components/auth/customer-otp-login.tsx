'use client';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowLeft, RotateCw, Smartphone } from 'lucide-react';
import { CustomerOtpFlow } from '@/lib/auth/customer-otp-flow';
import {
  normalizeIranMobile,
  otpTiming,
  type OtpErrorKind,
} from '@/lib/auth/customer-otp-contract';
import type { CustomerSession } from '@/lib/account/customer-session';
import { useCustomerSession } from './auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { Button } from '../shared/ui';
import './customer-otp-login.css';

const messages: Record<OtpErrorKind, [string, string]> = {
  input: [
    'شمارهٔ همراه یا کد شش‌رقمی را بررسی کنید.',
    'Check the mobile number or six-digit code.',
  ],
  invalid: ['کد معتبر نیست؛ دوباره بررسی کنید.', 'The code is not valid. Please check it again.'],
  expired: [
    'مهلت این کد تمام شده است؛ کد تازه درخواست کنید.',
    'This code has expired. Request a new code.',
  ],
  cooldown: ['برای درخواست کد تازه کمی صبر کنید.', 'Please wait before requesting another code.'],
  limited: [
    'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.',
    'Too many attempts. Please try again later.',
  ],
  unavailable: [
    'ورود پیامکی در دسترس نیست؛ کمی بعد دوباره بررسی کنید.',
    'SMS sign-in is unavailable. Please try again later.',
  ],
  unknown: [
    'نتیجهٔ درخواست مشخص نیست. اگر کد دارید آن را وارد کنید؛ بررسی دوباره فقط با انتخاب شما انجام می‌شود.',
    'The request result is unknown. Enter the code if you received it. A request is checked again only when you choose to do so.',
  ],
  changed: [
    'وضعیت حساب تغییر کرد؛ دوباره شروع کنید.',
    'Your account state changed. Please start again.',
  ],
};

export function CustomerOtpLogin({
  registration,
  onMfa,
}: {
  registration: boolean;
  onMfa: (value: CustomerSession) => void;
}) {
  const { store } = useCustomerSession();
  const { locale, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [flow] = useState(() => new CustomerOtpFlow(store.loginOtp, store.viewRevision));
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
  const [now, setNow] = useState(Date.now);
  const codeInput = useRef<HTMLInputElement>(null);
  const mobileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    flow.activate();
    return () => {
      mounted.current = false;
      flow.dispose();
    };
  }, [flow]);
  useEffect(() => {
    if (!state.challenge) return;
    codeInput.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.challenge]);
  const timing = state.challenge ? otpTiming(state.challenge, now) : null;
  async function request(event: FormEvent) {
    event.preventDefault();
    await flow.requestCode();
    if (mounted.current) setNow(Date.now());
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    const value = await flow.verify();
    if (value?.requiresMfa) onMfa(value);
  }
  return (
    <div className="customer-otp-login">
      <p id="live-otp-guidance" className="small-note">
        {registration
          ? text(
              'با شمارهٔ همراه وارد شوید. شمارهٔ جدید فقط پس از تأیید کد، حساب مشتری می‌سازد.',
              'Sign in with your mobile number. A new customer account is created only after the code is verified.',
            )
          : text(
              'با شمارهٔ همراه تأییدشدهٔ حساب خود وارد شوید.',
              'Sign in with your account’s verified mobile number.',
            )}
      </p>
      {!state.challenge ? (
        <form onSubmit={request} aria-busy={state.busy === 'request'}>
          <div className="field">
            <label htmlFor="live-mobile">{text('شمارهٔ همراه', 'Mobile number')}</label>
            <input
              ref={mobileInput}
              id="live-mobile"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              dir="ltr"
              maxLength={32}
              placeholder="09123456789"
              value={state.mobile}
              onChange={(event) => flow.setMobile(event.target.value)}
              aria-describedby="live-otp-guidance live-otp-error"
              required
            />
          </div>
          <Button type="submit" className="full" disabled={!!state.busy}>
            {state.busy
              ? text('در حال بررسی درخواست…', 'Checking request…')
              : state.unknownRequest
                ? text('بررسی دوبارهٔ همان درخواست', 'Check the same request again')
                : text('دریافت کد ورود', 'Request sign-in code')}
            <Smartphone size={16} aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <>
          <div className="customer-otp-mobile">
            <bdi dir="ltr">{normalizeIranMobile(state.mobile)}</bdi>
            <button
              type="button"
              onClick={() => {
                flow.setMobile(state.mobile);
                requestAnimationFrame(() => mobileInput.current?.focus());
              }}
            >
              {text('تغییر شماره', 'Change number')}
            </button>
          </div>
          <p className="notice" role="status">
            {state.challenge.delivery === 'unknown'
              ? text(
                  'وضعیت ارسال نامشخص است. اگر کد را دریافت کرده‌اید، تا پایان مهلت وارد کنید.',
                  'Delivery is unknown. If you received a code, enter it before it expires.',
                )
              : text(
                  'درخواست کد پذیرفته شد. دریافت پیامک را در گوشی بررسی کنید.',
                  'Your code request was accepted. Check your phone for the message.',
                )}
          </p>
          <form onSubmit={verify} aria-busy={state.busy === 'verify'}>
            <div className="field">
              <label htmlFor="live-otp-code">
                {text('کد شش‌رقمی پیامک', 'Six-digit SMS code')}
              </label>
              <input
                ref={codeInput}
                id="live-otp-code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                dir="ltr"
                pattern="[0-9]{6}"
                maxLength={6}
                value={state.code}
                onChange={(event) => flow.setCode(event.target.value)}
                aria-describedby="live-otp-deadline live-otp-error"
                disabled={!!state.busy || timing?.expiresIn === 0}
                required
              />
            </div>
            <p id="live-otp-deadline" className="small-note" aria-live="off">
              {timing?.expiresIn
                ? text(
                    `اعتبار کد: ${digits(timing.expiresIn)} ثانیه`,
                    `Code expires in ${timing.expiresIn} seconds`,
                  )
                : text('مهلت کد تمام شده است.', 'The code has expired.')}
            </p>
            <Button type="submit" className="full" disabled={!!state.busy || !timing?.expiresIn}>
              {state.busy === 'verify'
                ? text('در حال تأیید…', 'Verifying…')
                : text('تأیید کد و ادامه', 'Verify code and continue')}
              <ArrowLeft size={16} aria-hidden="true" />
            </Button>
          </form>
          <button
            type="button"
            className="customer-otp-resend"
            disabled={!!state.busy || !!timing?.resendIn}
            onClick={() => {
              void flow.requestCode().then(() => {
                if (mounted.current) setNow(Date.now());
              });
            }}
          >
            <RotateCw size={15} aria-hidden="true" />
            {state.busy === 'request'
              ? text('در حال بررسی درخواست…', 'Checking request…')
              : state.unknownRequest
                ? text('بررسی دوبارهٔ همان درخواست', 'Check the same request again')
                : timing?.resendIn
                  ? text(
                      `درخواست دوباره پس از ${digits(timing.resendIn)} ثانیه`,
                      `Request again in ${timing.resendIn} seconds`,
                    )
                  : text('درخواست کد تازه', 'Request a new code')}
          </button>
        </>
      )}
      <p id="live-otp-error" role={state.error ? 'alert' : undefined} className="field-error">
        {state.error ? text(...messages[state.error]) : null}
      </p>
    </div>
  );
}
