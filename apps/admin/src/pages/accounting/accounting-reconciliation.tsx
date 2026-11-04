import { AdminTable } from '../../components/tables/admin-table';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, save, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { Text } from '../../components/forms/forms';
import {
  warehouseInputSchema,
  warehousePageSchema,
  warehouseSchema,
  warehouseSavedSchema,
  readWarehouseResult,
  type Warehouse,
  type WarehouseCommand,
  reconciliationIssues,
} from '../../api/contracts/accounting/accounting-reconciliation-contract';
import { readStockPreview } from '../../api/contracts/accounting/accounting-stock-contract';
import { AccountingStockControls, AccountingStockCommandPanel } from './accounting-stock';
import {
  readWarehouseJournal,
  keepWarehouseCommand,
  finishWarehouseCommand,
  clearWarehouseJournal,
} from '../../state/accounting/accounting-warehouse-journal';
const base = '/admin/accounting/holoo',
  uuid = () => crypto.randomUUID().replaceAll('-', '');
const count = (v: number | null | undefined) =>
  v === null || v === undefined ? 'نامشخص' : v.toLocaleString('fa-IR');
const date = (v: string) => new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
const issueText: Record<(typeof reconciliationIssues)[number], string> = {
  warehouse_mapping_required: 'انبار منبع نگاشت ندارد',
  warehouse_mapping_inactive: 'نگاشت این انبار غیرفعال است',
  available_quantity_requires_reconciliation: 'فایل موجودی قابل فروش است؛ ماندهٔ فیزیکی نیست',
  quantity_meaning_unknown: 'معنای ماندهٔ فایل مشخص نیست',
  item_mapping_required: 'نگاشت فعال کالا به SKU لازم است',
  mapped_sku_not_eligible: 'SKU فعال و فیزیکی نیست',
  unit_mapping_required: 'نگاشت فعال همین واحد، شرکت، انبار و SKU لازم است',
  accounting_quantity_invalid: 'مقدار خام، عدد نامنفی پشتیبانی‌شده نیست',
  accounting_quantity_conversion: 'تبدیل دقیق به عدد صحیح صفر تا یک میلیون ممکن نیست',
  tracked_stock_requires_serial_receipt: 'این کالا به دریافت یا خروج سریال/IMEI نیاز دارد',
  single_unit_requires_inspection_flow: 'دستگاه کارکرده باید از گردش همان دستگاه مدیریت شود',
  stock_moved_since_observation: 'پس از زمان فایل، گردش انبار ثبت شده است؛ فایل تازه لازم است',
  stock_below_commitments: 'ماندهٔ فایل از جمع رزرو سفارش و تأمین کمتر است',
  quantity_missing: 'تعداد منبع مشخص نیست',
};

export function AccountingReconciliationView({
  id,
  onManageUnits,
  viewerId,
  writable,
}: {
  id: string;
  onManageUnits: () => void;
  viewerId: string;
  writable: boolean;
}) {
  const query = useQuery({
    queryKey: ['admin', 'holoo-stock-preview', viewerId, id],
    queryFn: async ({ signal }) =>
      readStockPreview(
        await api<unknown>(base + '/imports/' + id + '/stock-preview', { signal }),
        id,
      ),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const data = query.data?.reconciliation;
  const ready = query.data?.candidates.filter((candidate) => candidate.canApply).length ?? 0;
  return (
    <section>
      <h3>تطبیق مانده و تعهدات انبار</h3>
      <p>
        مقادیر غایب به صفر تبدیل نمی‌شوند. این پیش‌نمایش، موجودی یا قیمت را تغییر نمی‌دهد. قیمت فایل
        جداگانه برای بررسی باقی می‌ماند. برای نگاشت واحد، سامانهٔ مبدأ را دقیقاً holoo و شرکت، انبار
        و SKU همین ردیف را انتخاب کنید.
      </p>
      <div className="row-buttons">
        <button disabled={query.isFetching} onClick={() => void query.refetch()}>
          بازخوانی اختلاف انبار
        </button>
        <button onClick={onManageUnits}>مدیریت نگاشت واحدها</button>
      </div>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        data && (
          <>
            <p>
              مشاهدهٔ فایل: {date(data.observedAt)} ·{' '}
              {data.warehouse
                ? data.warehouse.nameFa + ' — ' + (data.warehouse.isActive ? 'فعال' : 'غیرفعال')
                : 'انبار منبع هنوز نگاشت ندارد'}
            </p>
            <div className="holoo-reconciliation-stats" aria-label="خلاصهٔ بررسی ردیف‌ها">
              <span>
                <strong>{count(data.rows.length)}</strong> ردیف فایل
              </span>
              <span>
                <strong>{count(ready)}</strong> ردیف قابل انتخاب
              </span>
              <span>
                <strong>{count(data.rows.length - ready)}</strong> ردیف مسدود
              </span>
            </div>
            <div
              className="table-wrap"
              role="region"
              aria-label="اختلاف موجودی فایل هلو"
              tabIndex={0}
            >
              <AdminTable>
                <thead>
                  <tr>
                    <th>آیتم / SKU</th>
                    <th>واحد و تبدیل</th>
                    <th>ماندهٔ فعلی / فایل</th>
                    <th>رزرو سفارش / تأمین / آزاد</th>
                    <th>اختلاف / بررسی</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>
                        <bdi>{row.externalItemId}</bdi>
                        <small>
                          <bdi>{row.match?.sku ?? 'بدون نگاشت کالا'}</bdi>
                        </small>
                        <small>{row.match?.nameFa}</small>
                      </td>
                      <td>
                        <bdi>
                          {row.sourceQuantity ?? 'نامشخص'} {row.externalUnitKey}
                        </bdi>
                        <small>
                          {row.unitMapping ? (
                            <>
                              <bdi>
                                {row.unitMapping.numerator}/{row.unitMapping.denominator}
                              </bdi>{' '}
                              · {row.unitMapping.nameFa}
                            </>
                          ) : (
                            'واحد هنوز نگاشت ندارد'
                          )}
                        </small>
                      </td>
                      <td>
                        {count(row.stock?.onHand ?? (row.match ? 0 : null))} /{' '}
                        {count(row.targetOnHand)}
                        <small>
                          {row.stock?.lastMovementAt
                            ? 'آخرین گردش: ' + date(row.stock.lastMovementAt)
                            : 'گردشی برای این SKU ثبت نشده'}
                        </small>
                      </td>
                      <td>
                        {count(row.stock?.reserved ?? (row.match ? 0 : null))} /{' '}
                        {count(row.stock?.sourcingReserved ?? (row.match ? 0 : null))} /{' '}
                        {count(row.stock?.available ?? (row.match ? 0 : null))}
                      </td>
                      <td>
                        {count(row.delta)}
                        {row.issues.length ? (
                          row.issues.map((issue) => <small key={issue}>{issueText[issue]}</small>)
                        ) : (
                          <small>اختلاف قابل بررسی است؛ هنوز اعمال نشده.</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            {query.data && (
              <AccountingStockControls
                key={query.data.fingerprint}
                viewerId={viewerId}
                writable={writable}
                preview={query.data}
                fresh={!query.error && query.fetchStatus === 'idle'}
              />
            )}
            <AccountingStockCommandPanel viewerId={viewerId} writable={writable} inline />
          </>
        )
      )}
    </section>
  );
}

function WarehouseForm({
  initial,
  busy,
  onSubmit,
  onClose,
}: {
  initial: Warehouse | null;
  busy: boolean;
  onSubmit: (command: WarehouseCommand) => void;
  onClose: () => void;
}) {
  const [targetId] = useState(initial?.id ?? uuid()),
    [fields, setFields] = useState({
      companyKey: initial?.companyKey ?? '',
      externalWarehouseKey: initial?.externalWarehouseKey ?? '',
      nameFa: initial?.nameFa ?? '',
      nameEn: initial?.nameEn ?? '',
      isActive: initial?.isActive ?? false,
    }),
    [ack, setAck] = useState(false),
    [error, setError] = useState<unknown>();
  const change = (key: keyof typeof fields, value: string | boolean) => {
    setFields((v) => ({ ...v, [key]: value }));
    setAck(false);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSubmit({
            targetId,
            input: warehouseInputSchema.parse({
              ...fields,
              commandId: uuid(),
              acknowledgeWholeStorePhysical: ack,
              version: initial?.version ?? null,
            }),
          });
        } catch (error) {
          setError(error);
        }
      }}
    >
      <p className="notice">
        انبار سایت فعلاً یک ماندهٔ کل دارد. فقط منبعی را فعال کنید که ماندهٔ فیزیکی کامل فروشگاه را
        نمایندگی می‌کند. ماندهٔ یک انبار جزئی یا موجودی پس از تعهدات، جای ماندهٔ کل قرار نمی‌گیرد.
        تنها یک منبع می‌تواند فعال باشد؛ این انتخاب همگام‌سازی را فعال نمی‌کند.
      </p>
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        <legend>هویت انبار منبع</legend>
        <fieldset disabled={!!initial}>
          <Text
            label="شرکت هلو برای انبار"
            dir="ltr"
            required
            value={fields.companyKey}
            onChange={(v) => change('companyKey', v)}
          />
          <Text
            label="کلید ثابت انبار هلو"
            dir="ltr"
            required
            value={fields.externalWarehouseKey}
            onChange={(v) => change('externalWarehouseKey', v)}
          />
        </fieldset>
        <Text
          label="نام فارسی انبار منبع"
          required
          value={fields.nameFa}
          onChange={(v) => change('nameFa', v)}
        />
        <Text
          label="English warehouse name"
          required
          dir="ltr"
          value={fields.nameEn}
          onChange={(v) => change('nameEn', v)}
        />
        <Check
          label="این منبع برای کل ماندهٔ فیزیکی فروشگاه فعال باشد"
          checked={fields.isActive}
          onChange={(e) => change('isActive', e.target.checked)}
        />
        <Check
          label="بررسی کرده‌ام که این منبع ماندهٔ فیزیکی کامل فروشگاه را نشان می‌دهد، نه انبار جزئی یا موجودی پس از تعهدات."
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
      </fieldset>
      <div className="form-actions">
        <button className="primary" disabled={busy || (fields.isActive && !ack)}>
          ذخیرهٔ نگاشت انبار
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          بستن
        </button>
      </div>
    </form>
  );
}
export function AccountingWarehouses({
  viewerId,
  writable,
  onManageUnits,
}: {
  viewerId: string;
  writable: boolean;
  onManageUnits: () => void;
}) {
  const [company, setCompany] = useState(''),
    [filter, setFilter] = useState(''),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Warehouse | null | undefined>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [journal, setJournal] = useState(() => readWarehouseJournal(viewerId)),
    [lookup, setLookup] = useState(''),
    [receipt, setReceipt] = useState<ReturnType<typeof warehouseSavedSchema.parse> | null>(null);
  const mounted = useRef(true),
    flight = useRef(false),
    authority = adminViewRevision();
  const client = useQueryClient();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!writable) setEditing(undefined);
  }, [writable]);
  const params = new URLSearchParams();
  if (filter) params.set('companyKey', filter);
  if (cursors.at(-1)) params.set('cursor', cursors.at(-1)!);
  const query = useQuery({
    queryKey: ['admin', 'holoo-warehouses', viewerId, filter, cursors.at(-1), revision],
    queryFn: async ({ signal }) => {
      const v = warehousePageSchema.parse(
        await api<unknown>(base + '/warehouses' + (params.size ? '?' + params : ''), { signal }),
      );
      if (filter && v.items.some((x) => x.companyKey !== filter))
        throw Error('فهرست با شرکت انتخاب‌شده هم‌خوان نیست.');
      return v;
    },
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const locked = busy || (!!journal && !journal.result);
  useEffect(() => {
    if (!locked) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [locked]);
  function valid() {
    return mounted.current && adminViewRevision() === authority;
  }
  function refreshMappings() {
    setCursors([null]);
    setRevision((v) => v + 1);
    void client.invalidateQueries({ queryKey: ['admin', 'holoo-warehouses'] });
    void client.invalidateQueries({ queryKey: ['admin', 'holoo-stock-preview'] });
  }
  async function send(command: WarehouseCommand, fresh = false) {
    if (flight.current || !writable) return;
    flight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      keepWarehouseCommand(viewerId, command);
      setJournal(readWarehouseJournal(viewerId));
      setEditing(undefined);
      const result = readWarehouseResult(
        await save<unknown>(base + '/warehouses/' + command.targetId, command.input, 'PUT'),
        command,
      );
      if (!valid()) return;
      if (finishWarehouseCommand(viewerId, command, result)) {
        setJournal(readWarehouseJournal(viewerId));
        refreshMappings();
      }
    } catch (error) {
      if (!valid()) return;
      setError(error);
      if (
        fresh &&
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 429].includes(error.status)
      ) {
        clearWarehouseJournal(viewerId);
        setJournal(null);
        refreshMappings();
      }
    } finally {
      flight.current = false;
      if (valid()) setBusy(false);
    }
  }
  async function recover(command: WarehouseCommand) {
    if (flight.current || !writable) return;
    flight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = readWarehouseResult(
        await api<unknown>(base + '/warehouse-commands/' + command.input.commandId),
        command,
      );
      if (!valid()) return;
      if (finishWarehouseCommand(viewerId, command, result)) {
        setJournal(readWarehouseJournal(viewerId));
        refreshMappings();
      }
    } catch (error) {
      if (valid()) setError(error);
    } finally {
      flight.current = false;
      if (valid()) setBusy(false);
    }
  }
  async function lookupReceipt() {
    if (flight.current || !writable) return;
    try {
      if (!/^[a-f0-9]{32}$/.test(lookup)) throw Error('شناسهٔ فرمان، UUID بدون خط تیره است.');
      flight.current = true;
      setBusy(true);
      const result = warehouseSavedSchema.parse(
        await api<unknown>(base + '/warehouse-commands/' + lookup),
      );
      if (result.commandId !== lookup) throw Error('رسید مربوط به همین شناسه نیست.');
      if (valid()) setReceipt(result);
    } catch (error) {
      if (valid()) setError(error);
    } finally {
      flight.current = false;
      if (valid()) setBusy(false);
    }
  }
  async function editWarehouse(id: string) {
    if (flight.current || locked || !writable) return;
    flight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const fresh = warehouseSchema.parse(await api<unknown>(base + '/warehouses/' + id));
      if (fresh.id !== id) throw Error('شناسهٔ نگاشت تغییر کرده است.');
      if (valid()) setEditing(fresh);
    } catch (error) {
      if (valid()) setError(error);
    } finally {
      flight.current = false;
      if (valid()) setBusy(false);
    }
  }
  return (
    <section className="panel" id="holoo-warehouses">
      <div className="section-heading">
        <div>
          <h2>محدودهٔ انبار و واحدهای هلو</h2>
          <p>
            نگاشت‌ها مشخص می‌کنند دادهٔ فایل مربوط به کدام مانده و واحد فروش است. ذخیرهٔ نگاشت،
            مانده یا قیمت را تغییر نمی‌دهد.
          </p>
        </div>
        <div className="row-buttons">
          <button onClick={onManageUnits}>مدیریت نگاشت واحدها</button>
          {writable && (
            <button disabled={locked} onClick={() => setEditing(null)}>
              افزودن نگاشت انبار
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error ?? query.error} />
      {journal && (
        <div className="notice" role="status">
          <strong>
            {journal.result ? 'رسید نگاشت انبار تأیید شد.' : 'نتیجهٔ نگاشت انبار هنوز مشخص نیست.'}
          </strong>
          <p>
            شناسهٔ فرمان: <code dir="ltr">{journal.command.input.commandId}</code>
          </p>
          <p>
            انبار:{' '}
            <bdi>
              {journal.command.input.companyKey} / {journal.command.input.externalWarehouseKey}
            </bdi>
          </p>
          {journal.result ? (
            <>
              <p>
                {journal.result.warehouse.nameFa} ·{' '}
                {journal.result.warehouse.isActive ? 'فعال' : 'غیرفعال'}
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  clearWarehouseJournal(viewerId);
                  setJournal(null);
                  setRevision((v) => v + 1);
                }}
              >
                بازگشت به ویرایش انبارها
              </button>
            </>
          ) : (
            <>
              <p>
                همان فرمان در حافظهٔ این تب، برای همین حساب محفوظ است. پیدا نشدن رسید به معنی
                ثبت‌نشدن نیست؛ برای تلاش مجدد، انبار تازه نسازید.
              </p>
              <div className="row-buttons">
                <button disabled={busy || !writable} onClick={() => void recover(journal.command)}>
                  رسید همین نگاشت انبار
                </button>
                <button disabled={busy || !writable} onClick={() => void send(journal.command)}>
                  ارسال دقیق همان نگاشت انبار
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <AdminFilterForm
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(company);
          setCursors([null]);
          setRevision((v) => v + 1);
        }}

        label="فیلتر نگاشت انبارهای هلو"
        search={
          <Text label="فیلتر شرکت برای انبارها" dir="ltr" value={company} onChange={setCompany} />
        }
        actions={<button>بازخوانی انبارها</button>}
        applied={filter ? ['شرکت: ' + filter] : []}
      ></AdminFilterForm>
      {query.isPending ? (
        <Busy />
      ) : (
        query.data && (
          <>
            {query.data.items.length ? (
              <div
                className="table-wrap holoo-table"
                role="region"
                aria-label="نگاشت انبارهای هلو"
                tabIndex={0}
              >
                <AdminTable>
                  <thead>
                    <tr>
                      <th>شرکت / انبار منبع</th>
                      <th>نام</th>
                      <th>محدوده</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <bdi>
                            {row.companyKey} / {row.externalWarehouseKey}
                          </bdi>
                        </td>
                        <td>
                          {row.nameFa}
                          <small>{row.nameEn}</small>
                        </td>
                        <td>
                          <span
                            className="holoo-indicator"
                            data-tone={row.isActive ? 'ready' : 'neutral'}
                          >
                            {row.isActive ? 'فعال برای کل ماندهٔ فیزیکی' : 'غیرفعال'}
                          </span>
                        </td>
                        <td>
                          {writable && (
                            <button disabled={locked} onClick={() => void editWarehouse(row.id)}>
                              ویرایش نگاشت انبار
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
              </div>
            ) : (
              <p className="holoo-empty" role="status">
                نگاشت انباری با این شرکت ثبت نشده است.
              </p>
            )}
            {(cursors.length > 1 || query.data.nextCursor) && (
              <div className="pagination">
                <button
                  disabled={cursors.length === 1 || query.isFetching}
                  onClick={() => setCursors((v) => v.slice(0, -1))}
                >
                  انبارهای قبلی
                </button>
                <button
                  disabled={!query.data.nextCursor || query.isFetching}
                  onClick={() => setCursors((v) => [...v, query.data!.nextCursor])}
                >
                  ۲۰ انبار بعدی
                </button>
              </div>
            )}
          </>
        )
      )}
      {writable && (
        <details>
          <summary>بازیابی رسید نگاشت انبار با شناسه</summary>
          <div className="holoo-receipt-fields">
            <Field label="شناسهٔ فرمان نگاشت انبار">
              <input
                dir="ltr"
                maxLength={32}
                value={lookup}
                disabled={busy}
                onChange={(e) => {
                  setLookup(e.target.value);
                  setReceipt(null);
                }}
              />
            </Field>
            <button disabled={busy} onClick={() => void lookupReceipt()}>
              خواندن رسید نگاشت انبار
            </button>
          </div>
          {receipt && (
            <p role="status">
              رسید تاریخی: {receipt.warehouse.nameFa} ·{' '}
              <bdi>
                {receipt.warehouse.companyKey} / {receipt.warehouse.externalWarehouseKey}
              </bdi>{' '}
              · {receipt.warehouse.isActive ? 'فعال در زمان فرمان' : 'غیرفعال در زمان فرمان'}؛ وضعیت
              جاری را جدا بازخوانی کنید.
            </p>
          )}
        </details>
      )}
      {editing !== undefined && writable && !locked && (
        <Modal title="نگاشت انبار هلو" onClose={() => setEditing(undefined)}>
          <WarehouseForm
            key={editing?.id ?? 'new'}
            initial={editing}
            busy={busy}
            onClose={() => setEditing(undefined)}
            onSubmit={(command) => void send(command, true)}
          />
        </Modal>
      )}
    </section>
  );
}
