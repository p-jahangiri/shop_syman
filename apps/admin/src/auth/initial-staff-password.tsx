import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { initialStaffPasswordSchema } from '../api/contracts/staff/staff-onboarding-contract';
import { save, ApiError } from '../api/api';
import { Field } from '../components/ui';
import type { Session } from '../types/types';

export function InitialStaffPassword({
  active,
  busy,
  onBegin,
  onFinish,
  onChanged,
  onFailure,
  onBack,
}: {
  active: () => boolean;
  busy: boolean;
  onBegin: () => boolean;
  onFinish: () => void;
  onChanged: (session: Session) => void;
  onFailure: (error: unknown) => void;
  onBack: () => void;
}) {
  const mounted = useRef(true);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(initialStaffPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  if (uncertain)
    return (
      <div className="notice" role="alert">
        <strong>نتیجهٔ تغییر رمز مشخص نیست</strong>
        <p>
          پاسخ معتبر دریافت نشد؛ ممکن است رمز تغییر کرده باشد. برای تعیین مرحلهٔ فعلی، دوباره وارد
          شوید.
        </p>
        <button type="button" className="primary" onClick={onBack}>
          بازگشت به ورود
        </button>
      </div>
    );
  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        if (!active() || !onBegin()) return;
        try {
          const session = await save<Session>('/auth/staff/password', {
            newPassword: values.newPassword,
          });
          if (
            !session.requiresMfa ||
            !session.requiresEnrollment ||
            session.requiresPasswordChange ||
            !session.accessToken
          )
            throw new Error('مرحلهٔ ورود قابل تأیید نیست؛ دوباره وارد شوید.');
          if (mounted.current) onChanged(session);
        } catch (failure) {
          if (mounted.current) {
            if (!(failure instanceof ApiError && failure.status >= 400 && failure.status < 500))
              setUncertain(true);
            onFailure(failure);
          }
        } finally {
          reset();
          onFinish();
        }
      })}
    >
      <p className="notice">
        رمز اولیه را با رمزی که فقط خودتان می‌دانید عوض کنید. پس از آن Authenticator را راه‌اندازی
        خواهید کرد.
      </p>
      <Field label="رمز جدید" hint="۱۲ تا ۱۲۸ نویسه؛ حرف بزرگ و کوچک انگلیسی، عدد و نماد.">
        <input
          type="password"
          autoComplete="new-password"
          dir="ltr"
          {...register('newPassword')}
          disabled={busy}
        />
      </Field>
      {errors.newPassword && <small className="invalid">{errors.newPassword.message}</small>}
      <Field label="تکرار رمز جدید">
        <input
          type="password"
          autoComplete="new-password"
          dir="ltr"
          {...register('confirmPassword')}
          disabled={busy}
        />
      </Field>
      {errors.confirmPassword && (
        <small className="invalid">{errors.confirmPassword.message}</small>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'در حال تغییر رمز…' : 'تغییر رمز و ادامه به Authenticator'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          mounted.current = false;
          reset();
          onBack();
        }}
      >
        بازگشت به ورود
      </button>
    </form>
  );
}
