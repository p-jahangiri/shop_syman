import { useRef, useState } from 'react';
import { api, ApiError } from '../../api/api';
import { ErrorBox, Field } from '../../components/ui';
import { PasswordInput } from '../../components/forms/password-input';
import { normalizeMfaCode } from '../../api/contracts/staff/mfa-recovery-contract';

const passwordRules = [
  { label: '۱۲ تا ۱۲۸ نویسه', meets: (value: string) => value.length >= 12 && value.length <= 128 },
  {
    label: 'حرف کوچک و بزرگ انگلیسی',
    meets: (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value),
  },
  {
    label: 'عدد و نشانه',
    meets: (value: string) => /[0-9]/.test(value) && /[^a-z0-9]/i.test(value),
  },
] as const;

export function StaffPasswordForm({
  onChanged,
  onBusy,
}: {
  onChanged: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<unknown>();
  const locked = useRef(false);
  const checks = passwordRules.map((rule) => ({ label: rule.label, met: rule.meets(newPassword) }));
  const meetsPolicy = checks.every((rule) => rule.met);
  const matches = !!confirmation && confirmation === newPassword;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || uncertain || !currentPassword || code.length !== 6) return;
    setError(undefined);
    if (newPassword !== confirmation) {
      setError(new Error('رمز تازه و تکرار آن یکسان نیستند.'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(new Error('رمز تازه باید با رمز فعلی متفاوت باشد.'));
      return;
    }
    if (!meetsPolicy) {
      setError(new Error('رمز تازه باید همهٔ شرایط فرم را داشته باشد.'));
      return;
    }
    locked.current = true;
    setBusy(true);
    onBusy?.(true);
    try {
      const response = await api<Response>(
        '/auth/staff/change-password',
        { method: 'POST', body: JSON.stringify({ currentPassword, newPassword, code }) },
        'response',
      );
      if (response.status !== 204) throw new Error('نتیجهٔ تغییر رمز قابل تأیید نیست.');
      onChanged();
    } catch (error) {
      const ambiguous = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
      setUncertain(ambiguous);
      setError(
        error instanceof ApiError && error.status > 0 && error.status < 500
          ? error
          : new Error(
              'نتیجهٔ تغییر رمز دریافت نشد؛ دوباره ارسال نکنید. از حساب خارج شوید و ابتدا ورود با رمز تازه را بررسی کنید.',
            ),
      );
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setCode('');
      setBusy(false);
      locked.current = false;
      onBusy?.(false);
    }
  }
  return (
    <section className="panel staff-password-panel">
      <h2>تغییر رمز شخصی</h2>
      <p>
        رمزی انتخاب کنید که خودتان می‌دانید و آن را در مدیر رمز مطمئن نگه دارید. این فرم فقط رمز
        حساب فعلی شما را تغییر می‌دهد.
      </p>
      <p className="notice">
        پس از تغییر رمز، تمام نشست‌های این حساب بسته می‌شوند. برای ورود بعدی، رمز تازه و
        Authenticator همین حساب را آماده داشته باشید.
      </p>
      <ErrorBox error={error} />
      <form onSubmit={submit}>
        <fieldset disabled={busy || uncertain}>
          <div className="form-grid">
            <Field label="رمز فعلی">
              <PasswordInput
                aria-label="رمز فعلی"
                autoComplete="current-password"
                maxLength={128}
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field
              label="کد تازهٔ Authenticator برای تغییر رمز"
              hint="اگر همین کد را برای ورود استفاده کرده‌اید، منتظر کد بعدی بمانید."
            >
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                dir="ltr"
                value={code}
                onChange={(event) => setCode(normalizeMfaCode(event.target.value))}
              />
            </Field>
            <Field label="رمز تازه">
              <PasswordInput
                aria-label="رمز تازه"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field
              label="تکرار رمز تازه"
              error={confirmation && !matches ? 'رمز تازه و تکرار آن یکسان نیستند.' : undefined}
            >
              <PasswordInput
                aria-label="تکرار رمز تازه"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          </div>
          <ul className="security-password-rules" aria-label="شرایط رمز تازه">
            {checks.map(({ label, met }) => (
              <li key={label} data-met={met}>
                <span aria-hidden="true">{met ? '✓' : '○'}</span>
                <span>{label}</span>
                <span className="sr-only">{met ? 'رعایت شده' : 'در انتظار تکمیل'}</span>
              </li>
            ))}
          </ul>
          <button
            className="primary"
            disabled={
              busy ||
              !currentPassword ||
              !meetsPolicy ||
              !matches ||
              newPassword === currentPassword ||
              code.length !== 6
            }
          >
            {busy ? 'در حال تغییر رمز…' : 'تغییر رمز و خروج از نشست‌ها'}
          </button>
        </fieldset>
        {uncertain && (
          <button type="button" onClick={onChanged}>
            خروج و بررسی ورود با رمز تازه
          </button>
        )}
      </form>
    </section>
  );
}
