import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clipboard, History, RefreshCw } from 'lucide-react';
import { api } from '../../api/api';
import {
  auditActionLabel,
  auditPage,
  auditResourceLabel,
  emptyAuditFilters,
  type AuditEvent,
  type AuditFilters,
} from '../../api/contracts/audit/audit-contract';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { PersianDateField } from '../../components/forms/persian-date-field';
import { dateFieldValue } from '../../utils/persian-date-contract';
import { Busy, ErrorBox, Field, Modal } from '../../components/ui';
import '../../styles/audit/audit.css';

const date = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'long',
  timeZone: 'Asia/Tehran',
});
const number = new Intl.NumberFormat('fa-IR');
const textFilters = [
  ['actor', 'شناسهٔ دقیق عامل', 450],
  ['action', 'ابتدای کد عملیات', 100],
  ['resource', 'ابتدای مسیر ثبت‌شده', 500],
  ['trace', 'شناسهٔ دقیق پیگیری', 100],
] as const;

export default function AuditPage() {
  const [draft, setDraft] = useState<AuditFilters>(emptyAuditFilters);
  const [filters, setFilters] = useState<AuditFilters>(emptyAuditFilters);
  const [cursors, setCursors] = useState<string[]>(['']);
  const [filterError, setFilterError] = useState('');
  const [selected, setSelected] = useState<AuditEvent>();
  const [copied, setCopied] = useState('');
  const cursor = cursors.at(-1) ?? '';
  const query = useQuery({
    queryKey: ['admin', 'audit-events', filters, cursor],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...filters, cursor })) {
        if (value) params.set(key, value);
      }
      return auditPage.parse(await api('/admin/audit/events?' + params, { signal }));
    },
  });
  const applied = [
    filters.q && 'جست‌وجو: ' + filters.q,
    ...textFilters.map(([key, title]) => filters[key] && title + ': ' + filters[key]),
    filters.from && 'از ' + date.format(new Date(filters.from)),
    filters.before && 'پیش از ' + date.format(new Date(filters.before)),
  ].filter(Boolean);

  function apply(next: AuditFilters) {
    setFilters(next);
    setCursors(['']);
    setFilterError('');
  }
  function submit() {
    const from = dateFieldValue(draft.from, 'utc');
    const before = dateFieldValue(draft.before, 'utc');
    if ((draft.from && !from) || (draft.before && !before) || (from && before && from >= before)) {
      setFilterError('زمان شروع و پایان را بررسی کنید. پایان باید پس از شروع باشد.');
      return;
    }
    apply({
      q: draft.q.trim(),
      actor: draft.actor.trim(),
      action: draft.action.trim(),
      resource: draft.resource.trim(),
      trace: draft.trace.trim(),
      from: from?.toISOString() ?? '',
      before: before?.toISOString() ?? '',
    });
  }
  async function copyTrace(trace: string) {
    try {
      await navigator.clipboard.writeText(trace);
      setCopied('شناسهٔ پیگیری کپی شد.');
    } catch {
      setCopied('کپی خودکار در دسترس نیست. شناسه را از متن انتخاب کنید.');
    }
  }
  function followTrace(trace: string) {
    const next = { ...emptyAuditFilters, trace };
    setDraft(next);
    apply(next);
    setSelected(undefined);
  }

  return (
    <section className="panel audit-workspace" aria-labelledby="audit-workspace-title">
      <div className="section-heading">
        <div>
          <h2 id="audit-workspace-title">
            <History size={22} aria-hidden="true" /> سابقهٔ عملیات
          </h2>
          <p>عملیات را بر اساس حساب، مسیر، بازهٔ زمانی یا شناسهٔ پیگیری پیدا کنید.</p>
        </div>
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw size={16} aria-hidden="true" /> تازه‌سازی
        </button>
      </div>
      <AdminFilterForm
        label="جست‌وجو در کل سابقه"
        live={false}
        search={
          <input
            type="search"
            aria-label="جست‌وجو در کل سابقه"
            placeholder="نام همکار، مسیر یا کد عملیات"
            value={draft.q}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        }
        actions={
          <>
            <button type="submit" className="primary">
              اعمال فیلتر
            </button>
            {applied.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setDraft(emptyAuditFilters);
                  apply(emptyAuditFilters);
                }}
              >
                پاک‌کردن فیلترها
              </button>
            )}
          </>
        }
        applied={applied}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {textFilters.map(([key, label, maxLength]) => (
          <Field key={key} label={label}>
            <input
              dir="ltr"
              value={draft[key]}
              maxLength={maxLength}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </Field>
        ))}
        <PersianDateField
          label="از زمان"
          value={draft.from}
          encoding="utc"
          precision="minute"
          onChange={(from) => setDraft((value) => ({ ...value, from }))}
        />
        <PersianDateField
          label="پیش از زمان"
          value={draft.before}
          encoding="utc"
          precision="minute"
          onChange={(before) => setDraft((value) => ({ ...value, before }))}
        />
      </AdminFilterForm>
      {filterError && (
        <p className="notice" role="alert">
          {filterError}
        </p>
      )}
      <ErrorBox error={query.error} />
      {query.isPending && <Busy />}
      {query.data?.items.length === 0 && <p className="empty">با این فیلترها رویدادی پیدا نشد.</p>}
      {!!query.data?.items.length && (
        <table className="audit-events" role="table" aria-label="رویدادهای ثبت‌شده">
          <thead>
            <tr role="row">
              <th scope="col" role="columnheader">
                عملیات
              </th>
              <th scope="col" role="columnheader">
                عامل
              </th>
              <th scope="col" role="columnheader">
                زمان تهران
              </th>
              <th scope="col" role="columnheader">
                جزییات
              </th>
            </tr>
          </thead>
          <tbody>
            {query.data.items.map((event) => (
              <tr key={event.id} role="row">
                <td>
                  <span className="audit-area">{auditResourceLabel(event.resource)}</span>
                  <strong>{auditActionLabel(event.action)}</strong>
                  <code dir="ltr" title={event.resource}>
                    {event.resource}
                  </code>
                </td>
                <td>
                  <bdi>{event.staffDisplayName || event.actorId || 'نامشخص'}</bdi>
                </td>
                <td>
                  <time dateTime={event.at}>{date.format(new Date(event.at))}</time>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(event);
                      setCopied('');
                    }}
                    aria-label={`جزئیات رویداد ${number.format(BigInt(event.id))}`}
                  >
                    جزئیات <ArrowLeft size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {query.data && (cursors.length > 1 || query.data.nextCursor) && (
        <nav className="audit-pagination" aria-label="صفحه‌بندی سابقهٔ عملیات">
          <button
            type="button"
            disabled={cursors.length === 1}
            onClick={() => setCursors((value) => value.slice(0, -1))}
          >
            قبلی
          </button>
          <span>صفحهٔ {number.format(cursors.length)}</span>
          <button
            type="button"
            disabled={!query.data.nextCursor}
            onClick={() => {
              const next = query.data.nextCursor;
              if (next) setCursors((value) => (value.at(-1) === next ? value : [...value, next]));
            }}
          >
            بعدی
          </button>
        </nav>
      )}
      {selected && (
        <Modal title={auditActionLabel(selected.action)} onClose={() => setSelected(undefined)}>
          <dl className="audit-detail">
            <dt>حوزه</dt>
            <dd>{auditResourceLabel(selected.resource)}</dd>
            <dt>شمارهٔ رویداد</dt>
            <dd>
              <bdi>{number.format(BigInt(selected.id))}</bdi>
            </dd>
            <dt>زمان ثبت در تهران</dt>
            <dd>
              <time dateTime={selected.at}>{date.format(new Date(selected.at))}</time>
            </dd>
            <dt>زمان ثبت (UTC)</dt>
            <dd>
              <code dir="ltr">{selected.at}</code>
            </dd>
            <dt>عامل ثبت</dt>
            <dd>
              {selected.staffDisplayName && (
                <span>{selected.staffDisplayName} · نام فعلی حساب</span>
              )}
              <code dir="ltr">{selected.actorId || '—'}</code>
            </dd>
            <dt>کد عملیات</dt>
            <dd>
              <code dir="ltr">{selected.action}</code>
            </dd>
            {selected.staffTargetId && (
              <>
                <dt>همکار مربوط به رویداد</dt>
                <dd>
                  {selected.staffTargetDisplayName && (
                    <span>{selected.staffTargetDisplayName} · نام فعلی حساب</span>
                  )}
                  <code dir="ltr">{selected.staffTargetId}</code>
                </dd>
              </>
            )}
            <dt>مسیر یا مرجع رکورد</dt>
            <dd>
              <code dir="ltr">{selected.resource || '—'}</code>
            </dd>
            <dt>شناسهٔ پیگیری</dt>
            <dd>
              <code dir="ltr">{selected.traceId || '—'}</code>
            </dd>
          </dl>
          {selected.traceId && (
            <div className="row-buttons audit-detail-actions">
              <button
                type="button"
                className="primary"
                onClick={() => followTrace(selected.traceId)}
              >
                رویدادهای همین درخواست
              </button>
              <button type="button" onClick={() => void copyTrace(selected.traceId)}>
                <Clipboard size={16} aria-hidden="true" /> کپی شناسه
              </button>
            </div>
          )}
          {copied && <p role="status">{copied}</p>}
        </Modal>
      )}
    </section>
  );
}
