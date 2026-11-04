import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, save } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { Text } from '../../components/forms/forms';
import { AccountingReconciliationView } from './accounting-reconciliation';
import type { HolooSource } from '../../api/contracts/accounting/accounting-reconciliation-contract';
import {
  accountingImportDetailSchema,
  accountingImportInputSchema,
  accountingImportPageSchema,
  accountingImportRecoveryMatches,
  accountingImportSavedSchema,
  parseAccountingCsv,
  type AccountingImportInput,
  type AccountingImportDetail,
  accountingImportIssues,
} from '../../api/contracts/accounting/accounting-import-contract';
const base = '/admin/accounting/holoo/imports';
const header = 'externalItemId,externalCode,externalName,externalUnitKey,quantityRaw,priceRaw';
const issueText: Record<(typeof accountingImportIssues)[number], string> = {
  quantity_missing: 'تعداد مشخص نیست',
  quantity_not_supported_integer:
    'مقدار خام، تعداد صحیحِ واحد فروش نیست؛ نسبت تبدیل را در تطبیق انبار بررسی کنید',
  available_quantity_requires_reconciliation: 'موجودی قابل فروش نیازمند تطبیق تعهدات است',
  quantity_meaning_unknown: 'معنای مانده مشخص نیست',
  price_missing: 'قیمت مشخص نیست',
  price_currency_unknown: 'واحد پول مشخص نیست',
  price_not_supported_integer: 'قیمت، عدد صحیح قابل تبدیل نیست',
  unit_mapping_required: 'نگاشت واحد در بررسی اولیهٔ قالب ارزیابی نشده است',
  warehouse_mapping_required: 'نگاشت انبار در بررسی اولیهٔ قالب ارزیابی نشده است',
  apply_not_available: 'فایل خودکار اعمال نمی‌شود؛ تأیید دستی و مجوز انبار لازم است',
  item_mapping_required: 'شناسهٔ کالا به SKU فعال وصل نیست',
  mapped_sku_not_eligible: 'SKU متصل، فعال و فیزیکی نیست',
};
const amount = (v: string | null) =>
  v === null ? 'نامشخص' : BigInt(v).toLocaleString('fa-IR') + ' ریال';
const date = (v: string) => new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });

function ImportForm({
  source,
  onClose,
  onSaved,
  onLock,
}: {
  source?: HolooSource;
  onClose: () => void;
  onSaved: (id: string) => void;
  onLock: (value: boolean) => void;
}) {
  const [id] = useState(() => crypto.randomUUID().replaceAll('-', ''));
  const [company, setCompany] = useState(source?.companyKey ?? ''),
    [warehouse, setWarehouse] = useState(source?.externalWarehouseKey ?? ''),
    [observedAt, setObservedAt] = useState(''),
    [meaning, setMeaning] = useState<AccountingImportInput['quantityMeaning']>('unknown'),
    [currency, setCurrency] = useState<AccountingImportInput['priceCurrency']>('unknown'),
    [demo, setDemo] = useState(false),
    [csv, setCsv] = useState(header + '\n');
  const [preview, setPreview] = useState<ReturnType<typeof parseAccountingCsv> | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [frozen, setFrozen] = useState<AccountingImportInput | null>(null),
    [closeReviewed, setCloseReviewed] = useState(false);
  const mounted = useRef(true),
    sending = useRef(false),
    pending = useRef<AccountingImportInput | null>(null),
    fileTicket = useRef(0);
  const authority = adminViewRevision();
  const [fileBusy, setFileBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const invalidateFileRead = useCallback(() => {
    fileTicket.current++;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidateFileRead();
    };
  }, [invalidateFileRead]);
  useEffect(() => {
    if (!busy && !frozen) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, frozen]);
  const currentView = () => mounted.current && adminViewRevision() === authority;
  function parse() {
    if (fileBusy) return null;
    try {
      const rows = parseAccountingCsv(csv);
      setPreview(rows);
      setError(undefined);
      return rows;
    } catch (e) {
      setPreview(null);
      setError(e);
      return null;
    }
  }
  async function send(input: AccountingImportInput) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    onLock(true);
    try {
      const result = accountingImportSavedSchema.parse(
        await save<unknown>(base + '/' + id, input, 'PUT'),
      );
      if (result.id !== id) throw Error('شناسهٔ رسید با همین ورودی یکسان نیست.');
      if (currentView()) {
        pending.current = null;
        setFrozen(null);
        onSaved(id);
      }
    } catch (e) {
      if (currentView()) {
        setError(e);
        if (!(e instanceof ApiError && e.status >= 400 && e.status < 500)) {
          pending.current = input;
          setFrozen(input);
        }
      }
    } finally {
      sending.current = false;
      if (currentView()) {
        setBusy(false);
        onLock(pending.current !== null);
      }
    }
  }
  async function recover() {
    const input = pending.current;
    if (!input || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = accountingImportDetailSchema.parse(await api<unknown>(base + '/' + id));
      if (!accountingImportRecoveryMatches(id, input, result))
        throw Error('محتوای ذخیره‌شده با درخواست اصلی برابر نیست؛ موفقیت ذخیره تأیید نشد.');
      if (currentView()) {
        pending.current = null;
        setFrozen(null);
        onSaved(id);
      }
    } catch (e) {
      if (currentView()) setError(e);
    } finally {
      sending.current = false;
      if (currentView()) {
        setBusy(false);
        onLock(pending.current !== null);
      }
    }
  }
  function submit() {
    if (!preview || fileBusy) return;
    try {
      const input = accountingImportInputSchema.parse({
        schemaVersion: 1,
        companyKey: company,
        externalWarehouseKey: warehouse,
        quantityMeaning: meaning,
        priceCurrency: currency,
        observedAt: observedAt ? new Date(observedAt).toISOString() : '',
        isDemo: demo,
        rows: preview,
      });
      if (Date.parse(input.observedAt) > Date.now())
        throw Error('زمان مشاهده نمی‌تواند در آینده باشد.');
      void send(structuredClone(input));
    } catch (e) {
      setError(e);
    }
  }
  return (
    <form
      className="accounting-import"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending.current) submit();
      }}
    >
      <p className="notice">
        این فایل در بخش پیش‌نمایش ذخیره می‌شود. موجودی، قیمت فروش و اطلاعات هلو تغییر نمی‌کنند. قالب
        زیر استاندارد سایمان است؛ فایل خروجی خود هلو باید به این ستون‌ها تبدیل شود.
      </p>
      <ErrorBox error={error} />
      <fieldset disabled={busy || !!frozen}>
        <legend>مشخصات منبع</legend>
        <div className="form-grid">
          <Text
            label="شناسهٔ شرکت/پایگاه هلو"
            dir="ltr"
            required
            disabled={!!source}
            value={company}
            onChange={setCompany}
          />
          <Text
            label="شناسهٔ انبار منبع"
            dir="ltr"
            required
            disabled={!!source}
            value={warehouse}
            onChange={setWarehouse}
          />
          <div className="field">
            <PersianDateField
              label="زمان واقعی مشاهدهٔ داده (وقت این دستگاه)"
              encoding="local"
              value={observedAt}
              required
              onChange={(next) => setObservedAt(next)}
            />
          </div>
          <Field label="معنای ماندهٔ فایل">
            <select value={meaning} onChange={(e) => setMeaning(e.target.value as typeof meaning)}>
              <option value="unknown">نامشخص</option>
              <option value="physical">ماندهٔ فیزیکی</option>
              <option value="available">موجودی قابل فروش پس از تعهدات</option>
            </select>
          </Field>
          <Field label="واحد پول فایل">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as typeof currency)}
            >
              <option value="unknown">نامشخص</option>
              <option value="IRR">ریال</option>
              <option value="IRT">تومان</option>
            </select>
          </Field>
        </div>
        <Check
          label="این ورودی دادهٔ نمونهٔ محیط توسعه است"
          checked={demo}
          onChange={(e) => setDemo(e.target.checked)}
        />
        <Field
          label="فایل CSV استاندارد سایمان (UTF-8، حداکثر ۲۰۰ کالا)"
          error={fileError || undefined}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            aria-invalid={!!fileError}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              if (!file) return;
              // Allow selecting the same file after repairing it on disk.
              e.currentTarget.value = '';
              const ticket = ++fileTicket.current;
              setFileBusy(true);
              setFileName(file.name);
              setFileError('');
              setError(undefined);
              setPreview(null);
              setCsv('');
              try {
                if (file.size > 262144) throw Error('حجم فایل بیشتر از ۲۵۶ کیلوبایت است.');
                const text = new TextDecoder('utf-8', { fatal: true }).decode(
                  await file.arrayBuffer(),
                );
                if (mounted.current && ticket === fileTicket.current) {
                  setCsv(text);
                  setError(undefined);
                }
              } catch {
                if (mounted.current && ticket === fileTicket.current) {
                  setFileError(
                    file.size > 262144
                      ? 'حجم فایل بیشتر از ۲۵۶ کیلوبایت است.'
                      : 'فایل قابل خواندن نیست. آن را با کدگذاری UTF-8 ذخیره کنید یا متن CSV را بچسبانید.',
                  );
                  setFileName('');
                }
              } finally {
                if (mounted.current && ticket === fileTicket.current) setFileBusy(false);
              }
            }}
          />
        </Field>
        {fileName && (
          <p className="holoo-file-name" role="status">
            {fileBusy ? 'در حال خواندن' : 'فایل انتخاب‌شده'} <bdi>{fileName}</bdi>
          </p>
        )}
        <Field label="محتوای CSV؛ شناسه‌ها و صفرهای ابتدایی را تغییر ندهید">
          <textarea
            dir="ltr"
            rows={7}
            value={csv}
            disabled={fileBusy}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
              setFileName('');
              setFileError('');
            }}
          />
        </Field>
        <p className="muted">
          <code dir="ltr">{header}</code>
        </p>
        <p>
          مقدار خالیِ قیمت یا تعداد، نامشخص می‌ماند. اعداد اعشاری یا منفی برای بازبینی نگه‌داری
          می‌شوند و به موجودی قابل استفاده تبدیل نمی‌شوند. شناسهٔ کالا و واحد باید موجود باشند.
        </p>
        <button type="button" disabled={fileBusy || !csv.trim()} onClick={parse}>
          {fileBusy ? 'در حال خواندن فایل…' : 'بررسی فایل پیش از ذخیره'}
        </button>
        {preview && (
          <p role="status">
            {preview.length.toLocaleString('fa-IR')} ردیف قابل خواندن است. تطبیق SKU و بررسی اعداد
            پس از ذخیره در جزئیات نمایش داده می‌شود.
          </p>
        )}
      </fieldset>
      {frozen && (
        <div className="notice" role="alert">
          <strong>نتیجهٔ ذخیره مشخص نیست.</strong>
          <p>
            شناسهٔ همین ورودی: <code dir="ltr">{id}</code>. اطلاعات اصلی برای بازیابی در حافظه محفوظ
            است.
          </p>
          <div className="row-buttons">
            <button type="button" disabled={busy} onClick={() => void recover()}>
              بازخوانی نتیجهٔ همین ورودی
            </button>
            <button type="button" disabled={busy} onClick={() => void send(frozen)}>
              ارسال دوبارهٔ همان ورودی
            </button>
          </div>
          <Check
            label="شناسه را نگه داشته‌ام؛ بستن فرم به معنی موفقیت ذخیره نیست."
            checked={closeReviewed}
            disabled={busy}
            onChange={(e) => setCloseReviewed(e.target.checked)}
          />
          <button type="button" disabled={busy || !closeReviewed} onClick={onClose}>
            بستن بدون تأیید نتیجه
          </button>
        </div>
      )}
      <div className="form-actions">
        <button className="primary" disabled={busy || fileBusy || !!frozen || !preview}>
          {busy ? 'در حال پیگیری…' : 'ذخیره فقط در پیش‌نمایش'}
        </button>
        <button type="button" disabled={busy || !!frozen} onClick={onClose}>
          بستن
        </button>
      </div>
    </form>
  );
}
function ImportDetail({
  id,
  inventoryReadable,
  inventoryWritable,
  viewerId,
  onManageUnits,
}: {
  id: string;
  inventoryReadable: boolean;
  inventoryWritable: boolean;
  viewerId: string;
  onManageUnits: (source?: HolooSource) => void;
}) {
  const query = useQuery({
    queryKey: ['admin', 'holoo-import', id],
    queryFn: async ({ signal }) => {
      const detail = accountingImportDetailSchema.parse(
        await api<unknown>(base + '/' + id, { signal }),
      );
      if (detail.batch.id !== id) throw Error('جزئیات با شناسهٔ فایل انتخاب‌شده هم‌خوان نیست.');
      return detail;
    },
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const detail: AccountingImportDetail | undefined = query.data;
  return (
    <div className="accounting-import">
      <ErrorBox error={query.error} />
      <button onClick={() => void query.refetch()} disabled={query.isFetching}>
        بازخوانی تطبیق جاری
      </button>
      {query.isPending ? (
        <Busy />
      ) : (
        detail && (
          <>
            <p className="notice">
              {detail.batch.isDemo
                ? 'نمونهٔ توسعه؛ موجودی واقعی فروشگاه نیست.'
                : 'ورودی مدیریتی؛ دریافت زنده از هلو تأیید نشده است.'}{' '}
              دادهٔ منبع ثابت است؛ این داده به‌خودی‌خود اعمال نمی‌شود. تطبیق و تأیید صریح موجودی
              برای نقش دارای دسترسی انبار، پایین همین صفحه در دسترس است.
            </p>
            <dl>
              <dt>شرکت / انبار</dt>
              <dd>
                <bdi>
                  {detail.batch.companyKey} / {detail.batch.externalWarehouseKey}
                </bdi>
              </dd>
              <dt>مشاهده / ثبت (تهران)</dt>
              <dd>
                {date(detail.batch.observedAt)} / {date(detail.batch.createdAt)}
              </dd>
              <dt>واحد پول / معنای مانده</dt>
              <dd>
                {{ IRR: 'ریال', IRT: 'تومان', unknown: 'نامشخص' }[detail.batch.priceCurrency]} /{' '}
                {
                  { physical: 'فیزیکی', available: 'قابل فروش', unknown: 'نامشخص' }[
                    detail.batch.quantityMeaning
                  ]
                }
              </dd>
            </dl>
            <p>
              دادهٔ منبع ثابت است؛ SKU و قیمت فعلی سایت ممکن است پس از بازخوانی تغییر کنند. اختلاف
              قیمت، دستور تغییر قیمت نیست. بررسی اولیهٔ قالب، نسبت تبدیل واحد و نگاشت انبار را
              ارزیابی نمی‌کند؛ نتیجهٔ آن‌ها در جدول تطبیق انبار نمایش داده می‌شود.
            </p>
            <div className="table-wrap" role="region" aria-label="پیش‌نمایش دادهٔ هلو" tabIndex={0}>
              <AdminTable>
                <thead>
                  <tr>
                    <th>شناسه / واحد منبع</th>
                    <th>تعداد و قیمت خام</th>
                    <th>SKU جاری سایت</th>
                    <th>مبالغ ریالی پیش‌نمایش</th>
                    <th>بررسی اولیهٔ قالب</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>
                        <bdi>{row.externalItemId}</bdi>
                        <small>{row.externalName ?? 'نام ثبت نشده'}</small>
                        <small>
                          <bdi>
                            {row.externalCode ?? 'بدون کد نمایشی'} / {row.externalUnitKey}
                          </bdi>
                        </small>
                      </td>
                      <td>
                        <bdi>
                          {row.quantityRaw ?? 'نامشخص'} / {row.priceRaw ?? 'نامشخص'}
                        </bdi>
                      </td>
                      <td>
                        {row.currentMatch ? (
                          <>
                            <bdi>{row.currentMatch.sku}</bdi>
                            <small>{row.currentMatch.nameFa}</small>
                          </>
                        ) : (
                          'تطبیق فعال ندارد'
                        )}
                      </td>
                      <td>
                        منبع: {amount(row.priceRial)}
                        <small>فعلی: {amount(row.currentMatch?.priceRial ?? null)}</small>
                        <small>اختلاف: {amount(row.priceDifferenceRial)}</small>
                      </td>
                      <td>
                        {row.issues.map((issue) => (
                          <small key={issue}>{issueText[issue]}</small>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            {inventoryReadable && (
              <AccountingReconciliationView
                id={id}
                onManageUnits={() => onManageUnits(detail.batch)}
                viewerId={viewerId}
                writable={inventoryWritable}
              />
            )}
          </>
        )
      )}
    </div>
  );
}
export function AccountingImports({
  writable,
  inventoryReadable,
  inventoryWritable,
  viewerId,
  onManageUnits,
  source,
}: {
  writable: boolean;
  inventoryReadable: boolean;
  inventoryWritable: boolean;
  viewerId: string;
  onManageUnits: (source?: HolooSource) => void;
  source?: HolooSource;
}) {
  const [company, setCompany] = useState(''),
    [filter, setFilter] = useState(''),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [generation, setGeneration] = useState(0),
    [editing, setEditing] = useState(false),
    [locked, setLocked] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const parameters = new URLSearchParams();
  const companyKey = source?.companyKey ?? filter;
  const warehouseKey = source?.externalWarehouseKey;
  if (companyKey) parameters.set('companyKey', companyKey);
  if (warehouseKey) parameters.set('externalWarehouseKey', warehouseKey);
  if (cursors.at(-1)) parameters.set('cursor', cursors.at(-1)!);
  const query = useQuery({
    queryKey: [
      'admin',
      'holoo-imports',
      viewerId,
      companyKey,
      warehouseKey,
      cursors.at(-1),
      generation,
    ],
    queryFn: async ({ signal }) => {
      const page = accountingImportPageSchema.parse(
        await api<unknown>(base + (parameters.size ? '?' + parameters : ''), { signal }),
      );
      if (
        page.items.some(
          (item) =>
            (companyKey && item.companyKey !== companyKey) ||
            (warehouseKey && item.externalWarehouseKey !== warehouseKey),
        )
      )
        throw Error('فهرست فایل‌ها با شرکت و انبار انتخاب‌شده هم‌خوان نیست.');
      return page;
    },
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!writable) {
      setEditing(false);
      setLocked(false);
    }
  }, [writable]);
  return (
    <section className="panel accounting-import" id="holoo-imports">
      <div className="section-heading">
        <div>
          <h2>داده‌های هلو برای بررسی و تطبیق</h2>
          <p>
            فایل استاندارد را دریافت کنید و خطاها یا تفاوت قیمت را پیش از هر تغییر در فروشگاه
            ببینید.
          </p>
        </div>
        {writable && (
          <button className="primary" disabled={locked} onClick={() => setEditing(true)}>
            ورود فایل به پیش‌نمایش
          </button>
        )}
      </div>
      {source ? (
        <div className="holoo-scope-bar">
          <span>فایل‌های همین منبع</span>
          <bdi>
            {source.companyKey} / {source.externalWarehouseKey}
          </bdi>
          <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
            بازخوانی فایل‌ها
          </button>
        </div>
      ) : (
        <AdminFilterForm
          onSubmit={(e) => {
            e.preventDefault();
            setFilter(company);
            setCursors([null]);
            setGeneration((v) => v + 1);
          }}

          label="فیلتر فایل‌های هلو"
          search={
            <Text
              label="فیلتر شرکت/پایگاه (دقیق)"
              dir="ltr"
              value={company}
              onChange={setCompany}
            />
          }
          actions={
            <>
              <button className="primary">اعمال فیلتر</button>
              {(company || filter) && (
                <button
                  type="button"
                  onClick={() => {
                    setCompany('');
                    setFilter('');
                    setCursors([null]);
                  }}
                >
                  پاک‌کردن
                </button>
              )}
            </>
          }
          applied={filter ? ['شرکت: ' + filter] : []}
        />
      )}
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        query.data && (
          <>
            {query.data.items.length ? (
              <div
                className="table-wrap holoo-table"
                role="region"
                tabIndex={0}
                aria-label="فهرست فایل‌های هلو"
              >
                <AdminTable>
                  <thead>
                    <tr>
                      <th>شرکت / انبار</th>
                      <th>زمان مشاهده (تهران)</th>
                      <th>ردیف</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <bdi>
                            {item.companyKey} / {item.externalWarehouseKey}
                          </bdi>
                          <small>{item.isDemo ? 'نمونهٔ توسعه' : 'فایل مدیریتی'}</small>
                        </td>
                        <td data-sort-value={item.observedAt}>{date(item.observedAt)}</td>
                        <td>{item.rowCount.toLocaleString('fa-IR')}</td>
                        <td>
                          <button onClick={() => setSelected(item.id)}>جزئیات و پیش‌نمایش</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
              </div>
            ) : (
              <p className="holoo-empty" role="status">
                هنوز ورودی‌ای با این فیلتر ثبت نشده است.
              </p>
            )}
            {(cursors.length > 1 || query.data.nextCursor) && (
              <div className="pagination">
                <button
                  disabled={cursors.length === 1 || query.isFetching}
                  onClick={() => setCursors((v) => v.slice(0, -1))}
                >
                  قبل
                </button>
                <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
                <button
                  disabled={!query.data.nextCursor || query.isFetching}
                  onClick={() => setCursors((v) => [...v, query.data!.nextCursor])}
                >
                  ۲۰ ورودی بعدی
                </button>
              </div>
            )}
          </>
        )
      )}
      {editing && writable && (
        <Modal
          title="ورود داده فقط به پیش‌نمایش"
          preventClose={locked}
          onClose={() => {
            if (!locked) setEditing(false);
          }}
        >
          <ImportForm
            source={source}
            onLock={setLocked}
            onClose={() => {
              setEditing(false);
              setLocked(false);
            }}
            onSaved={(id) => {
              setEditing(false);
              setLocked(false);
              setCursors([null]);
              setGeneration((v) => v + 1);
              setSelected(id);
            }}
          />
        </Modal>
      )}
      {selected && (
        <Modal title="پیش‌نمایش ورودی هلو" onClose={() => setSelected(null)}>
          <ImportDetail
            id={selected}
            inventoryReadable={inventoryReadable}
            inventoryWritable={inventoryWritable}
            viewerId={viewerId}
            onManageUnits={onManageUnits}
          />
        </Modal>
      )}
    </section>
  );
}
