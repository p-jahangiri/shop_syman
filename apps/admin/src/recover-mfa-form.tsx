import { useState } from 'react';
import { save, ApiError } from './api';
import { ErrorBox, Field } from './ui';
import { normalizeRecoveryCode, recoveryChallengeSchema } from './mfa-recovery-contract';
import type { Session } from './types';

export function RecoverMfaForm({
  onRecovered,
  onBack,
  busy: parentBusy = false,
}: {
  onRecovered: (session: Session) => void;
  onBack: () => void;
  busy?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeRecoveryCode(recoveryCode);
    if (!normalized) {
      setError(new Error('کد پشتیبان ۳۲ حرف و رقم را با خط تیره‌های اصلی یا بدون آن وارد کنید.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = recoveryChallengeSchema.parse(
        await save<unknown>('/auth/mfa/recover', { password, recoveryCode: normalized }),
      );
      onRecovered(result);
    } catch (error) {
      setError(
        error instanceof ApiError && error.status > 0 && error.status < 500
          ? error
          : new Error(
              'پاسخ بازیابی دریافت یا تأیید نشد. دوباره وارد شوید؛ اگر بازیابی شروع شده باشد، از کد استفاده‌نشدهٔ دیگری کمک بگیرید.',
            ),
      );
    } finally {
      setPassword('');
      setRecoveryCode('');
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="notice">
        کد پشتیبان ذخیره‌شدهٔ خود را وارد کنید. پس از پذیرش، نشست‌های قبلی باطل و راه‌اندازی
        Authenticator تازه الزامی می‌شود. اگر پاسخ قطع شد یا مهلت راه‌اندازی تمام شد، دوباره وارد
        شوید و از کد استفاده‌نشدهٔ دیگری کمک بگیرید.
      </p>
      <ErrorBox error={error} />
      <Field label="رمز عبور حساب">
        <input
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          dir="ltr"
          required
        />
      </Field>
      <Field label="کد پشتیبان">
        <input
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value)}
          dir="ltr"
          required
        />
      </Field>
      <button
        className="primary"
        disabled={busy || parentBusy || !password || !normalizeRecoveryCode(recoveryCode)}
      >
        {busy ? 'در حال بررسی…' : 'بازیابی و راه‌اندازی دوباره'}
      </button>
      <button type="button" disabled={busy || parentBusy} onClick={onBack}>
        بازگشت به ورود
      </button>
    </form>
  );
}
