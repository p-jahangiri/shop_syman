import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Cable,
  FileText,
  KeyRound,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Trash2,
} from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, Check, ErrorBox, Field } from '../../components/ui';
import {
  beginSmsSettingsAttempt,
  finishSmsSettingsAttempt,
  interruptSmsSettingsAttempt,
  refreshSmsSettingsAttempt,
  smsSettingsAttempt,
} from '../../state/settings/sms-settings-attempt';
import {
  readSmsWorkspace,
  readSmsWorkspaceReceipt,
  smsAllowedSources,
  smsEventLabels,
  smsEvents,
  smsMessageSchema,
  smsMessagesSchema,
  smsSamplePreview,
  smsSourceLabels,
  smsWorkspaceCommand,
  type SmsConnection,
  type SmsEvent,
  type SmsKeyAction,
  type SmsTemplate,
  type SmsWorkspace,
} from '../../api/contracts/settings/sms-workspace-contract';
import '../../styles/settings/sms-workspace.css';

const path = '/admin/sms/workspace';
const uid = () => crypto.randomUUID().replaceAll('-', '');
const tabs = [
  ['connections', 'اتصال‌ها', Cable],
  ['templates', 'قالب‌ها و متغیرها', FileText],
  ['login', 'قواعد ورود', KeyRound],
  ['notifications', 'اعلان‌ها', Settings2],
] as const;
type Tab = (typeof tabs)[number][0];
export function SmsWorkspacePage({
  viewerId,
  onManageAuth,
}: {
  viewerId: string;
  onManageAuth?: () => void;
}) {
  const instance = useId(),
    revision = adminViewRevision();
  const [generation, setGeneration] = useState(0),
    [attempt, setAttempt] = useState(() => smsSettingsAttempt(viewerId));
  const alive = useRef(true),
    refreshTicket = useRef<{ generation: number; requestId: string | null } | null>(null);
  const owner = useRef({ viewerId, revision, generation });
  owner.current = { viewerId, revision, generation };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ['admin', 'sms-workspace', instance, viewerId, revision, generation],
    queryFn: async ({ signal }) => {
      const raw = await api<unknown>(path, { signal });
      if (
        signal.aborted ||
        !alive.current ||
        revision !== adminViewRevision() ||
        owner.current.viewerId !== viewerId ||
        owner.current.revision !== revision ||
        owner.current.generation !== generation
      )
        throw new Error('نشست تغییر کرده است.');
      return readSmsWorkspace(raw);
    },
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (!query.data) return;
    const current = smsSettingsAttempt(viewerId),
      ticket = refreshTicket.current;
    if (
      current?.needsRefresh &&
      ticket?.generation === generation &&
      ticket.requestId === current.requestId
    )
      refreshSmsSettingsAttempt(viewerId);
    setAttempt(smsSettingsAttempt(viewerId));
  }, [query.data, viewerId, generation]);
  function refresh() {
    const next = owner.current.generation + 1;
    refreshTicket.current = {
      generation: next,
      requestId: smsSettingsAttempt(viewerId)?.requestId ?? null,
    };
    setGeneration(next);
  }
  return (
    <section className="sms-workspace">
      <header className="panel sms-workspace-intro">
        <div className="sms-workspace-title">
          <span className="sms-workspace-icon">
            <MessageSquare aria-hidden="true" />
          </span>
          <div>
            <h2>مرکز پیامک</h2>
            <p>اتصال سرویس، قالب‌ها، ورود مشتری و اعلان‌های فروش را یک‌جا مدیریت کنید.</p>
          </div>
          <button
            type="button"
            disabled={query.isFetching || attempt?.outcome === 'pending'}
            onClick={refresh}
          >
            <RefreshCw size={16} aria-hidden="true" /> بازخوانی
          </button>
        </div>
        <details>
          <summary>راهنمای راه‌اندازی و کار با این بخش</summary>
          <ol>
            <li>در «اتصال‌ها» سرویس و کلید محرمانه را ثبت کنید؛ چند اتصال هم‌زمان مجاز است.</li>
            <li>
              قالب تأییدشدهٔ همان سرویس را در «قالب‌ها» اضافه و هر پارامتر را به دادهٔ مناسب وصل
              کنید. متن پیش‌نمایش، قالب سرویس‌دهنده را تغییر نمی‌دهد.
            </li>
            <li>
              در «قواعد ورود» قالب OTP و محدودیت‌ها را انتخاب کنید؛ در «اعلان‌ها» رویدادهای دلخواه
              را جدا روشن کنید.
            </li>
            <li>
              تغییرها با یک ذخیره اعمال می‌شوند. فعال‌سازی اعلان فقط برای رویدادهای آینده است؛
              پیش‌نمایش و ذخیره، پیامک ارسال نمی‌کنند.
            </li>
          </ol>
          <p>
            ورود کارکنان با رمز و Authenticator مستقل است. کلید ذخیره‌شده هرگز نمایش داده نمی‌شود.
            «پذیرفته‌شده» در گزارش، تأیید تحویل به گوشی نیست.
          </p>
        </details>
        {onManageAuth && (
          <button type="button" className="link-button" onClick={onManageAuth}>
            مدیریت روش‌های ورود مشتری در تنظیمات فروشگاه
          </button>
        )}
      </header>
      {attempt && (
        <div className={'notice sms-command-result sms-command-' + attempt.outcome} role="status">
          <strong>
            {attempt.outcome === 'confirmed'
              ? 'تنظیمات ذخیره شد'
              : attempt.outcome === 'pending'
                ? 'در حال ذخیره…'
                : attempt.outcome === 'conflict'
                  ? 'نسخهٔ تنظیمات تغییر کرده است'
                  : attempt.outcome === 'rejected'
                    ? 'درخواست ذخیره رد شد'
                    : 'نتیجهٔ ذخیره قطعی نیست'}
          </strong>
          <span>
            پیگیری: <bdi>{attempt.requestId}</bdi>
          </span>
          {attempt.needsRefresh && (
            <p>
              درخواست خودکار تکرار نمی‌شود. بازخوانی را بزنید و وضعیت جاری را بررسی کنید؛ کلید تازه
              باید دوباره وارد شود.
            </p>
          )}
        </div>
      )}
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : (
        query.data && (
          <SmsWorkspaceForm
            key={viewerId + ':' + revision + ':' + generation + ':' + query.data.version}
            initial={query.data}
            viewerId={viewerId}
            blocked={attempt?.needsRefresh === true || attempt?.outcome === 'pending'}
            onOutcome={() => {
              if (alive.current && revision === adminViewRevision())
                setAttempt(smsSettingsAttempt(viewerId));
            }}
            onSaved={refresh}
          />
        )
      )}
      <SmsDeliveryLog templates={query.data?.templates ?? []} key={viewerId + ':' + revision} />
    </section>
  );
}

export function SmsWorkspaceForm({
  initial,
  viewerId,
  blocked,
  onOutcome,
  onSaved,
}: {
  initial: SmsWorkspace;
  viewerId: string;
  blocked: boolean;
  onOutcome: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial)),
    [tab, setTab] = useState<Tab>('connections');
  const [connectionId, setConnectionId] = useState(initial.connections[0]?.id ?? ''),
    [templateId, setTemplateId] = useState(initial.templates[0]?.id ?? '');
  const [actions, setActions] = useState<Record<string, SmsKeyAction>>({}),
    [clearConfirmed, setClearConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const authority = useRef(adminViewRevision()).current,
    alive = useRef(true),
    sending = useRef(false),
    secrets = useRef<Record<string, string>>({}),
    keyInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const context = useRef({ blocked });
  context.current = { blocked };
  const current = () => alive.current && authority === adminViewRevision();
  const connection = draft.connections.find((c) => c.id === connectionId),
    template = draft.templates.find((t) => t.id === templateId);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) ||
    Object.values(actions).some((a) => a !== 'keep');
  function clearSecrets(id?: string) {
    for (const key of id ? [id] : Object.keys(secrets.current)) {
      delete secrets.current[key];
      const input = keyInputs.current[key];
      if (input) input.value = '';
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      secrets.current = {};
      interruptSmsSettingsAttempt(viewerId);
    };
  }, [viewerId]);
  function changeConnection(patch: Partial<SmsConnection>) {
    if (!connection) return;
    if (patch.provider !== undefined || patch.mode !== undefined) {
      clearSecrets(connection.id);
      setActions((a) => ({ ...a, [connection.id]: 'keep' }));
    }
    setDraft((d) => ({
      ...d,
      connections: d.connections.map((c) => (c.id === connection.id ? { ...c, ...patch } : c)),
    }));
  }
  function changeTemplate(patch: Partial<SmsTemplate>) {
    if (template)
      setDraft((d) => ({
        ...d,
        templates: d.templates.map((t) => (t.id === template.id ? { ...t, ...patch } : t)),
      }));
  }
  function addConnection() {
    const id = uid();
    setDraft((d) => ({
      ...d,
      connections: [
        ...d.connections,
        {
          id,
          name: 'اتصال جدید',
          provider: 'smsIr',
          mode: 'live',
          enabled: false,
          keyConfigured: false,
        },
      ],
    }));
    setConnectionId(id);
  }
  function addTemplate() {
    const c = draft.connections[0];
    if (!c) {
      setError(new Error('ابتدا یک اتصال بسازید.'));
      setTab('connections');
      return;
    }
    const id = uid();
    setDraft((d) => ({
      ...d,
      templates: [
        ...d.templates,
        {
          id,
          name: 'قالب جدید',
          kind: 'otp',
          connectionId: c.id,
          providerTemplate: c.provider === 'smsIr' ? '' : 'SaymanOtp',
          approved: false,
          previewText: c.provider === 'smsIr' ? 'کد ورود شما: #CODE#' : 'کد ورود شما: %token',
          parameters: [
            { name: c.provider === 'smsIr' ? 'CODE' : 'token', source: 'code', constant: null },
          ],
        },
      ],
    }));
    setTemplateId(id);
  }
  function route(event: SmsEvent) {
    const r = draft.routes.find((r) => r.event === event)!;
    return (
      <div className="sms-route" key={event}>
        <div>
          <strong>{smsEventLabels[event]}</strong>
          <p>
            {event === 'otp'
              ? 'قالب ورود مشتری با کد شش‌رقمی'
              : event === 'chequeReminder'
                ? 'پس از ثبت یادآوری داخلی چک با برنامه یا فرمان مدیر'
                : event === 'creditApproved'
                  ? 'پس از پیش‌پرداخت و تأیید دستی همهٔ چک‌ها'
                  : event === 'orderShipped'
                    ? 'برای هر مرسولهٔ ارسال‌شده؛ کد رهگیری تنها در صورت ثبت واقعی'
                    : 'برای رویدادهای جدید پس از فعال‌سازی'}
          </p>
        </div>
        <Field label={'قالب ' + smsEventLabels[event]}>
          <select
            value={r.templateId ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                routes: d.routes.map((x) =>
                  x.event === event
                    ? {
                        ...x,
                        templateId: e.target.value || null,
                        enabled: e.target.value ? x.enabled : false,
                      }
                    : x,
                ),
              }))
            }
          >
            <option value="">انتخاب قالب</option>
            {draft.templates
              .filter((t) => t.kind === event)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </Field>
        <Check
          label="فعال"
          checked={r.enabled}
          disabled={!r.templateId}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              routes: d.routes.map((x) =>
                x.event === event ? { ...x, enabled: e.target.checked } : x,
              ),
            }))
          }
        />
      </div>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current() || sending.current || context.current.blocked || !dirty) return;
    if (Object.entries(actions).some(([id, action]) => action === 'clear' && !clearConfirmed[id])) {
      setError(new Error('حذف کلید را در همان اتصال تأیید کنید.'));
      return;
    }
    let command;
    try {
      command = smsWorkspaceCommand(draft, uid(), actions, secrets.current);
    } catch {
      clearSecrets();
      setError(
        new Error(
          'مقادیر الزامی، شناسهٔ قالب، متغیرها و سقف‌های ارسال را بررسی کنید؛ در صورت جایگزینی کلید، آن را دوباره وارد کنید.',
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
      action: 'keep',
    });
    onOutcome();
    try {
      const raw = await api<unknown>(path, { method: 'PUT', body: JSON.stringify(command) });
      if (!current()) {
        finishSmsSettingsAttempt(viewerId, command.requestId, 'unknown');
        return;
      }
      readSmsWorkspaceReceipt(raw, command, initial);
      finishSmsSettingsAttempt(viewerId, command.requestId, 'confirmed');
      clearSecrets();
      onOutcome();
      onSaved();
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
          failure instanceof ApiError ? failure : new Error('پاسخ ذخیره قطعی نیست؛ بازخوانی کنید.'),
        );
        onOutcome();
      }
    } finally {
      clearSecrets();
      sending.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <form
      className="panel sms-editor"
      aria-label="مدیریت مرکز پیامک"
      onSubmit={(e) => void submit(e)}
    >
      <div className="sms-tabbar" aria-label="بخش‌های تنظیمات پیامک">
        {tabs.map(([id, label, Icon]) => (
          <button
            type="button"
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      <fieldset disabled={busy || blocked} className="sms-editor-fields">
        <legend className="sr-only">تنظیمات پیامک</legend>
        {tab === 'connections' && (
          <div className="sms-master-detail">
            <aside className="sms-item-list">
              <div className="sms-list-heading">
                <strong>
                  اتصال‌ها <span>{draft.connections.length}/۱۰</span>
                </strong>
                <button
                  type="button"
                  disabled={draft.connections.length >= 10}
                  onClick={addConnection}
                >
                  <Plus size={15} /> افزودن
                </button>
              </div>
              {draft.connections.map((c) => (
                <button
                  type="button"
                  className={c.id === connectionId ? 'selected' : ''}
                  aria-pressed={c.id === connectionId}
                  key={c.id}
                  onClick={() => setConnectionId(c.id)}
                >
                  <span>{c.name}</span>
                  <small>
                    {c.provider === 'smsIr' ? 'SMS.ir' : 'کاوه‌نگار'} ·{' '}
                    {c.enabled ? 'روشن' : 'خاموش'} · {c.keyConfigured ? 'دارای کلید' : 'بدون کلید'}
                  </small>
                </button>
              ))}
              {!draft.connections.length && (
                <p className="sms-empty">اولین اتصال پیامک را اضافه کنید.</p>
              )}
            </aside>
            <div className="sms-detail">
              {connection ? (
                <>
                  <div className="sms-section-heading">
                    <div>
                      <h3>تنظیم اتصال</h3>
                      <p>کلید مستقل برای هر سرویس و حساب پیامکی</p>
                    </div>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (draft.templates.some((t) => t.connectionId === connection.id)) {
                          setError(
                            new Error('ابتدا قالب‌های وابسته به این اتصال را جابه‌جا یا حذف کنید.'),
                          );
                          return;
                        }
                        clearSecrets(connection.id);
                        setDraft((d) => ({
                          ...d,
                          connections: d.connections.filter((c) => c.id !== connection.id),
                        }));
                        setConnectionId('');
                      }}
                    >
                      <Trash2 size={15} /> حذف اتصال
                    </button>
                  </div>
                  <div className="sms-fields-grid">
                    <Field label="نام اتصال" required hint="مثلاً حساب اصلی فروشگاه">
                      <input
                        value={connection.name}
                        maxLength={100}
                        onChange={(e) => changeConnection({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="سرویس‌دهنده">
                      <select
                        value={connection.provider}
                        onChange={(e) =>
                          changeConnection({
                            provider: e.target.value as SmsConnection['provider'],
                            mode: 'live',
                          })
                        }
                      >
                        <option value="smsIr">SMS.ir</option>
                        <option value="kavenegar">کاوه‌نگار</option>
                      </select>
                    </Field>
                    <Field label="حالت ارسال">
                      <select
                        value={connection.mode}
                        onChange={(e) =>
                          changeConnection({ mode: e.target.value as SmsConnection['mode'] })
                        }
                      >
                        <option value="live">واقعی</option>
                        {connection.provider === 'smsIr' && (
                          <option value="sandbox">Sandbox؛ فقط توسعه</option>
                        )}
                      </select>
                    </Field>
                    <Field label="وضعیت کلید">
                      <input
                        readOnly
                        value={
                          connection.keyConfigured
                            ? 'کلید رمز‌شده ذخیره شده'
                            : 'هنوز کلیدی ذخیره نشده'
                        }
                      />
                    </Field>
                  </div>
                  <Check
                    label="این اتصال آمادهٔ استفاده باشد"
                    checked={connection.enabled}
                    onChange={(e) => changeConnection({ enabled: e.target.checked })}
                  />
                  <div className="sms-key-box">
                    <h4>
                      <KeyRound size={16} /> کلید محرمانهٔ API
                    </h4>
                    <Field label="عملیات کلید">
                      <select
                        value={actions[connection.id] ?? 'keep'}
                        onChange={(e) => {
                          clearSecrets(connection.id);
                          setActions((a) => ({
                            ...a,
                            [connection.id]: e.target.value as SmsKeyAction,
                          }));
                          setClearConfirmed((c) => ({ ...c, [connection.id]: false }));
                        }}
                      >
                        <option value="keep">حفظ کلید فعلی</option>
                        <option value="replace">ثبت یا جایگزینی کلید</option>
                        <option value="clear">حذف کلید</option>
                      </select>
                    </Field>
                    {actions[connection.id] === 'replace' && (
                      <Field
                        label="کلید تازه"
                        required
                        hint="فقط در همین کادر وارد کنید؛ مقدار فعلی بازخوانی نمی‌شود."
                      >
                        <input
                          key={connection.id}
                          ref={(node) => {
                            keyInputs.current[connection.id] = node;
                          }}
                          defaultValue={secrets.current[connection.id] ?? ''}
                          type="password"
                          dir="ltr"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={512}
                          onChange={(e) => {
                            secrets.current[connection.id] = e.target.value;
                          }}
                        />
                      </Field>
                    )}
                    {actions[connection.id] === 'clear' && (
                      <Check
                        label="حذف کلید و توقف مسیرهای وابسته را تأیید می‌کنم"
                        checked={clearConfirmed[connection.id] ?? false}
                        onChange={(e) =>
                          setClearConfirmed((c) => ({ ...c, [connection.id]: e.target.checked }))
                        }
                      />
                    )}
                    <p>
                      با تغییر سرویس یا حالت، کلید متناسب را جایگزین یا پاک کنید. کلید تازه پس از
                      تلاش ذخیره از فرم پاک می‌شود.
                    </p>
                  </div>
                  <p className="sms-help-note">
                    ارسال واقعی به اعتبار حساب و قالب تأییدشده در پنل سرویس‌دهنده نیاز دارد. فقط
                    endpoint رسمی سرویس استفاده می‌شود.
                  </p>
                </>
              ) : (
                <div className="sms-empty">یک اتصال را انتخاب یا اضافه کنید.</div>
              )}
            </div>
          </div>
        )}
        {tab === 'templates' && (
          <div className="sms-master-detail">
            <aside className="sms-item-list">
              <div className="sms-list-heading">
                <strong>
                  قالب‌ها <span>{draft.templates.length}/۳۰</span>
                </strong>
                <button type="button" disabled={draft.templates.length >= 30} onClick={addTemplate}>
                  <Plus size={15} /> افزودن
                </button>
              </div>
              {draft.templates.map((t) => (
                <button
                  type="button"
                  className={t.id === templateId ? 'selected' : ''}
                  aria-pressed={t.id === templateId}
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                >
                  <span>{t.name}</span>
                  <small>
                    {smsEventLabels[t.kind]} · {t.approved ? 'تأییدشده' : 'نیاز به تأیید'}
                  </small>
                </button>
              ))}
              {!draft.templates.length && (
                <p className="sms-empty">برای هر کاربرد یک قالب اضافه کنید.</p>
              )}
            </aside>
            <div className="sms-detail">
              {template ? (
                <>
                  <div className="sms-section-heading">
                    <div>
                      <h3>قالب و داده‌های پویا</h3>
                      <p>نام پارامتر باید دقیقاً با قالب سرویس‌دهنده یکسان باشد.</p>
                    </div>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setDraft((d) => ({
                          ...d,
                          templates: d.templates.filter((t) => t.id !== template.id),
                          routes: d.routes.map((r) =>
                            r.templateId === template.id
                              ? { ...r, templateId: null, enabled: false }
                              : r,
                          ),
                        }));
                        setTemplateId('');
                      }}
                    >
                      <Trash2 size={15} /> حذف قالب
                    </button>
                  </div>
                  <div className="sms-fields-grid">
                    <Field label="نام داخلی قالب" required>
                      <input
                        value={template.name}
                        maxLength={100}
                        onChange={(e) => changeTemplate({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="کاربرد">
                      <select
                        value={template.kind}
                        onChange={(e) => {
                          const kind = e.target.value as SmsEvent;
                          changeTemplate({
                            kind,
                            parameters: template.parameters.map((p, i) => {
                              const source =
                                kind === 'otp' && i === 0
                                  ? 'code'
                                  : smsAllowedSources(kind).includes(p.source)
                                    ? p.source
                                    : 'genericName';
                              return {
                                ...p,
                                source,
                                constant: source === 'constant' ? (p.constant ?? '') : null,
                              };
                            }),
                          });
                          setDraft((d) => ({
                            ...d,
                            routes: d.routes.map((r) =>
                              r.templateId === template.id && r.event !== kind
                                ? { ...r, templateId: null, enabled: false }
                                : r,
                            ),
                          }));
                        }}
                      >
                        {smsEvents.map((k) => (
                          <option key={k} value={k}>
                            {smsEventLabels[k]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="اتصال">
                      <select
                        value={template.connectionId}
                        onChange={(e) =>
                          changeTemplate({ connectionId: e.target.value, approved: false })
                        }
                      >
                        {draft.connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} — {c.provider === 'smsIr' ? 'SMS.ir' : 'کاوه‌نگار'}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label={
                        draft.connections.find((c) => c.id === template.connectionId)?.provider ===
                        'kavenegar'
                          ? 'نام انگلیسی الگوی کاوه‌نگار'
                          : 'شناسهٔ عددی قالب SMS.ir'
                      }
                      required
                    >
                      <input
                        dir="ltr"
                        value={template.providerTemplate}
                        maxLength={100}
                        onChange={(e) =>
                          changeTemplate({ providerTemplate: e.target.value, approved: false })
                        }
                      />
                    </Field>
                  </div>
                  <Check
                    label="این قالب در پنل سرویس‌دهنده تأیید شده است"
                    checked={template.approved}
                    onChange={(e) => changeTemplate({ approved: e.target.checked })}
                  />
                  <div className="sms-section-heading">
                    <div>
                      <h4>متغیرهای قالب</h4>
                      <p>
                        در SMS.ir حداکثر ۲۵ نویسه؛ در کاوه‌نگار token/token2/token3 بدون فاصله‌اند و
                        token10/token20 برای عبارت چندکلمه‌ای هستند.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={template.parameters.length >= 10}
                      onClick={() =>
                        changeTemplate({
                          parameters: [
                            ...template.parameters,
                            { name: '', source: 'constant', constant: '' },
                          ],
                        })
                      }
                    >
                      <Plus size={15} /> متغیر
                    </button>
                  </div>
                  <div className="sms-parameters">
                    {template.parameters.map((p, index) => (
                      <div className="sms-parameter" key={index}>
                        <Field label={'نام پارامتر ' + (index + 1)} required>
                          <input
                            dir="ltr"
                            value={p.name}
                            maxLength={50}
                            placeholder="CODE / token"
                            onChange={(e) =>
                              changeTemplate({
                                parameters: template.parameters.map((x, i) =>
                                  i === index ? { ...x, name: e.target.value } : x,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label="دادهٔ جایگزین">
                          <select
                            value={p.source}
                            onChange={(e) =>
                              changeTemplate({
                                parameters: template.parameters.map((x, i) =>
                                  i === index
                                    ? {
                                        ...x,
                                        source: e.target.value as typeof p.source,
                                        constant: e.target.value === 'constant' ? '' : null,
                                      }
                                    : x,
                                ),
                              })
                            }
                          >
                            {smsAllowedSources(template.kind).map((s) => (
                              <option key={s} value={s}>
                                {smsSourceLabels[s]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {p.source === 'constant' && (
                          <Field label="مقدار ثابت" required>
                            <input
                              maxLength={100}
                              value={p.constant ?? ''}
                              onChange={(e) =>
                                changeTemplate({
                                  parameters: template.parameters.map((x, i) =>
                                    i === index ? { ...x, constant: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                          </Field>
                        )}
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={'حذف متغیر ' + (index + 1)}
                          disabled={template.parameters.length === 1}
                          onClick={() =>
                            changeTemplate({
                              parameters: template.parameters.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Field
                    label="متن برای پیش‌نمایش"
                    hint="متن تأییدشدهٔ سرویس را کپی کنید؛ در SMS.ir مانند #CODE# و در کاوه‌نگار مانند %token است. این متن در سرویس‌دهنده ذخیره نمی‌شود."
                  >
                    <textarea
                      rows={4}
                      maxLength={2000}
                      value={template.previewText}
                      onChange={(e) => changeTemplate({ previewText: e.target.value })}
                    />
                  </Field>
                  <div className="sms-preview" aria-label="پیش‌نمایش پیامک نمونه">
                    <small>پیش‌نمایش با دادهٔ نمونه</small>
                    <p>
                      {smsSamplePreview(
                        template,
                        draft.otp.genericName,
                        draft.otp.lifetimeSeconds,
                      ) || 'متن قالب را وارد کنید.'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="sms-empty">قالب دلخواه را انتخاب یا اضافه کنید.</div>
              )}
            </div>
          </div>
        )}
        {tab === 'login' && (
          <div className="sms-detail">
            <div className="sms-section-heading">
              <div>
                <h3>کد ورود مشتری</h3>
                <p>
                  تغییر قواعد یا مسیر OTP، کدهای در انتظار را باطل می‌کند؛ مشتری کد تازه می‌گیرد.
                </p>
              </div>
            </div>
            {route('otp')}
            <div className="sms-fields-grid sms-policy-grid">
              {(
                [
                  ['lifetimeSeconds', 'اعتبار کد (ثانیه)', 60, 600],
                  ['resendSeconds', 'فاصلهٔ ارسال مجدد (ثانیه)', 30, 300],
                  ['maxAttempts', 'سقف تلاش برای هر کد', 1, 10],
                  ['phoneHourlyLimit', 'سقف هر شماره در ساعت', 1, 20],
                  ['phoneDailyLimit', 'سقف هر شماره در ۲۴ ساعت', 1, 100],
                  ['globalHourlyLimit', 'سقف کل کدهای ورود در ساعت', 1, 10000],
                  ['globalDailyLimit', 'سقف کل کدهای ورود در ۲۴ ساعت', 1, 100000],
                ] as const
              ).map(([key, label, min, max]) => (
                <Field key={key} label={label} required>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={1}
                    value={draft.otp[key]}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, otp: { ...d.otp, [key]: Number(e.target.value) } }))
                    }
                  />
                </Field>
              ))}
              <Field
                label="نام عمومی مشتری در پیامک"
                required
                hint="برای کد ورود، اطلاعات حساب قبل از تأیید شماره افشا نمی‌شود."
              >
                <input
                  maxLength={25}
                  value={draft.otp.genericName}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, otp: { ...d.otp, genericName: e.target.value } }))
                  }
                />
              </Field>
            </div>
            <p className="sms-help-note">
              کد شش‌رقمی است. فاصلهٔ ارسال مجدد باید کمتر از اعتبار کد باشد؛ سقف روزانه کمتر از
              ساعتی نمی‌شود. مشتری بدون حساب پس از تأیید کد، حساب می‌سازد. خاموش‌کردن آخرین مسیر
              ورود مشتری مجاز نیست.
            </p>
          </div>
        )}
        {tab === 'notifications' && (
          <div className="sms-detail">
            <div className="sms-section-heading">
              <div>
                <h3>اعلان‌های فروش</h3>
                <p>
                  برای هر رویداد، قالب و اتصال مستقل انتخاب کنید. فعال‌سازی، پیام‌های گذشته را ارسال
                  نمی‌کند.
                </p>
              </div>
            </div>
            {smsEvents.filter((k) => k !== 'otp').map(route)}
            <div className="sms-fields-grid">
              {(
                [
                  ['notificationHourlyLimit', 'سقف کل اعلان‌ها در ساعت', 10000],
                  ['notificationDailyLimit', 'سقف کل اعلان‌ها در ۲۴ ساعت', 100000],
                ] as const
              ).map(([key, label, max]) => (
                <Field key={key} label={label} required>
                  <input
                    type="number"
                    min={1}
                    max={max}
                    step={1}
                    value={draft.otp[key]}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, otp: { ...d.otp, [key]: Number(e.target.value) } }))
                    }
                  />
                </Field>
              ))}
            </div>
            <p className="sms-help-note">
              این بودجه مستقل از کد ورود است و ارسال آزمایشی را هم شامل می‌شود. رکوردهای نمونه پیامک
              واقعی ندارند. شمارهٔ گیرنده باید متعلق به مشتری فعال و تأییدشده باشد. نتیجهٔ مبهم
              خودکار تکرار یا به سرویس دیگری منتقل نمی‌شود.
            </p>
          </div>
        )}
      </fieldset>
      <footer className="form-save-bar">
        <span>{dirty ? 'تغییرهای ذخیره‌نشده دارید' : 'تنظیمات با نسخهٔ ذخیره‌شده یکسان است'}</span>
        <button
          type="button"
          disabled={busy || blocked || !dirty}
          onClick={() => {
            clearSecrets();
            setDraft(structuredClone(initial));
            setActions({});
            setClearConfirmed({});
            setError(undefined);
          }}
        >
          انصراف از تغییرها
        </button>
        <button className="primary" type="submit" disabled={busy || blocked || !dirty}>
          <Save size={16} />
          {busy ? 'در حال ذخیره…' : 'ذخیرهٔ همهٔ تغییرها'}
        </button>
      </footer>
    </form>
  );
}

const states: Record<string, string> = {
  queued: 'در صف',
  dispatching: 'در حال ارسال',
  accepted: 'پذیرفته‌شده توسط سرویس',
  rejected: 'ردشده',
  unknown: 'نتیجه نامعلوم',
  skipped: 'ارسال نشد',
};
const reasons: Record<string, string> = {
  demo_record: 'رکورد نمونه',
  route_unavailable: 'مسیر خاموش، قدیمی یا آماده نیست',
  recipient_unavailable: 'شمارهٔ تأییدشده در دسترس نیست',
  notification_limit: 'سقف اعلان‌ها',
  payload_unavailable: 'دادهٔ پیام در دسترس نیست',
  interrupted: 'قطع ارتباط پس از شروع ارسال',
  None: '—',
  Uncertain: 'پاسخ قطعی دریافت نشد',
  RequestRejected: 'پارامترها یا قالب نامعتبر',
  CredentialsRejected: 'اعتبار کلید تأیید نشد',
  ProviderRejected: 'رد توسط سرویس',
  RateLimited: 'محدودیت سرویس',
};
function SmsDeliveryLog({ templates }: { templates: SmsTemplate[] }) {
  const [state, setState] = useState(''),
    [kind, setKind] = useState(''),
    [cursor, setCursor] = useState<string | null>(null);
  const revision = adminViewRevision();
  const query = useQuery({
    queryKey: ['admin', 'sms-messages', revision, state, kind, cursor],
    queryFn: async ({ signal }) => {
      const q = new URLSearchParams();
      if (state) q.set('state', state);
      if (kind) q.set('kind', kind);
      if (cursor) q.set('cursor', cursor);
      const raw = await api<unknown>('/admin/sms/messages' + (q.size ? '?' + q.toString() : ''), {
        signal,
      });
      if (signal.aborted || revision !== adminViewRevision())
        throw new Error('نشست تغییر کرده است.');
      return smsMessagesSchema.parse(raw);
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <section className="panel sms-log">
      <div className="sms-section-heading">
        <div>
          <h3>گزارش ارسال اعلان‌ها</h3>
          <p>
            فقط فراداده؛ شمارهٔ کامل، متن پیام و کلیدها در این فهرست نمایش داده نمی‌شوند. کدهای ورود
            در گزارش خصوصی هویت ثبت می‌شوند.
          </p>
        </div>
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw size={16} /> تازه‌سازی
        </button>
      </div>
      <div className="sms-log-filters">
        <Field label="وضعیت ارسال">
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setCursor(null);
            }}
          >
            <option value="">همهٔ وضعیت‌ها</option>
            {Object.entries(states).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="رویداد">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setCursor(null);
            }}
          >
            <option value="">همهٔ رویدادها</option>
            {smsEvents
              .filter((k) => k !== 'otp')
              .map((k) => (
                <option key={k} value={k}>
                  {smsEventLabels[k]}
                </option>
              ))}
            <option value="test">ارسال آزمایشی</option>
          </select>
        </Field>
      </div>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        <>
          <div className="sms-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رویداد</th>
                  <th>وضعیت</th>
                  <th>اتصال / قالب</th>
                  <th>زمان ثبت</th>
                  <th>توضیح</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((m) => (
                  <tr key={m.id}>
                    <td>{m.kind === 'test' ? 'آزمایشی' : smsEventLabels[m.kind]}</td>
                    <td>
                      <span className={'sms-status sms-status-' + m.state}>{states[m.state]}</span>
                    </td>
                    <td>
                      {m.connectionName ?? '—'}
                      <small>{m.templateName}</small>
                    </td>
                    <td>
                      <time dateTime={m.createdAt}>
                        {new Intl.DateTimeFormat('fa-IR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(new Date(m.createdAt))}
                      </time>
                    </td>
                    <td>
                      {m.reason ? (reasons[m.reason] ?? 'نتیجهٔ سرویس') : '—'}
                      {m.providerMessageId && (
                        <small>
                          شناسهٔ سرویس: <bdi>{m.providerMessageId}</bdi>
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {query.data?.items.length === 0 && (
              <p className="sms-empty">هنوز پیامی با این فیلتر ثبت نشده است.</p>
            )}
          </div>
          <div className="sms-log-paging">
            {cursor && (
              <button type="button" onClick={() => setCursor(null)}>
                ابتدای گزارش
              </button>
            )}
            {query.data?.nextCursor && (
              <button type="button" onClick={() => setCursor(query.data?.nextCursor ?? null)}>
                پیام‌های قدیمی‌تر
              </button>
            )}
          </div>
        </>
      )}
      <SmsExplicitTest templates={templates} />
    </section>
  );
}
function SmsExplicitTest({ templates }: { templates: SmsTemplate[] }) {
  const [open, setOpen] = useState(false),
    [templateId, setTemplateId] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [receipt, setReceipt] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const mobile = useRef<HTMLInputElement | null>(null),
    sending = useRef(false),
    alive = useRef(true),
    revision = useRef(adminViewRevision()).current;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function send() {
    if (
      sending.current ||
      !confirmed ||
      uncertain ||
      !alive.current ||
      revision !== adminViewRevision()
    )
      return;
    const input = {
      requestId: uid(),
      templateId,
      mobile: mobile.current?.value ?? '',
      confirmed: true,
    };
    if (!/^[a-f0-9]{32}$/.test(templateId) || !/^\+989[0-9]{9}$/.test(input.mobile)) {
      setError(new Error('شناسهٔ داخلی قالب و شماره به شکل +989… را بررسی کنید.'));
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const value = smsMessageSchema.parse(
        await api<unknown>('/admin/sms/messages/test', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
      if (alive.current && revision === adminViewRevision()) setReceipt(value.id);
    } catch (failure) {
      if (alive.current && revision === adminViewRevision()) {
        setError(failure);
        setUncertain(true);
      }
    } finally {
      sending.current = false;
      if (mobile.current) mobile.current.value = '';
      if (alive.current && revision === adminViewRevision()) setBusy(false);
    }
  }
  return (
    <details className="sms-test" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Send size={16} /> ارسال آزمایشی با هزینهٔ واقعی
      </summary>
      <p>
        قالب ذخیره‌شدهٔ موردنظر را انتخاب کنید. ارسال با دادهٔ نمونه و کد ثابت 123456 انجام می‌شود و
        هیچ اجازهٔ ورود ایجاد نمی‌کند. شماره را فقط اینجا وارد کنید.
      </p>
      <div className="sms-fields-grid">
        <Field label="قالب ذخیره‌شده">
          <select
            value={templateId}
            disabled={busy || uncertain || !!receipt}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">انتخاب قالب</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {smsEventLabels[t.kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="شمارهٔ گیرندهٔ آزمایش" hint="شکل نمونه: +989120000000">
          <input
            type="tel"
            dir="ltr"
            ref={mobile}
            autoComplete="off"
            disabled={busy || uncertain || !!receipt}
          />
        </Field>
      </div>
      <Check
        label="هزینهٔ پیامک واقعی و ارسال به این شماره را تأیید می‌کنم"
        checked={confirmed}
        disabled={busy || uncertain || !!receipt}
        onChange={(e) => setConfirmed(e.target.checked)}
      />
      <ErrorBox error={error} />
      {receipt ? (
        <p role="status">
          در صف ثبت شد. شناسه: <bdi>{receipt}</bdi>؛ نتیجه را با تازه‌سازی گزارش ببینید.
        </p>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={!confirmed || busy || uncertain}
          onClick={() => void send()}
        >
          {busy ? 'در حال ثبت…' : 'ثبت یک ارسال آزمایشی'}
        </button>
      )}
      {uncertain && (
        <p role="status">درخواست تکرار نشده است؛ گزارش را بازخوانی و نتیجه را بررسی کنید.</p>
      )}
    </details>
  );
}
