import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { api } from './api';
import { adminViewRevision } from './admin-view-authority';
import { adminCreditRequirementsJournal as journal } from './credit-requirements-journal';
import { isCreditRequirementsPath } from '../../storefront/lib/credit-requirements-path';
import {
  creditRequirementsCurrentSchema,
  creditRequirementsHistorySchema,
  creditRequirementsRevisionSchema,
  publishCreditRequirementsSchema,
  creditRequirementsContentSchema,
  canonicalCreditRequirements,
  creditRequirementsCommandPath,
  creditDocumentContentTypes,
  type CreditRequirementsContent,
  type CreditRequirementsCurrent,
  type CreditRequirementsHistory,
  type CreditRequirementsRevision,
  type CreditRequirementsCommand,
} from '../../storefront/lib/credit-requirements-contract';
import { CreditRequirementsCopy } from '../../storefront/components/credit-consent-panel';

type Draft = { version: string | null; content: CreditRequirementsContent };
type TextField = Exclude<keyof CreditRequirementsContent, 'enabled' | 'documents'>;
const empty = (): CreditRequirementsContent => ({
  titleFa: '',
  titleEn: '',
  termsFa: '',
  termsEn: '',
  consentLabelFa: '',
  consentLabelEn: '',
  enabled: false,
  documents: [],
});
const fields: {
  key: TextField;
  label: string;
  maximum: number;
  dir: 'rtl' | 'ltr';
  area?: boolean;
}[] = [
  { key: 'titleFa', label: 'عنوان فارسی', maximum: 160, dir: 'rtl' },
  { key: 'titleEn', label: 'عنوان انگلیسی', maximum: 160, dir: 'ltr' },
  { key: 'termsFa', label: 'شرایط درخواست — فارسی', maximum: 4000, dir: 'rtl', area: true },
  { key: 'termsEn', label: 'شرایط درخواست — انگلیسی', maximum: 4000, dir: 'ltr', area: true },
  {
    key: 'consentLabelFa',
    label: 'متن تأیید کنار گزینهٔ رضایت — فارسی',
    maximum: 500,
    dir: 'rtl',
    area: true,
  },
  {
    key: 'consentLabelEn',
    label: 'متن تأیید کنار گزینهٔ رضایت — انگلیسی',
    maximum: 500,
    dir: 'ltr',
    area: true,
  },
];
export function CreditRequirementsPage({
  viewerId,
  writable,
}: {
  viewerId: string;
  writable: boolean;
}) {
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    ),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  const [current, setCurrent] = useState<CreditRequirementsCurrent | null>(null),
    [history, setHistory] = useState<CreditRequirementsHistory | null>(null),
    [draft, setDraft] = useState<Draft | null>(() => {
      const e = journal.snapshot(viewerId);
      return e?.command.kind === 'publish' ? structuredClone(e.command.body) : null;
    }),
    [dirty, setDirty] = useState(false),
    [invalid, setInvalid] = useState(false),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [historyBusy, setHistoryBusy] = useState(false),
    [selected, setSelected] = useState<CreditRequirementsRevision | null>(null),
    [revisionBusy, setRevisionBusy] = useState(false),
    [revisionFailed, setRevisionFailed] = useState(false),
    [previewLocale, setPreviewLocale] = useState<'fa' | 'en'>('fa');
  const generation = useRef(0),
    revisionGeneration = useRef(0),
    abort = useRef<AbortController | null>(null),
    revisionAbort = useRef<AbortController | null>(null);
  const transport = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!isCreditRequirementsPath(path, init.method ?? 'GET', true))
      throw Error('Invalid credit requirements path');
    const authority = adminViewRevision(),
      value = await api<unknown>(path.slice(4), init);
    if (authority !== adminViewRevision()) throw Error('Requirements authorization changed');
    return value;
  }, []);
  useEffect(() => () => journal.interrupt(), []);
  useEffect(() => {
    if (
      entry?.state === 'done' &&
      entry.command.kind === 'publish' &&
      entry.result &&
      'current' in entry.result &&
      entry.result.current.published
    ) {
      setDraft({
        version: entry.result.current.version,
        content: structuredClone(entry.result.current.published.content),
      });
      setDirty(false);
      setInvalid(false);
      setRefresh((n) => n + 1);
    }
  }, [entry]);
  const invalidateCurrentRequest = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    const serial = ++generation.current,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setFailed(false);
    void Promise.all([
      transport('/api/admin/credit/requirements', { signal: controller.signal }),
      transport('/api/admin/credit/requirements/history', { signal: controller.signal }),
    ])
      .then(([raw, rows]) => {
        const value = creditRequirementsCurrentSchema.parse(raw),
          page = creditRequirementsHistorySchema.parse(rows);
        if (serial !== generation.current || controller.signal.aborted) return;
        setCurrent(value);
        setHistory(page);
        setDraft(
          (old) =>
            old ?? {
              version: value.version,
              content: structuredClone(value.published?.content ?? empty()),
            },
        );
      })
      .catch(() => {
        if (serial === generation.current && !controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (serial === generation.current && !controller.signal.aborted) setBusy(false);
      });
    return () => {
      invalidateCurrentRequest();
      controller.abort();
    };
  }, [viewerId, refresh, transport, invalidateCurrentRequest]);
  useEffect(() => {
    if (!dirty && !unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, unresolved]);
  useEffect(
    () => () => {
      revisionGeneration.current++;
      revisionAbort.current?.abort();
    },
    [],
  );
  async function more() {
    if (!history?.nextCursor || historyBusy || unresolved) return;
    const serial = generation.current;
    setHistoryBusy(true);
    try {
      const page = creditRequirementsHistorySchema.parse(
        await transport(
          '/api/admin/credit/requirements/history?cursor=' + encodeURIComponent(history.nextCursor),
          { signal: abort.current?.signal },
        ),
      );
      if (serial !== generation.current) return;
      const items = [...history.items, ...page.items];
      if (new Set(items.map((x) => x.id)).size !== items.length) throw Error('Duplicate revision');
      setHistory({ ...page, items });
    } catch {
      if (serial === generation.current) setFailed(true);
    } finally {
      if (serial === generation.current) setHistoryBusy(false);
    }
  }
  async function view(id: string) {
    const serial = ++revisionGeneration.current;
    revisionAbort.current?.abort();
    const controller = new AbortController();
    revisionAbort.current = controller;
    setRevisionBusy(true);
    setRevisionFailed(false);
    setSelected(null);
    try {
      const value = creditRequirementsRevisionSchema.parse(
        await transport('/api/admin/credit/requirements/revisions/' + id, {
          signal: controller.signal,
        }),
      );
      if (value.id !== id) throw Error('Wrong revision');
      if (serial === revisionGeneration.current && !controller.signal.aborted) setSelected(value);
    } catch {
      if (serial === revisionGeneration.current && !controller.signal.aborted)
        setRevisionFailed(true);
    } finally {
      if (serial === revisionGeneration.current && !controller.signal.aborted)
        setRevisionBusy(false);
    }
  }
  function update<K extends keyof CreditRequirementsContent>(
    key: K,
    value: CreditRequirementsContent[K],
  ) {
    if (!writable || unresolved) return;
    setDraft((d) => (d ? { ...d, content: { ...d.content, [key]: value } } : d));
    setDirty(true);
    setInvalid(false);
  }
  function document(index: number, patch: Partial<CreditRequirementsContent['documents'][number]>) {
    if (!draft) return;
    update(
      'documents',
      draft.content.documents.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }
  function move(index: number, delta: number) {
    if (!draft) return;
    const rows = [...draft.content.documents],
      other = index + delta;
    if (other < 0 || other >= rows.length) return;
    [rows[index], rows[other]] = [rows[other], rows[index]];
    update('documents', rows);
  }
  function load(content: CreditRequirementsContent) {
    if (!writable || unresolved || !current) return;
    setDraft({ version: current.version, content: structuredClone(content) });
    setDirty(true);
    setInvalid(false);
  }
  async function send(command: CreditRequirementsCommand, retry = false) {
    if (!writable || command.kind !== 'publish') return;
    let started = false;
    try {
      if (retry) journal.retry(viewerId);
      else journal.begin(viewerId, command);
      started = true;
      journal.finish(
        viewerId,
        command,
        await transport(creditRequirementsCommandPath(command), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command.body),
        }),
      );
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(viewerId, command, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  async function receipt() {
    if (!writable || entry?.state !== 'unknown') return;
    let command: CreditRequirementsCommand | undefined;
    try {
      command = journal.retry(viewerId);
      journal.finish(viewerId, command, await transport(creditRequirementsCommandPath(command)));
    } catch (error) {
      if (command) {
        const e = error as { status?: number; code?: string };
        journal.fail(viewerId, command, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  function publish(e: FormEvent) {
    e.preventDefault();
    if (!writable || unresolved || busy || failed || !draft || draft.version !== current?.version)
      return;
    const result = publishCreditRequirementsSchema.safeParse(draft);
    if (!result.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void send({
      kind: 'publish',
      id: crypto.randomUUID().replaceAll('-', ''),
      body: {
        version: result.data.version,
        content: canonicalCreditRequirements(result.data.content),
      },
    });
  }
  const preview = draft ? creditRequirementsContentSchema.safeParse(draft.content) : null;
  return (
    <div className="ticket-workspace">
      <p className="credit-workspace-notice">
        شرایط درخواست و مدارک را بدون تغییر طرح‌های مالی تنظیم کنید. هر انتشار نسخهٔ تازه‌ای
        می‌سازد؛ رضایت مشتری به همان نسخه و زبان متصل است. انتشار شرایط، تأیید اعتبار یا ثبت سفارش
        ایجاد نمی‌کند.
      </p>
      <section className="ticket-panel">
        <div className="ticket-heading">
          <h2>شرایط منتشرشده</h2>
          <button
            type="button"
            disabled={busy || unresolved}
            onClick={() => setRefresh((n) => n + 1)}
          >
            دریافت وضعیت تازه
          </button>
        </div>
        {busy && !current && <p role="status">در حال دریافت…</p>}
        {failed && <p role="alert">شرایط یا تاریخچه خوانده نشد؛ دوباره دریافت کنید.</p>}
        {current && !current.published && (
          <p>هنوز شرایطی منتشر نشده است. متن یا مدرک پیش‌فرضی به مشتری نمایش داده نمی‌شود.</p>
        )}
        {current?.published && (
          <div className="credit-rule-current">
            <strong>{current.published.content.titleFa}</strong>
            <p>
              {current.published.content.enabled
                ? 'پذیرش رضایت فعال است.'
                : 'پذیرش رضایت غیرفعال است.'}
            </p>
            <p>
              شناسهٔ نسخه: <bdi>{current.published.id}</bdi>
            </p>
            <button
              type="button"
              disabled={revisionBusy || unresolved}
              onClick={() => void view(current.published!.id)}
            >
              مشاهدهٔ متن جاری
            </button>
            {writable && (
              <button
                type="button"
                disabled={unresolved}
                onClick={() => load(current.published!.content)}
              >
                بارگذاری نسخهٔ جاری در فرم
              </button>
            )}
          </div>
        )}
        <h3>تاریخچهٔ انتشار</h3>
        {history?.items.length === 0 && <p>تاریخچه‌ای وجود ندارد.</p>}
        <ul className="credit-rule-history">
          {history?.items.map((row) => (
            <li key={row.id}>
              <strong>{row.titleFa}</strong>
              <p>
                {new Intl.DateTimeFormat('fa-IR', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Tehran',
                }).format(new Date(row.createdAt))}{' '}
                · {row.documentCount.toLocaleString('fa-IR')} تعریف مدرک
              </p>
              <button
                type="button"
                disabled={revisionBusy || unresolved}
                onClick={() => void view(row.id)}
              >
                مشاهدهٔ نسخه <bdi>{row.id.slice(0, 8)}</bdi>
              </button>
            </li>
          ))}
        </ul>
        {history?.nextCursor && (
          <button
            type="button"
            disabled={historyBusy || busy || unresolved}
            onClick={() => void more()}
          >
            ۵۰ نسخهٔ بعدی
          </button>
        )}
        {revisionBusy && <p role="status">در حال دریافت نسخه…</p>}
        {revisionFailed && <p role="alert">نسخه خوانده نشد؛ دوباره انتخاب کنید.</p>}
        {selected && (
          <>
            <h3>متن نسخهٔ انتخاب‌شده</h3>
            <p>
              <bdi>{selected.id}</bdi>
            </p>
            <CreditRequirementsCopy content={selected.content} locale={previewLocale} />
            {writable && (
              <button
                type="button"
                disabled={unresolved || busy || failed}
                onClick={() => load(selected.content)}
              >
                استفاده از این متن برای انتشار نسخهٔ تازه
              </button>
            )}
          </>
        )}
      </section>
      <section className="ticket-panel">
        <div className="ticket-heading">
          <h2>{writable ? 'فرم انتشار نسخهٔ تازه' : 'پیش‌نمایش شرایط'}</h2>
          <button type="button" onClick={() => setPreviewLocale((l) => (l === 'fa' ? 'en' : 'fa'))}>
            {previewLocale === 'fa' ? 'English preview' : 'پیش‌نمایش فارسی'}
          </button>
        </div>
        {entry && (
          <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
            <strong>
              {entry.state === 'done'
                ? 'نسخهٔ مشخص منتشر شد'
                : entry.state === 'rejected'
                  ? 'انتشار پذیرفته نشد؛ قالب، حجم متن و نسخهٔ جاری را بررسی کنید.'
                  : 'نتیجهٔ انتشار هنوز مشخص نیست'}
            </strong>
            <p>
              شناسهٔ پیگیری: <bdi>{entry.command.id}</bdi>
            </p>
            {entry.state === 'unknown' ? (
              <div className="ticket-actions">
                <button type="button" disabled={!writable} onClick={() => void receipt()}>
                  بررسی رسید انتشار
                </button>
                <button
                  type="button"
                  disabled={!writable}
                  onClick={() => void send(entry.command, true)}
                >
                  تلاش دوبارهٔ همان انتشار
                </button>
              </div>
            ) : entry.state === 'pending' ? (
              <p>در حال ثبت…</p>
            ) : (
              <button type="button" onClick={() => journal.clear(viewerId)}>
                بستن نتیجه
              </button>
            )}
          </div>
        )}
        {!writable && (
          <p>
            دسترسی شما به شرایط فقط خواندنی است؛ برای مشاهدهٔ متن، نسخه‌ای را از تاریخچه انتخاب
            کنید.
          </p>
        )}
        {writable && draft && (
          <form onSubmit={publish}>
            <p>
              ویرایش فرم تا انتخاب «انتشار نسخهٔ تازه» اثری بر شرایط مشتری ندارد. متن حقوقی و فهرست
              مدارک را مطابق رویهٔ واقعی فروشگاه وارد کنید.
            </p>
            {draft.version !== current?.version && (
              <p role="alert">
                نسخهٔ منتشرشده تغییر کرده است. نسخهٔ جاری را در فرم بارگذاری و تغییرات را دوباره
                بررسی کنید.
              </p>
            )}
            <div className="credit-rule-grid">
              {fields.map((field) => (
                <label className="ticket-field" key={field.key}>
                  <span>{field.label}</span>
                  {field.area ? (
                    <textarea
                      dir={field.dir}
                      maxLength={field.maximum}
                      required
                      value={draft.content[field.key]}
                      disabled={unresolved}
                      onChange={(e) => update(field.key, e.target.value)}
                    />
                  ) : (
                    <input
                      dir={field.dir}
                      maxLength={field.maximum}
                      required
                      value={draft.content[field.key]}
                      disabled={unresolved}
                      onChange={(e) => update(field.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            <label className="credit-check">
              <input
                type="checkbox"
                checked={draft.content.enabled}
                disabled={unresolved}
                onChange={(e) => update('enabled', e.target.checked)}
              />
              <span>پذیرش رضایت به این نسخه فعال باشد</span>
            </label>
            <h3>مدارک موردنیاز این نسخه</h3>
            {draft.content.documents.length === 0 && (
              <p>مدرکی تعریف نشده است. اگر مدرکی لازم دارید، پیش از انتشار اضافه کنید.</p>
            )}
            {draft.content.documents.map((d, index) => (
              <section className="credit-rule-document" key={d.key}>
                <div className="ticket-heading">
                  <h4>مدرک {(index + 1).toLocaleString('fa-IR')}</h4>
                  <div className="ticket-actions">
                    <button
                      type="button"
                      disabled={unresolved || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      بالاتر
                    </button>
                    <button
                      type="button"
                      disabled={unresolved || index === draft.content.documents.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      پایین‌تر
                    </button>
                    <button
                      type="button"
                      disabled={unresolved}
                      onClick={() =>
                        update(
                          'documents',
                          draft.content.documents.filter((_, i) => i !== index),
                        )
                      }
                    >
                      حذف از این پیش‌نویس
                    </button>
                  </div>
                </div>
                <div className="credit-rule-grid">
                  {(
                    [
                      { key: 'nameFa', label: 'نام مدرک — فارسی', maximum: 120, dir: 'rtl' },
                      { key: 'nameEn', label: 'نام مدرک — انگلیسی', maximum: 120, dir: 'ltr' },
                      { key: 'helpFa', label: 'راهنما — فارسی', maximum: 300, dir: 'rtl' },
                      { key: 'helpEn', label: 'راهنما — انگلیسی', maximum: 300, dir: 'ltr' },
                    ] as const
                  ).map((f) => (
                    <label className="ticket-field" key={f.key}>
                      <span>{f.label}</span>
                      <input
                        dir={f.dir}
                        required={f.key === 'nameFa' || f.key === 'nameEn'}
                        maxLength={f.maximum}
                        value={d[f.key]}
                        disabled={unresolved}
                        onChange={(e) => document(index, { [f.key]: e.target.value })}
                      />
                    </label>
                  ))}
                  <label className="ticket-field">
                    <span>سقف حجم فایل — بایت، حداکثر ۸٬۳۸۸٬۶۰۸</span>
                    <input
                      type="number"
                      min={1}
                      max={8388608}
                      step={1}
                      value={d.maxBytes}
                      disabled={unresolved}
                      required
                      onChange={(e) => document(index, { maxBytes: e.target.valueAsNumber || 0 })}
                    />
                  </label>
                </div>
                <label className="credit-check">
                  <input
                    type="checkbox"
                    checked={d.required}
                    disabled={unresolved}
                    onChange={(e) => document(index, { required: e.target.checked })}
                  />
                  <span>ارائهٔ این مدرک الزامی باشد</span>
                </label>
                <fieldset>
                  <legend>فرمت‌های مجاز — دست‌کم یکی را انتخاب کنید</legend>
                  {creditDocumentContentTypes.map((type) => (
                    <label className="credit-check" key={type}>
                      <input
                        type="checkbox"
                        checked={d.contentTypes.includes(type)}
                        disabled={unresolved}
                        onChange={(e) =>
                          document(index, {
                            contentTypes: e.target.checked
                              ? [...d.contentTypes, type]
                              : d.contentTypes.filter((t) => t !== type),
                          })
                        }
                      />
                      <span>
                        {type === 'application/pdf' ? 'PDF' : type.slice(6).toUpperCase()}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </section>
            ))}
            <button
              type="button"
              disabled={unresolved || draft.content.documents.length >= 12}
              onClick={() =>
                update('documents', [
                  ...draft.content.documents,
                  {
                    key: 'doc_' + crypto.randomUUID().replaceAll('-', ''),
                    nameFa: '',
                    nameEn: '',
                    helpFa: '',
                    helpEn: '',
                    required: false,
                    maxBytes: 8388608,
                    contentTypes: [],
                  },
                ])
              }
            >
              افزودن تعریف مدرک
            </button>
            {invalid && (
              <p role="alert">
                عنوان، شرایط، متن رضایت و نام مدارک در هر دو زبان، حجم معتبر و دست‌کم یک فرمت مجاز
                برای هر مدرک لازم است.
              </p>
            )}
            <div className="ticket-actions">
              <button
                type="submit"
                disabled={unresolved || busy || failed || draft.version !== current?.version}
              >
                انتشار نسخهٔ تازه
              </button>
            </div>
            <details>
              <summary>پیش‌نمایش دقیق متن فرم — هنوز منتشر نشده</summary>
              {preview?.success ? (
                <CreditRequirementsCopy content={preview.data} locale={previewLocale} />
              ) : (
                <p>برای پیش‌نمایش، همهٔ فیلدهای الزامی و فرمت مدارک را تکمیل کنید.</p>
              )}
            </details>
          </form>
        )}
      </section>
    </div>
  );
}
