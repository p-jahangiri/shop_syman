import { AdminTable } from './admin-table';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, save, ApiError } from './api';
import { adminViewRevision } from './admin-view-authority';
import { Busy, ErrorBox, Field } from './ui';
import { MarketSourceFields } from './market-source-fields';
import {
  adminSourcesSchema,
  sourceInputSchema,
  sourceResultSchema,
  readSourceResult,
  type AdminSources,
  type SourceCommand,
  type SourceResult,
} from './market-sources-contract';
import {
  readSourceJournal,
  keepSourceCommand,
  finishSourceCommand,
  clearSourceJournal,
} from './market-source-journal';
import {
  marketHistorySchema,
  type MarketHistory,
} from '../../storefront/lib/market-sources-contract';
import type { MarketDetails } from './market-contract';

export function MarketSourcesManager({
  listingId,
  viewerId,
  writable,
  onSaved,
  onLock,
  onOpenListing,
}: {
  listingId: string;
  viewerId: string;
  writable: boolean;
  onSaved: () => void;
  onLock: (busy: boolean) => void;
  onOpenListing: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null | undefined>(() => {
      const stored = readSourceJournal(viewerId);
      return stored?.command.listingId === listingId ? stored.command.sourceId : undefined;
    }),
    [historyId, setHistoryId] = useState(''),
    [revision, setRevision] = useState(0),
    [receiptId, setReceiptId] = useState(''),
    [receiptError, setReceiptError] = useState<unknown>();
  const stored = readSourceJournal(viewerId);
  const query = useQuery({
    queryKey: ['admin', 'market-sources', viewerId, listingId, revision],
    queryFn: async ({ signal }) => {
      const value = adminSourcesSchema.parse(
        await api(`/admin/market/${encodeURIComponent(listingId)}/sources`, { signal }),
      );
      if (value.listingId !== listingId) throw Error('مدل پاسخ با انتخاب شما هم‌خوان نیست.');
      return value;
    },
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const refresh = () => {
    setRevision((v) => v + 1);
    onSaved();
  };
  async function receipt() {
    const authority = adminViewRevision();
    setReceiptError(undefined);
    try {
      const value = sourceResultSchema.parse(
        await api('/admin/market/source-commands/' + encodeURIComponent(receiptId)),
      );
      if (adminViewRevision() !== authority) return;
      setReceiptId(value.requestId);
      if (value.listingId !== listingId) {
        onOpenListing(value.listingId);
        return;
      }
      setReceiptError(
        new Error(`رسید پیدا شد؛ مدل و منبع را تازه کنید. شناسهٔ منبع: ${value.sourceId}`),
      );
      refresh();
    } catch (e) {
      if (adminViewRevision() === authority) setReceiptError(e);
    }
  }
  return (
    <section>
      <p>
        شناسهٔ بازار برای فایل گزارش منابع: <code dir="ltr">{listingId}</code>
      </p>
      <p className="notice">
        منبع اصلی، شناسهٔ مدل و سبد تأمین را حفظ می‌کند. حداکثر ۱۵ منبع تکمیلی، گزارش مستقل دارند؛
        قیمت مرجع قابل پرداخت و گزارش موجودی، ماندهٔ انبار سایمان نیست. هویت منبع تکمیلی پس از ثبت
        ثابت است.
      </p>
      {stored?.result === null && (
        <div className="notice" role="status">
          <p>یک فرمان هنوز نتیجهٔ قطعی ندارد. پیش از ثبت فرمان دیگر آن را پیگیری کنید.</p>
          <code dir="ltr">{stored.command.requestId}</code>
          <button
            onClick={() =>
              stored.command.listingId === listingId
                ? setEditing(stored.command.sourceId)
                : onOpenListing(stored.command.listingId)
            }
          >
            پیگیری همان فرمان
          </button>
        </div>
      )}
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        query.data && (
          <>
            <button onClick={refresh} disabled={query.isFetching}>
              دریافت منابع تازه
            </button>
            <div className="table-wrap" role="region" aria-label="منابع مدل بازار" tabIndex={0}>
              <AdminTable>
                <thead>
                  <tr>
                    <th>منبع</th>
                    <th>هویت</th>
                    <th>انتشار / گزارش</th>
                    <th>قیمت مرجع ریال</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.sources.map((source) => (
                    <tr key={source.id}>
                      <td>
                        {source.details.sourceNameFa}
                        <small>{source.details.sourceNameEn}</small>
                        {source.isPrimary && <small>منبع اصلی مدل</small>}
                        {source.details.isDemo && <small>دادهٔ نمونه</small>}
                      </td>
                      <td>
                        <bdi>
                          {source.details.sourceKey} / {source.details.sourceItemKey}
                        </bdi>
                      </td>
                      <td>
                        <bdi>
                          {source.details.status} / {source.details.availability}
                        </bdi>
                      </td>
                      <td>
                        {source.details.referencePriceRial === null ? (
                          'ثبت نشده'
                        ) : (
                          <bdi>
                            {BigInt(source.details.referencePriceRial).toLocaleString('fa-IR')}
                          </bdi>
                        )}
                      </td>
                      <td>
                        <button onClick={() => setHistoryId(source.id)}>تاریخچهٔ گزارش</button>
                        {writable && !source.isPrimary && (
                          <button
                            disabled={
                              !!stored && !stored.result && stored.command.sourceId !== source.id
                            }
                            onClick={() => setEditing(source.id)}
                          >
                            ویرایش گزارش
                          </button>
                        )}
                        {source.isPrimary && <small>ویرایش از فرم مدل و منبع اصلی</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            {writable && (
              <button
                className="primary"
                disabled={query.data.sources.length >= 16 || (!!stored && !stored.result)}
                onClick={() => setEditing(null)}
              >
                افزودن منبع تکمیلی
              </button>
            )}
            {editing !== undefined &&
              writable &&
              (!stored || stored.result || stored.command.listingId === listingId) && (
                <SourceEditor
                  key={`${listingId}:${editing ?? 'new'}:${query.data.listingVersion}`}
                  data={query.data}
                  sourceId={editing}
                  viewerId={viewerId}
                  onSaved={refresh}
                  onClose={() => {
                    setEditing(undefined);
                    refresh();
                  }}
                  onLock={onLock}
                />
              )}
          </>
        )
      )}
      {historyId && (
        <AdminSourceHistory
          key={listingId + historyId}
          listingId={listingId}
          sourceId={historyId}
        />
      )}
      <details className="panel">
        <summary>پیگیری با شناسهٔ فرمان پس از بازکردن دوبارهٔ تب</summary>
        <p>
          بدنهٔ فرمان فقط در حافظهٔ همین تب نگه داشته می‌شود. رسید را با حسابی بخوانید که فرمان را
          ارسال کرده است. پاسخ ۴۰۴ اثبات ناموفق‌بودن فرمان در حال اجرا نیست.
        </p>
        <Field label="شناسهٔ فرمان منبع">
          <input
            dir="ltr"
            value={receiptId}
            maxLength={36}
            onChange={(e) => setReceiptId(e.target.value)}
          />
        </Field>
        <button
          disabled={!writable || !sourceResultSchema.shape.requestId.safeParse(receiptId).success}
          onClick={() => void receipt()}
        >
          خواندن رسید ثبت
        </button>
        <ErrorBox error={receiptError} />
      </details>
    </section>
  );
}
function SourceEditor({
  data,
  sourceId,
  viewerId,
  onSaved,
  onClose,
  onLock,
}: {
  data: AdminSources;
  sourceId: string | null;
  viewerId: string;
  onSaved: () => void;
  onClose: () => void;
  onLock: (busy: boolean) => void;
}) {
  const stored = readSourceJournal(viewerId),
    previous = data.sources.find((x) => x.id === sourceId && !x.isPrimary);
  const own =
    stored?.command.listingId === data.listingId &&
    (sourceId === stored.command.sourceId || sourceId === null)
      ? stored
      : null;
  const [details, setDetails] = useState<MarketDetails>(
      own?.command.input.details ??
        previous?.details ?? {
          status: 'Draft',
          sourceKey: 'manual',
          sourceItemKey: crypto.randomUUID(),
          sourceNameFa: '',
          sourceNameEn: '',
          sourceUrl: null,
          availability: 'unknown',
          observedAt: null,
          validUntil: null,
          referencePriceRial: null,
          isDemo: data.sources.some((x) => x.isPrimary && x.details.isDemo),
        },
    ),
    [busy, setBusy] = useState(false),
    [command, setCommand] = useState<SourceCommand | null>(own?.command ?? null),
    [result, setResult] = useState<SourceResult | null>(own?.result ?? null),
    [error, setError] = useState<unknown>(),
    [blocked, setBlocked] = useState(false);
  const inFlight = useRef(false);
  async function execute(frozen: SourceCommand, readOnly = false) {
    if (inFlight.current) return;
    const authority = adminViewRevision();
    inFlight.current = true;
    setBusy(true);
    onLock(true);
    setError(undefined);
    try {
      const raw = readOnly
        ? await api('/admin/market/source-commands/' + frozen.requestId)
        : await save(
            `/admin/market/${frozen.listingId}/sources/${frozen.sourceId}/commands/${frozen.requestId}`,
            frozen.input,
            'PUT',
          );
      if (adminViewRevision() !== authority) return;
      const value = readSourceResult(raw, frozen);
      if (!finishSourceCommand(viewerId, frozen, value)) return;
      setResult(value);
      onSaved();
    } catch (e) {
      if (adminViewRevision() !== authority) return;
      setError(e);
      if (
        !readOnly &&
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 401 &&
        e.status !== 403
      ) {
        clearSourceJournal(viewerId);
        setCommand(null);
        setBlocked(true);
      }
    } finally {
      inFlight.current = false;
      if (adminViewRevision() === authority) {
        setBusy(false);
        onLock(false);
      }
    }
  }
  function submit() {
    try {
      const input = sourceInputSchema.parse({
        listingVersion: data.listingVersion,
        sourceVersion: previous?.version ?? null,
        details,
      });
      const frozen: SourceCommand = {
        listingId: data.listingId,
        sourceId: previous?.id ?? crypto.randomUUID().replaceAll('-', ''),
        requestId: crypto.randomUUID(),
        input,
      };
      keepSourceCommand(viewerId, frozen);
      setCommand(frozen);
      void execute(frozen);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="panel">
      <h3>{previous ? 'ویرایش منبع تکمیلی' : 'ثبت منبع تکمیلی'}</h3>
      <ErrorBox error={error} />
      {command && (
        <p>
          شناسهٔ پیگیری: <code dir="ltr">{command.requestId}</code>
        </p>
      )}
      {result ? (
        <div className="notice" role="status">
          <p>
            {result.replayed ? 'رسید ثبت قبلی بازیابی شد.' : 'گزارش منبع ثبت شد.'} تاریخچهٔ قبلی
            محفوظ است.
          </p>
          <button
            onClick={() => {
              clearSourceJournal(viewerId);
              onClose();
            }}
          >
            پایان و دریافت فهرست تازه
          </button>
        </div>
      ) : (
        <>
          {command && (
            <div className="notice" role="status">
              <p>
                فرمان و بدنه قفل‌اند. اگر پاسخ دریافت نشد، رسید را بخوانید یا همان فرمان را تکرار
                کنید؛ پاسخ ۴۰۴ به‌تنهایی نتیجهٔ فرمان را مشخص نمی‌کند.
              </p>
              <button disabled={busy} onClick={() => void execute(command, true)}>
                خواندن رسید همین فرمان
              </button>
              <button disabled={busy} onClick={() => void execute(command)}>
                تکرار دقیق همان فرمان
              </button>
            </div>
          )}
          <fieldset disabled={busy || !!command || blocked}>
            <MarketSourceFields details={details} onChange={setDetails} lockIdentity={!!previous} />
            <button className="primary" type="button" onClick={submit}>
              ثبت گزارش منبع
            </button>
          </fieldset>
          {blocked && (
            <p className="notice">
              ذخیره با خطای قطعی متوقف شد. اطلاعات تازه را دریافت و ویرایش را دوباره باز کنید.
            </p>
          )}
        </>
      )}
      <button disabled={busy} onClick={onClose}>
        بستن و بازخوانی
      </button>
    </div>
  );
}
function AdminSourceHistory({ listingId, sourceId }: { listingId: string; sourceId: string }) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const before = pages.at(-1)!;
  const history = useQuery<MarketHistory>({
    queryKey: ['admin', 'market-source-history', listingId, sourceId, before],
    queryFn: async ({ signal }) => {
      const value = marketHistorySchema.parse(
        await api(
          `/admin/market/${listingId}/sources/${sourceId}/history${before ? '?before=' + before : ''}`,
          { signal },
        ),
      );
      if (
        value.listingId !== listingId ||
        value.sourceId !== sourceId ||
        value.locale !== 'fa' ||
        (before && value.items.some((x) => BigInt(x.sequence) >= BigInt(before)))
      )
        throw Error('تاریخچه با منبع انتخابی هم‌خوان نیست.');
      return value;
    },
    gcTime: 0,
    retry: false,
  });
  return (
    <section className="panel">
      <h3>تاریخچهٔ گزارش منبع</h3>
      <ErrorBox error={history.error} />
      {history.isPending ? (
        <Busy />
      ) : (
        history.data && (
          <>
            <ol>
              {history.data.items.map((row) => (
                <li key={row.sequence}>
                  <p>
                    {new Intl.DateTimeFormat('fa-IR', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Tehran',
                    }).format(new Date(row.recordedAt))}{' '}
                    · {row.source.sourceName} ·{' '}
                    <bdi>
                      {row.source.referencePriceRial === null
                        ? 'بدون قیمت مرجع'
                        : BigInt(row.source.referencePriceRial).toLocaleString('fa-IR') + ' ریال'}
                    </bdi>
                  </p>
                  {row.origin === 'migrationBaseline' && (
                    <p className="notice">
                      نقطهٔ شروع ثبت تاریخچه هنگام ارتقای سامانه؛ سابقهٔ پیش از آن در دسترس نیست.
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {!history.data.items.length && <p>گزارشی در تاریخچه ثبت نشده است.</p>}
            <div className="pagination">
              <button
                disabled={pages.length === 1 || history.isFetching}
                onClick={() => setPages((v) => v.slice(0, -1))}
              >
                گزارش‌های جدیدتر
              </button>
              <button
                disabled={!history.data.nextBefore || history.isFetching}
                onClick={() => setPages((v) => [...v, history.data!.nextBefore])}
              >
                گزارش‌های قدیمی‌تر
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}
