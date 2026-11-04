import { StaffRoleChoices } from './staff-role-choices';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, save, ApiError } from '../../api/api';
import { ErrorBox, Field } from '../../components/ui';
import { adminViewRevision } from '../../auth/admin-view-authority';
import {
  createStaffFormSchema,
  staffCreationPayload,
  readStaffCreation,
} from '../../api/contracts/staff/staff-onboarding-contract';
import {
  clearStaffCreationCommand,
  readStaffCreationCommand,
  rememberStaffCreationCommand,
} from '../../state/staff/staff-creation-journal';
import type { StaffRole, StaffRow } from '../../api/contracts/staff/staff-contract';

export function StaffCreate({
  viewerId,
  roles,
  onBusy,
  onCreated,
}: {
  viewerId: string;
  roles: StaffRole[];
  onBusy: (busy: boolean) => void;
  onCreated: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [command, setCommand] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [created, setCreated] = useState<StaffRow | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createStaffFormSchema),
    defaultValues: { userName: '', displayName: '', email: '', initialPassword: '' },
  });
  useEffect(() => {
    mounted.current = true;
    try {
      const id = readStaffCreationCommand(sessionStorage, viewerId);
      setCommand(id);
      setUncertain(!!id);
    } catch (failure) {
      setError(failure);
      setUncertain(true);
    }
    return () => {
      mounted.current = false;
    };
  }, [viewerId]);
  function begin() {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    return true;
  }
  function finish() {
    locked.current = false;
    if (mounted.current) {
      setBusy(false);
      onBusy(false);
    }
  }
  function accept(raw: unknown, id: string) {
    const receipt = readStaffCreation(raw, id);
    clearStaffCreationCommand(sessionStorage, viewerId, id);
    setCreated(receipt.staff);
    setUncertain(false);
  }
  async function receipt() {
    if (!command || !begin()) return;
    const revision = adminViewRevision();
    try {
      const raw = await api<unknown>(`/admin/staff/creation-commands/${command}`);
      if (mounted.current && adminViewRevision() === revision) accept(raw, command);
    } catch (failure) {
      if (!mounted.current || adminViewRevision() !== revision) return;
      if (failure instanceof ApiError && failure.status === 404) {
        setUncertain(false);
        setError(
          new Error(
            'هنوز رسیدی برای این شناسه ثبت نشده است. برای تکرار، مشخصات و همان رمز اولیه را دوباره وارد کنید؛ شناسهٔ تلاش حفظ می‌شود.',
          ),
        );
      } else setError(failure);
    } finally {
      finish();
    }
  }
  return (
    <>
      <p className="notice">
        برای همکار نام کاربری و رمز اولیه تعیین کنید و آن را خصوصی تحویل دهید. همکار در اولین ورود
        باید رمز را عوض کند و Authenticator را راه‌اندازی کند. ایمیل اختیاری است و با ساخت حساب،
        تأییدشده محسوب نمی‌شود.
      </p>
      <ErrorBox error={error} />
      {created ? (
        <section className="notice" role="status">
          <h3>حساب همکار ساخته شد</h3>
          <p>
            {created.displayName} · <bdi>{created.userName}</bdi>
          </p>
          <p>
            همکار برای اولین ورود رمز اولیه را عوض و Authenticator را راه‌اندازی می‌کند. وضعیت فعلی
            حساب را از فهرست کارکنان ببینید؛ رمز در رسید و سابقه نگهداری نمی‌شود.
          </p>
          <button className="primary" onClick={onCreated}>
            بازگشت به فهرست کارکنان
          </button>
        </section>
      ) : (
        <>
          {command && (
            <div className="notice">
              <p>
                شناسهٔ تلاش: <bdi>{command}</bdi>
              </p>
              <button type="button" onClick={() => void receipt()} disabled={busy}>
                پیگیری رسید همین تلاش
              </button>
              {uncertain && (
                <p>
                  نتیجهٔ ارسال هنوز تأیید نشده است؛ ابتدا رسید را پیگیری کنید. حساب دیگری خودکار
                  ساخته نمی‌شود.
                </p>
              )}
            </div>
          )}
          <form
            onSubmit={handleSubmit(async (values) => {
              if (uncertain || !begin()) return;
              const revision = adminViewRevision();
              let sent = false;
              try {
                const id = command ?? crypto.randomUUID();
                const payload = staffCreationPayload(values, selected, roles, id);
                rememberStaffCreationCommand(sessionStorage, viewerId, id);
                setCommand(id);
                sent = true;
                const raw = await save<unknown>('/admin/staff/accounts', payload);
                if (mounted.current && adminViewRevision() === revision) accept(raw, id);
              } catch (failure) {
                if (!mounted.current || adminViewRevision() !== revision) return;
                setUncertain(sent);
                setError(
                  sent
                    ? new Error(
                        'نتیجهٔ ساخت حساب تأیید نشد. با شناسهٔ همین تلاش رسید را پیگیری کنید؛ رمز اولیه از فرم پاک شد.',
                      )
                    : failure,
                );
              } finally {
                resetField('initialPassword');
                finish();
              }
            })}
          >
            <fieldset disabled={busy || uncertain}>
              <legend>مشخصات همکار جدید</legend>
              <div className="form-grid">
                <Field label="نام و نام خانوادگی">
                  <input autoComplete="off" maxLength={200} {...register('displayName')} />
                </Field>
                <Field
                  label="نام کاربری"
                  hint="۳ تا ۶۴ نویسهٔ انگلیسی، عدد، نقطه، خط تیره یا زیرخط."
                >
                  <input dir="ltr" autoComplete="off" maxLength={64} {...register('userName')} />
                </Field>
                <Field label="ایمیل (اختیاری)">
                  <input
                    dir="ltr"
                    type="email"
                    autoComplete="off"
                    maxLength={256}
                    {...register('email')}
                  />
                </Field>
                <Field
                  label="رمز اولیه"
                  hint="۱۲ تا ۱۲۸ نویسه؛ حرف بزرگ و کوچک انگلیسی، عدد و نماد."
                >
                  <input
                    dir="ltr"
                    type="password"
                    autoComplete="new-password"
                    maxLength={128}
                    {...register('initialPassword')}
                  />
                </Field>
              </div>
              {Object.entries(errors).map(([key, value]) => (
                <small className="invalid" key={key}>
                  {value.message}
                </small>
              ))}
              <StaffRoleChoices
                roles={roles}
                value={selected}
                onChange={setSelected}
                disabled={busy || uncertain}
              />
              <button className="primary" disabled={!selected.length}>
                {busy ? 'در حال ساخت…' : 'ساخت حساب همکار'}
              </button>
            </fieldset>
          </form>
        </>
      )}
    </>
  );
}
