import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, Check, ErrorBox, Field } from '../../components/ui';
import {
  readSmsSettings,
  readSmsSettingsReceipt,
  smsSettingsCommand,
  smsSettingsDraft,
  type SmsKeyAction,
  type SmsSettings,
} from '../../api/contracts/settings/sms-settings-contract';
import {
  beginSmsSettingsAttempt,
  finishSmsSettingsAttempt,
  interruptSmsSettingsAttempt,
  refreshSmsSettingsAttempt,
  smsSettingsAttempt,
} from '../../state/settings/sms-settings-attempt';
import '../../styles/settings/sms-settings.css';

const path = '/admin/sms/settings';
const availability = {
  unconfigured: 'کلید ثبت نشده',
  disabled: 'ارسال خاموش است',
  sandbox: 'حالت آزمایشی',
  configured: 'پیکربندی شده',
};
export function SmsSettingsPage({
  viewerId,
  onManageAuth,
}: {
  viewerId: string;
  onManageAuth?: () => void;
}) {
  const instance = useId(),
    revision = adminViewRevision();
  const [generation, setGeneration] = useState(0);
  const [attempt, setAttempt] = useState(() => smsSettingsAttempt(viewerId));
  const active = useRef(true);
  const refreshTicket = useRef<{
    viewerId: string;
    revision: number;
    generation: number;
    requestId: string | null;
  } | null>(null);
  const owner = useRef({ viewerId, revision, generation });
  owner.current = { viewerId, revision, generation };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ['admin', 'sms-settings', instance, viewerId, revision, generation],
    queryFn: async ({ signal }) => {
      const raw = await api<unknown>(path, { signal });
      if (
        signal.aborted ||
        !active.current ||
        revision !== adminViewRevision() ||
        owner.current.viewerId !== viewerId ||
        owner.current.revision !== revision ||
        owner.current.generation !== generation
      )
        throw new Error('این درخواست به نشست فعلی تعلق ندارد.');
      return readSmsSettings(raw);
    },
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (!query.data) return;
    const latest = smsSettingsAttempt(viewerId),
      ticket = refreshTicket.current;
    // A read already in flight when a write became uncertain cannot unlock
    // another write. Only the explicit, newer read may clear that requirement.
    if (
      latest?.needsRefresh &&
      ticket?.viewerId === viewerId &&
      ticket.revision === revision &&
      ticket.generation === generation &&
      ticket.requestId === latest.requestId
    )
      refreshSmsSettingsAttempt(viewerId);
    setAttempt(smsSettingsAttempt(viewerId));
  }, [query.data, viewerId, revision, generation]);
  function refresh() {
    const next = owner.current.generation + 1;
    refreshTicket.current = {
      viewerId,
      revision,
      generation: next,
      requestId: smsSettingsAttempt(viewerId)?.requestId ?? null,
    };
    setGeneration(next);
  }
  return (
    <section className="sms-settings-page">
      <div className="panel sms-settings-intro">
        <div className="sms-settings-heading">
          <span className="sms-settings-emblem" aria-hidden="true">
            <MessageSquare size={25} />
          </span>
          <div>
            <h2>پیامک و کد ورود مشتریان</h2>
            <p>سرویس ارسال، قالب پیامک و کلید اتصال را در یک بخش امن مدیریت کنید.</p>
          </div>
          <button
            type="button"
            disabled={query.isFetching || attempt?.outcome === 'pending'}
            onClick={refresh}
          >
            <RefreshCw size={16} aria-hidden="true" />
            بازخوانی تنظیمات جاری
          </button>
        </div>
        <p className="sms-settings-note">
          این تنظیمات مستقل از روش‌های ورود مشتری، رمز عبور و Authenticator کارکنان هستند. ذخیرهٔ
          تنظیمات به‌تنهایی تأیید ارسال یا تحویل پیامک نیست.
        </p>
        {onManageAuth && (
          <button type="button" className="sms-settings-link" onClick={onManageAuth}>
            مدیریت روش‌های ورود مشتری
          </button>
        )}
      </div>
      {attempt?.viewerId === viewerId && (
        <div className="notice sms-settings-receipt" role="status">
          <strong>
            {attempt.outcome === 'pending'
              ? 'در حال ذخیرهٔ تنظیمات…'
              : attempt.outcome === 'confirmed'
                ? 'پاسخ ذخیرهٔ تنظیمات تأیید شد'
                : attempt.outcome === 'conflict'
                  ? 'نسخهٔ تنظیمات تغییر کرده است'
                  : attempt.outcome === 'rejected'
                    ? 'درخواست تنظیمات رد شد'
                    : 'نتیجهٔ ذخیره قطعی نیست'}
          </strong>
          <span>
            شناسهٔ پیگیری: <bdi>{attempt.requestId}</bdi>
          </span>
          {attempt.outcome === 'unknown' && (
            <p>
              کلید و بدنهٔ درخواست نگهداری نشده‌اند؛ این درخواست خودکار تکرار نمی‌شود. بازخوانی فقط
              وضعیت جاری را نشان می‌دهد و رسید قطعی درخواست قبلی نیست.
            </p>
          )}
          {attempt.needsRefresh && (
            <p>
              پیش از تغییر تازه، تنظیمات جاری را بازخوانی کنید. اگر کلید را جایگزین می‌کنید، باید
              دوباره وارد شود.
            </p>
          )}
        </div>
      )}
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <>
          <ErrorBox error={query.error} />
          <button type="button" onClick={refresh}>
            دریافت دوبارهٔ تنظیمات پیامک
          </button>
        </>
      ) : (
        query.data && (
          <SmsSettingsForm
            key={viewerId + ':' + revision + ':' + generation + ':' + query.data.version}
            initial={query.data}
            viewerId={viewerId}
            blocked={attempt?.needsRefresh === true || attempt?.outcome === 'pending'}
            onOutcome={() => {
              if (active.current && revision === adminViewRevision())
                setAttempt(smsSettingsAttempt(viewerId));
            }}
            onSaved={() => {
              if (active.current && revision === adminViewRevision()) refresh();
            }}
          />
        )
      )}
    </section>
  );
}

export function SmsSettingsForm({
  initial,
  viewerId,
  blocked,
  onOutcome,
  onSaved,
}: {
  initial: SmsSettings;
  viewerId: string;
  blocked: boolean;
  onOutcome: () => void;
  onSaved: () => void;
}) {
  const authority = useRef(adminViewRevision()).current;
  const [draft, setDraft] = useState(() => smsSettingsDraft(initial));
  const [keyAction, setKeyAction] = useState<SmsKeyAction>('keep');
  const [confirmedClear, setConfirmedClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const sending = useRef(false),
    alive = useRef(true),
    secret = useRef('');
  const keyInput = useRef<HTMLInputElement | null>(null);
  const context = useRef({ blocked });
  context.current = { blocked };
  const current = () => alive.current && authority === adminViewRevision();
  function clearSecret() {
    secret.current = '';
    if (keyInput.current) keyInput.current.value = '';
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      secret.current = '';
      interruptSmsSettingsAttempt(viewerId);
    };
  }, [viewerId]);
  function changeKeyAction(action: SmsKeyAction) {
    clearSecret();
    setKeyAction(action);
    setConfirmedClear(false);
    setError(undefined);
  }
  const effective =
    draft.mode === 'sandbox'
      ? {
          ...draft,
          templateId: '123456',
          codeParameterName: 'Code',
          useName: false,
          nameParameterName: 'NAME',
          genericName: '',
        }
      : draft;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current() || sending.current || context.current.blocked) return;
    if (keyAction === 'clear' && !confirmedClear) {
      setError(new Error('حذف کلید و توقف ارسال وابسته به آن را صریح تأیید کنید.'));
      return;
    }
    let command;
    try {
      command = smsSettingsCommand(
        effective,
        initial.version,
        crypto.randomUUID().replaceAll('-', ''),
        keyAction,
        secret.current,
      );
    } catch {
      clearSecret();
      setError(
        new Error(
          'شناسهٔ قالب، نام پارامترها و کلید جایگزین را بررسی کنید؛ کلید بدون فاصله و نام عمومی حداکثر ۲۵ نویسه باشد.',
        ),
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(undefined);
    beginSmsSettingsAttempt({
      viewerId,
      requestId: command.requestId,
      baseVersion: command.version,
      action: command.apiKeyAction,
    });
    onOutcome();
    try {
      const raw = await api<unknown>(path, { method: 'PUT', body: JSON.stringify(command) });
      if (!current()) {
        finishSmsSettingsAttempt(viewerId, command.requestId, 'unknown');
        return;
      }
      readSmsSettingsReceipt(raw, command, initial.keyConfigured);
      finishSmsSettingsAttempt(viewerId, command.requestId, 'confirmed');
      clearSecret();
      if (current()) {
        onOutcome();
        onSaved();
      }
    } catch (failure) {
      const status = failure instanceof ApiError ? failure.status : 0;
      finishSmsSettingsAttempt(
        viewerId,
        command.requestId,
        !current()
          ? 'unknown'
          : status === 409
            ? 'conflict'
            : status >= 400 && status < 500 && status !== 408
              ? 'rejected'
              : 'unknown',
      );
      if (current()) {
        setError(
          new Error(
            status === 409
              ? 'تنظیمات یا وضعیت ورود مشتری تغییر کرده است؛ تنظیمات جاری را بازخوانی کنید.'
              : status === 403
                ? 'فقط مدیر کلِ دارای نشست تأییدشده اجازهٔ تغییر این تنظیمات را دارد.'
                : status >= 400 && status < 500 && status !== 408
                  ? 'درخواست پذیرفته نشد؛ تنظیمات و دسترسی را بررسی کنید.'
                  : 'پاسخ ذخیره قطعی نیست؛ درخواست تکرار نشده است. تنظیمات جاری را بازخوانی کنید.',
          ),
        );
        onOutcome();
      }
    } finally {
      clearSecret();
      sending.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <form
      className="panel sms-settings-form"
      aria-label="تنظیمات امن پیامک"
      onSubmit={(event) => void submit(event)}
    >
      <div className="sms-settings-status">
        <span className={'sms-settings-state sms-state-' + initial.availability}>
          {availability[initial.availability]}
        </span>
        <span>
          <ShieldCheck size={16} aria-hidden="true" />
          {initial.keyConfigured
            ? 'کلید ذخیره شده است؛ مقدار آن نمایش داده نمی‌شود.'
            : 'کلیدی ذخیره نشده است.'}
        </span>
      </div>
      <ErrorBox error={error} />
      <fieldset disabled={busy || blocked} className="sms-settings-fields">
        <legend>سرویس و ارسال</legend>
        <div className="sms-settings-grid">
          <Field label="سرویس پیامک">
            <select value="smsIr" disabled>
              <option value="smsIr">SMS.ir</option>
            </select>
          </Field>
          <Field label="حالت سرویس">
            <select
              value={draft.mode}
              onChange={(event) => {
                clearSecret();
                setDraft({ ...draft, mode: event.target.value as 'live' | 'sandbox' });
                setKeyAction('keep');
                setConfirmedClear(false);
              }}
            >
              <option value="live">ارسال واقعی</option>
              <option value="sandbox">آزمایش سرویس SMS.ir</option>
            </select>
          </Field>
        </div>
        <Check
          label="ارسال کد ورود با این سرویس فعال باشد"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />
        {draft.mode === 'sandbox' ? (
          <p className="notice">
            حالت آزمایشی به کلید ویژهٔ Sandbox، قالب ۱۲۳۴۵۶ و پارامتر Code بدون NAME نیاز دارد؛
            هنگام تغییر حالت، کلید متناسب با آن را جایگزین کنید. این حالت تأیید هویت مشتری را فعال
            نمی‌کند و اثبات تحویل پیامک واقعی نیست.
          </p>
        ) : (
          <p className="sms-settings-note">
            ارسال واقعی به کلید معتبر و قالب تأییدشده برای وب‌سایت نیاز دارد. قالب ۱۲۳۴۵۶ فقط
            آزمایشی است و برای ارسال واقعی پذیرفته نمی‌شود. پیکربندی شدن، تأیید اتصال، موجودی اعتبار
            یا تحویل پیامک نیست.
          </p>
        )}
        <div className="sms-settings-grid">
          <Field label="شناسهٔ قالب تأییدشده">
            <input
              inputMode="numeric"
              dir="ltr"
              value={effective.templateId}
              readOnly={draft.mode === 'sandbox'}
              onChange={(event) => setDraft({ ...draft, templateId: event.target.value })}
            />
          </Field>
          <Field label="نام پارامتر کد">
            <input
              dir="ltr"
              maxLength={50}
              value={effective.codeParameterName}
              readOnly={draft.mode === 'sandbox'}
              onChange={(event) => setDraft({ ...draft, codeParameterName: event.target.value })}
            />
          </Field>
        </div>
        {draft.mode === 'live' && (
          <p className="notice sms-settings-template-warning">
            وضعیت تأیید قالب را در پنل SMS.ir بررسی کنید؛ این بخش فقط تنظیمات اتصال را ذخیره می‌کند
            و وضعیت تأیید سرویس را تعیین نمی‌کند.
          </p>
        )}
        <Check
          label="قالب، پارامتر نام عمومی هم دارد"
          checked={effective.useName}
          disabled={draft.mode === 'sandbox'}
          onChange={(event) => setDraft({ ...draft, useName: event.target.checked })}
        />
        {effective.useName && (
          <div className="sms-settings-grid">
            <Field label="نام پارامتر نام عمومی">
              <input
                dir="ltr"
                maxLength={50}
                value={draft.nameParameterName}
                onChange={(event) => setDraft({ ...draft, nameParameterName: event.target.value })}
              />
            </Field>
            <Field label="نام عمومی در پیامک">
              <input
                maxLength={25}
                value={draft.genericName}
                onChange={(event) => setDraft({ ...draft, genericName: event.target.value })}
              />
            </Field>
          </div>
        )}
      </fieldset>
      <fieldset disabled={busy || blocked} className="sms-settings-fields">
        <legend>
          <KeyRound size={17} aria-hidden="true" />
          کلید اتصال
        </legend>
        <Field label="عملیات کلید">
          <select
            value={keyAction}
            onChange={(event) => changeKeyAction(event.target.value as SmsKeyAction)}
          >
            <option value="keep">نگه‌داشتن کلید فعلی</option>
            <option value="replace">ثبت یا جایگزینی کلید</option>
            <option value="clear">حذف کلید ذخیره‌شده</option>
          </select>
        </Field>
        {keyAction === 'replace' && (
          <Field label="کلید جدید API">
            <input
              ref={keyInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              dir="ltr"
              onChange={(event) => {
                secret.current = event.target.value;
              }}
            />
          </Field>
        )}
        {keyAction === 'clear' && (
          <Check
            label="حذف کلید و قطع ارسال وابسته به آن را تأیید می‌کنم"
            checked={confirmedClear}
            onChange={(event) => setConfirmedClear(event.target.checked)}
          />
        )}
        <p className="sms-settings-note">
          کلید فعلی بازخوانی نمی‌شود. برای حفظ آن، «نگه‌داشتن» را انتخاب کنید. کلید تازه پس از پایان
          این تلاش از فرم پاک می‌شود و در سابقهٔ قابل نمایش یا ذخیره‌سازی مرورگر نگهداری نمی‌شود.
        </p>
      </fieldset>
      <div className="sms-settings-limits" aria-label="قواعد کد ورود">
        <span>اعتبار کد: ۵ دقیقه</span>
        <span>ارسال دوباره: پس از ۶۰ ثانیه</span>
        <span>سقف تلاش: ۵ بار</span>
      </div>
      <p className="sms-settings-note">
        هر ذخیرهٔ موفق تازه، کدهای ورود در انتظار را باطل می‌کند؛ مشتری باید کد تازه درخواست کند.
        این کار رمز عبور یا Authenticator کارکنان را تغییر نمی‌دهد.
      </p>
      <div className="sms-settings-save">
        <button
          type="submit"
          className="primary"
          disabled={busy || blocked || (keyAction === 'clear' && !confirmedClear)}
        >
          {busy ? 'در حال ذخیره…' : 'ذخیرهٔ تنظیمات پیامک'}
        </button>
        <span>ذخیره، پیامک آزمایشی ارسال نمی‌کند.</span>
      </div>
    </form>
  );
}
