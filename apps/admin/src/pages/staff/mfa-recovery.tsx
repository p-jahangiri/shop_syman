import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, KeyRound, LifeBuoy, ShieldCheck } from 'lucide-react';
import { api, save, ApiError } from '../../api/api';
import { Busy, ErrorBox, Field } from '../../components/ui';
import { StaffPasswordForm } from '../../features/staff/staff-password';
import { PasswordInput } from '../../components/forms/password-input';
import { adminViewRevision } from '../../auth/admin-view-authority';
import {
  normalizeMfaCode,
  recoveryBatchSchema,
  recoveryStatusSchema,
} from '../../api/contracts/staff/mfa-recovery-contract';
import '../../styles/staff/staff-security.css';

const count = new Intl.NumberFormat('fa-IR');

export function SecurityPage({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const status = useQuery({
    queryKey: ['admin', 'mfa-recovery-status'],
    queryFn: async () => {
      const response = await api<unknown>('/auth/mfa/recovery-codes');
      const parsed = recoveryStatusSchema.safeParse(response);
      if (!parsed.success) throw new Error('پاسخ وضعیت امنیت حساب معتبر نیست؛ دوباره تلاش کنید.');
      return parsed.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [section, setSection] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<unknown>();
  const locked = useRef(false);
  function openSection(next: 'password' | 'recovery') {
    if (busy || passwordBusy || next === section) return;
    setSection(next);
    setPassword('');
    setCode('');
    setReviewing(false);
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current || !password || code.length !== 6) return;
    if (!reviewing) {
      setReviewing(true);
      return;
    }
    locked.current = true;
    const revision = adminViewRevision();
    setBusy(true);
    setError(undefined);
    setCodes([]);
    try {
      const result = recoveryBatchSchema.parse(
        await save<unknown>('/auth/mfa/recovery-codes', { password, code }),
      );
      if (adminViewRevision() !== revision) return;
      setCodes(result.codes);
      void status.refetch();
    } catch (error) {
      if (adminViewRevision() !== revision) return;
      setError(
        error instanceof ApiError && error.status > 0 && error.status < 500
          ? error
          : new Error(
              'نتیجهٔ تولید کد نامشخص است و ممکن است کدهای قبلی باطل شده باشند. برای دریافت مجموعهٔ قابل استفاده، با رمز و یک کد تازه دوباره درخواست بدهید.',
            ),
      );
    } finally {
      locked.current = false;
      setPassword('');
      setCode('');
      setReviewing(false);
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
    <div className="staff-workspace security-workspace">
      <header className="panel staff-workspace-intro">
        <div className="staff-section-icon" aria-hidden="true">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h2>امنیت حساب</h2>
          <p>رمز شخصی و کدهای پشتیبان همین حساب را مدیریت کنید.</p>
        </div>
        <div className="security-recovery-status">
          <small>کدهای پشتیبانِ باقی‌مانده</small>
          {status.isPending ? (
            <Busy />
          ) : status.error ? (
            <button
              type="button"
              disabled={status.isFetching}
              onClick={() => void status.refetch()}
            >
              دریافت دوبارهٔ وضعیت
            </button>
          ) : (
            <strong role="status">
              {count.format(status.data.remainingCodes)} از {count.format(10)}
            </strong>
          )}
        </div>
      </header>
      <ErrorBox error={status.error} />
      <nav className="staff-segments" aria-label="بخش‌های امنیت حساب">
        <button
          type="button"
          aria-pressed={section === 'password'}
          disabled={busy || passwordBusy}
          onClick={() => openSection('password')}
        >
          <KeyRound size={18} aria-hidden="true" /> تغییر رمز
        </button>
        <button
          type="button"
          aria-pressed={section === 'recovery'}
          disabled={busy || passwordBusy}
          onClick={() => openSection('recovery')}
        >
          <LifeBuoy size={18} aria-hidden="true" /> کدهای پشتیبان
        </button>
      </nav>
      <div hidden={section !== 'password'}>
        <StaffPasswordForm onChanged={onPasswordChanged} onBusy={setPasswordBusy} />
      </div>
      {section === 'recovery' && (
        <section className="panel mfa-recovery-panel">
          <h2>کدهای پشتیبان Authenticator</h2>
          <p>
            هر کد برای یک بار بازیابی دسترسی به Authenticator است. کدها را جدا از رمز حساب، در محل
            خصوصی نگه دارید.
          </p>
          <p className="notice">
            تولید مجموعهٔ تازه، تمام کدهای قبلی را باطل می‌کند. رمز و کد تازهٔ Authenticator
            لازم‌اند؛ کدی که همین حالا برای ورود استفاده کرده‌اید دوباره پذیرفته نمی‌شود.
          </p>
          <ErrorBox error={error} />
          <form onSubmit={generate}>
            <fieldset disabled={busy} className="recovery-form-fields">
              <div className="form-grid">
                <Field label="رمز عبور حساب">
                  <PasswordInput
                    aria-label="رمز عبور حساب"
                    autoComplete="current-password"
                    maxLength={128}
                    required
                    dir="ltr"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setReviewing(false);
                    }}
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
                    onChange={(e) => {
                      setCode(normalizeMfaCode(e.target.value));
                      setReviewing(false);
                    }}
                  />
                </Field>
              </div>
              {reviewing && (
                <p className="staff-change-review">
                  با تأیید، همهٔ کدهای قبلی باطل می‌شوند و مجموعهٔ تازه فقط همین بار قابل مشاهده
                  است.
                </p>
              )}
              <div className="row-buttons">
                <button className="primary" disabled={busy || !password || code.length !== 6}>
                  {busy
                    ? 'در حال تولید…'
                    : reviewing
                      ? 'تأیید و تولید کدهای تازه'
                      : 'بازبینی تولید ۱۰ کد پشتیبان'}
                </button>
                {reviewing && (
                  <button type="button" onClick={() => setReviewing(false)}>
                    بازگشت به فرم
                  </button>
                )}
              </div>
            </fieldset>
          </form>
          {codes.length > 0 && (
            <section className="notice security-codes" aria-label="مجموعهٔ تازهٔ کدها">
              <h3>این مجموعه فقط همین بار نمایش داده می‌شود</h3>
              <p>
                با خروج از این صفحه یا بارگیری دوباره، نمایش کدها پاک می‌شود. پس از تکمیل بازیابی
                Authenticator، همهٔ کدهای این مجموعه باطل می‌شوند و باید مجموعهٔ تازه بسازید.
              </p>
              <ol className="recovery-codes" dir="ltr">
                {codes.map((value) => (
                  <li key={value}>
                    <code>{value}</code>
                  </li>
                ))}
              </ol>
              <div className="row-buttons">
                <button type="button" onClick={download}>
                  <Download size={16} aria-hidden="true" /> دریافت فایل متنی کدها
                </button>
                <button type="button" onClick={() => setCodes([])}>
                  کدها را ذخیره کردم؛ پنهان کن
                </button>
              </div>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
