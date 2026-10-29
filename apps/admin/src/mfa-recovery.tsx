import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, save, ApiError } from './api';
import { Busy, ErrorBox, Field } from './ui';
import {
  normalizeMfaCode,
  recoveryBatchSchema,
  recoveryStatusSchema,
} from './mfa-recovery-contract';

export function SecurityPage() {
  const status = useQuery({
    queryKey: ['admin', 'mfa-recovery-status'],
    queryFn: async () => {
      const response = await api<unknown>('/auth/mfa/recovery-codes');
      const parsed = recoveryStatusSchema.safeParse(response);
      if (!parsed.success) throw new Error('پاسخ وضعیت امنیت حساب معتبر نیست؛ دوباره تلاش کنید.');
      return parsed.data;
    },
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setCodes([]);
    try {
      const result = recoveryBatchSchema.parse(
        await save<unknown>('/auth/mfa/recovery-codes', { password, code }),
      );
      setCodes(result.codes);
      void status.refetch();
    } catch (error) {
      setError(
        error instanceof ApiError && error.status > 0 && error.status < 500
          ? error
          : new Error(
              'پاسخ تولید کد دریافت یا تأیید نشد؛ ممکن است کدهای قبلی باطل شده باشند. با کد تازهٔ Authenticator دوباره تولید کنید.',
            ),
      );
    } finally {
      setPassword('');
      setCode('');
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          'Sayman MFA recovery codes\nKeep offline and private. Each code can be used once.\nAll old codes expire after authenticator recovery is completed.\n\n' +
            codes.join('\n') +
            '\n',
        ],
        { type: 'text/plain;charset=utf-8' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sayman-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel mfa-recovery-panel">
      <h2>امنیت حساب و کدهای پشتیبان</h2>
      <p>
        کدهای پشتیبان برای زمانی‌اند که به برنامهٔ Authenticator دسترسی ندارید. آن‌ها را جدا از رمز،
        در محل خصوصی نگه دارید.
      </p>
      {status.isPending ? (
        <Busy />
      ) : status.error ? (
        <>
          <ErrorBox error={status.error} />
          <button type="button" onClick={() => void status.refetch()}>
            تلاش دوباره
          </button>
        </>
      ) : (
        <p role="status">
          کد استفاده‌نشده: {new Intl.NumberFormat('fa-IR').format(status.data.remainingCodes)}
        </p>
      )}
      <p className="notice">
        تولید مجموعهٔ تازه، تمام کدهای قبلی را باطل می‌کند. رمز و کد تازهٔ Authenticator لازم‌اند؛
        کدی که همین حالا برای ورود استفاده کرده‌اید دوباره پذیرفته نمی‌شود.
      </p>
      <ErrorBox error={error} />
      <form onSubmit={generate}>
        <div className="form-grid">
          <Field label="رمز عبور حساب">
            <input
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="کد تازهٔ Authenticator">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              dir="ltr"
              value={code}
              onChange={(e) => setCode(normalizeMfaCode(e.target.value))}
            />
          </Field>
        </div>
        <button className="primary" disabled={busy || !password || code.length !== 6}>
          {busy ? 'در حال تولید…' : 'تولید ۱۰ کد پشتیبان تازه'}
        </button>
      </form>
      {codes.length > 0 && (
        <div className="notice" role="status">
          <h3>این مجموعه فقط همین بار نمایش داده می‌شود</h3>
          <p>
            با خروج از این صفحه یا بارگیری دوباره، نمایش کدها پاک می‌شود. پس از تکمیل بازیابی
            Authenticator، همهٔ کدهای این مجموعه باطل می‌شوند و باید مجموعهٔ تازه بسازید.
          </p>
          <pre className="recovery-codes" dir="ltr">
            {codes.join('\n')}
          </pre>
          <div className="row-buttons">
            <button type="button" onClick={download}>
              دریافت فایل متنی کدها
            </button>
            <button type="button" onClick={() => setCodes([])}>
              کدها را ذخیره کردم؛ پنهان کن
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
