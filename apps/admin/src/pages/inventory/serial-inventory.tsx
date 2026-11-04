import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ZodError } from 'zod';
import { api, ApiError, save } from '../../api/api';
import { Busy, ErrorBox, Field } from '../../components/ui';
import {
  emptySerialFilters,
  modeLabels,
  stateLabels,
  serialFiltersSchema,
  serialHistoryPath,
  readSerialHistory,
  modeAttempt,
  receiptAttempt,
  readSerialCommand,
  type SerialMode,
  type SerialFilters,
  type SerialUnit,
  type SerialAttempt,
} from '../../api/contracts/inventory/serial-contract';
import {
  serialPathV2,
  readSerialPageV2,
  toSerialStockV1,
  canRetireSerialV2,
  retireAttemptV2,
  type SerialItemV2,
} from '../../api/contracts/inventory/serial-contract-v2';

const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
const problem = (error: unknown, writing = false) =>
  error instanceof ZodError
    ? new Error(
        writing
          ? 'قالب شناسه‌ها، رقم کنترل IMEI، دلیل و تعداد دستگاه‌ها را بررسی کنید.'
          : 'پاسخ دریافتی معتبر نیست؛ اطلاعات تازه را دوباره دریافت کنید.',
      )
    : error;
const actionLabel = { mode: 'تغییر روش رهگیری', receipt: 'دریافت دستگاه‌ها', retire: 'خروج واحد' };

export function SerialInventoryPanel({
  variantId,
  sku,
  writable,
  onPendingChange,
}: {
  variantId: string;
  sku: string;
  writable: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const client = useQueryClient();
  const [generation, setGeneration] = useState(0);
  const [draft, setDraft] = useState<SerialFilters>(emptySerialFilters);
  const [filters, setFilters] = useState<SerialFilters>(emptySerialFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1)!;
  const [choice, setChoice] = useState<SerialMode | ''>('');
  const [receipt, setReceipt] = useState('');
  const [receiptReason, setReceiptReason] = useState('');
  const [retireReason, setRetireReason] = useState('');
  const [retiring, setRetiring] = useState<SerialItemV2 | null>(null);
  const [history, setHistory] = useState<SerialUnit | null>(null);
  const [attempt, setAttempt] = useState<SerialAttempt | null>(null);
  const [needsFresh, setNeedsFresh] = useState(false);
  const [formError, setFormError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const page = useQuery({
    queryKey: ['admin', 'serial-page', 2, variantId, generation, filters, cursor],
    queryFn: async ({ signal }) => {
      try {
        return readSerialPageV2(
          await api<unknown>(serialPathV2(variantId, filters, cursor), { signal }),
          variantId,
          filters,
          cursor,
        );
      } catch (error) {
        throw problem(error);
      }
    },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function refresh() {
    setCursors([null]);
    setGeneration((v) => v + 1);
    setNeedsFresh(false);
    setChoice('');
    setRetiring(null);
    setFormError(undefined);
  }
  const mutation = useMutation({
    mutationFn: async (value: SerialAttempt) =>
      readSerialCommand(await save<unknown>(value.path, value.body, value.method), value),
    retry: false,
    onSuccess: () => {
      setAttempt(null);
      setReceipt('');
      setReceiptReason('');
      setRetireReason('');
      setHistory(null);
      refresh();
      setNotice('درخواست ثبت شد؛ فهرست و ماندهٔ تازه در حال دریافت است.');
      void client.invalidateQueries({ queryKey: ['admin', 'stock-page'] });
      void client.invalidateQueries({ queryKey: ['admin', 'stock-movements'] });
      void client.invalidateQueries({ queryKey: ['admin', 'inventory-summary'] });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      ) {
        setAttempt(null);
        setNeedsFresh(true);
      }
    },
    onSettled: () => onPendingChange?.(false),
  });
  const blocked =
    !writable ||
    mutation.isPending ||
    attempt !== null ||
    needsFresh ||
    page.isFetching ||
    page.isError;
  function send(value: SerialAttempt) {
    if (!writable || mutation.isPending) return;
    setAttempt(value);
    setFormError(undefined);
    setNotice('');
    onPendingChange?.(true);
    mutation.mutate(value);
  }
  function begin(build: () => SerialAttempt) {
    if (blocked) return;
    try {
      send(build());
    } catch (error) {
      setFormError(problem(error, true));
    }
  }
  const stock = page.data?.stock;
  const currentRetiring =
    retiring &&
    page.data?.items.find(
      (item) =>
        item.unit.id.toLowerCase() === retiring.unit.id.toLowerCase() &&
        item.unit.version === retiring.unit.version,
    );
  return (
    <section className="serial-panel" aria-label={`سریال‌های ${sku}`}>
      <div className="section-heading">
        <div>
          <h3>
            رهگیری واحدهای فیزیکی · <bdi>{sku}</bdi>
          </h3>
          <p>سریال و IMEI هر دستگاه؛ IMEI دوم متعلق به همان یک دستگاه است.</p>
        </div>
        <button
          disabled={mutation.isPending || attempt !== null || page.isFetching}
          onClick={() => {
            mutation.reset();
            refresh();
          }}
        >
          دریافت تازهٔ سریال‌ها
        </button>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <ErrorBox error={formError ?? problem(mutation.error)} />
      {attempt && mutation.isError && (
        <div className="notice serial-unknown" role="status">
          <strong>نتیجهٔ {actionLabel[attempt.kind]} هنوز مشخص نیست.</strong>
          <p>
            اطلاعات این تلاش قفل است؛ ارسال دوباره با همان شناسه، مقادیر و نسخه انجام می‌شود. هیچ
            درخواست تازه‌ای خودکار ارسال نمی‌شود.
          </p>
          <p>
            بستن این بخش یا بارگیری مجدد، حافظهٔ این تلاش را پاک می‌کند؛ پیش از عملیات تازه، فهرست و
            تاریخچه را بررسی کنید.
          </p>
          <small>
            شناسهٔ تلاش: <bdi>{attempt.body.requestId}</bdi>
          </small>
          <button
            className="primary"
            disabled={!writable || mutation.isPending}
            onClick={() => send(attempt)}
          >
            ارسال دوبارهٔ همان درخواست
          </button>
        </div>
      )}
      {needsFresh && (
        <p className="notice" role="status">
          درخواست انجام نشد؛ پیش از تلاش تازه، «دریافت تازهٔ سریال‌ها» را بزنید و اطلاعات را بازبینی
          کنید.
        </p>
      )}
      <form
        className="form-grid serial-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = serialFiltersSchema.safeParse(draft);
          if (!parsed.success) {
            setFormError(
              new Error(
                'پیشوند سریال یا IMEI را با حداکثر ۱۰۰ حرف/رقم و جداکننده‌های مجاز وارد کنید.',
              ),
            );
            return;
          }
          setFormError(undefined);
          setFilters(parsed.data);
          setCursors([null]);
          setGeneration((v) => v + 1);
          if (!attempt) setRetiring(null);
        }}
      >
        <Field label="وضعیت واحد">
          <select
            value={draft.state}
            onChange={(e) =>
              setDraft({ ...draft, state: e.target.value as SerialFilters['state'] })
            }
          >
            <option value="all">همهٔ وضعیت‌ها</option>
            {Object.entries(stateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="شروع سریال یا IMEI">
          <input
            dir="ltr"
            maxLength={100}
            value={draft.query}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
          />
        </Field>
        <button type="submit" disabled={page.isFetching}>
          جست‌وجوی واحدها
        </button>
      </form>
      <ErrorBox error={page.error} />
      {page.isPending ? (
        <Busy />
      ) : page.error ? (
        <button onClick={() => void page.refetch()} disabled={page.isFetching}>
          تلاش دوباره برای دریافت سریال‌ها
        </button>
      ) : (
        stock &&
        page.data && (
          <>
            <p className="notice" role="status">
              روش فعلی: {modeLabels[stock.mode]} · موجودی فیزیکی:{' '}
              {stock.onHand.toLocaleString('fa-IR')} · رزرو سفارش:{' '}
              {stock.reserved.toLocaleString('fa-IR')} · رزرو تأمین:{' '}
              {stock.sourcingReserved.toLocaleString('fa-IR')} · آزاد:{' '}
              {stock.available.toLocaleString('fa-IR')}
            </p>
            {writable && (
              <div className="serial-write-sections">
                <details>
                  <summary>تنظیم روش رهگیری</summary>
                  <p>
                    ویژهٔ کالاهای فیزیکی؛ تغییر روش فقط با ماندهٔ خالی و بدون رزرو سفارش یا تأمین
                    امکان دارد. سریال موجودی قبلی حدس زده نمی‌شود.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (choice)
                        begin(() =>
                          modeAttempt(toSerialStockV1(stock), choice, crypto.randomUUID()),
                        );
                    }}
                  >
                    <fieldset
                      disabled={
                        blocked ||
                        stock.onHand !== 0 ||
                        stock.reserved !== 0 ||
                        stock.sourcingReserved !== 0
                      }
                    >
                      <Field label="روش تازهٔ رهگیری">
                        <select
                          value={choice}
                          onChange={(e) => setChoice(e.target.value as SerialMode | '')}
                        >
                          <option value="">انتخاب روش</option>
                          {Object.entries(modeLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <button
                        className="primary"
                        type="submit"
                        disabled={!choice || choice === stock.mode}
                      >
                        ثبت روش رهگیری
                      </button>
                    </fieldset>
                  </form>
                </details>
                <details>
                  <summary>دریافت دستگاه‌های دارای شناسه</summary>
                  <p>
                    هر خط یک دستگاه؛ حداکثر ۱۰۰ دستگاه در هر دریافت. ثبت شناسه به معنی تأیید رجیستری
                    یا اصالت نیست.
                  </p>
                  {stock.mode === 'none' && (
                    <p className="notice">
                      برای دریافت شناسه‌دار، ابتدا روش رهگیری را روی ماندهٔ خالی تنظیم کنید.
                    </p>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      begin(() =>
                        receiptAttempt(
                          toSerialStockV1(stock),
                          receipt,
                          receiptReason,
                          crypto.randomUUID(),
                        ),
                      );
                    }}
                  >
                    <fieldset disabled={blocked || stock.mode === 'none'}>
                      <Field
                        label={
                          stock.mode === 'imei' ? 'شناسه‌های IMEI دستگاه‌ها' : 'سریال دستگاه‌ها'
                        }
                        hint={
                          stock.mode === 'imei'
                            ? 'هر خط: IMEI اول، IMEI دوم اختیاری، سریال اختیاری؛ ستون‌ها با ویرگول انگلیسی جدا شوند.'
                            : 'هر خط یک سریال؛ حروف، ارقام و . _ / - مجازند.'
                        }
                      >
                        <textarea
                          dir="ltr"
                          rows={5}
                          maxLength={50000}
                          value={receipt}
                          onChange={(e) => setReceipt(e.target.value)}
                          placeholder={stock.mode === 'imei' ? 'IMEI1,IMEI2,Serial' : 'Serial'}
                        />
                      </Field>
                      <Field label="دلیل ورود">
                        <input
                          maxLength={500}
                          value={receiptReason}
                          onChange={(e) => setReceiptReason(e.target.value)}
                          required
                        />
                      </Field>
                      <button className="primary" type="submit">
                        ثبت دریافت دستگاه‌ها
                      </button>
                    </fieldset>
                  </form>
                </details>
              </div>
            )}
            {retiring && writable && (
              <form
                className="serial-retire notice"
                onSubmit={(e) => {
                  e.preventDefault();
                  begin(() => {
                    if (!currentRetiring)
                      throw new Error(
                        'واحد انتخاب‌شده تغییر کرده است؛ فهرست تازه را بازبینی کنید.',
                      );
                    return retireAttemptV2(
                      stock,
                      currentRetiring,
                      retireReason,
                      crypto.randomUUID(),
                    );
                  });
                }}
              >
                <h4>
                  خروج واحد · <bdi>{retiring.unit.serial ?? retiring.unit.imei1}</bdi>
                </h4>
                <p>این عملیات از موجودی فیزیکی کم می‌کند و تاریخچهٔ شناسه را نگه می‌دارد.</p>
                {(!currentRetiring || !canRetireSerialV2(stock, currentRetiring)) && (
                  <p role="status">
                    این واحد اکنون قابل خروج نیست؛ سهم محفوظ، موجودی آزاد و نسخهٔ تازه را بررسی
                    کنید.
                  </p>
                )}
                <fieldset
                  disabled={
                    blocked || !currentRetiring || !canRetireSerialV2(stock, currentRetiring)
                  }
                >
                  <Field label="دلیل خروج واحد">
                    <input
                      maxLength={500}
                      value={retireReason}
                      onChange={(e) => setRetireReason(e.target.value)}
                      required
                    />
                  </Field>
                  <div className="row-buttons">
                    <button className="primary" type="submit">
                      ثبت خروج واحد
                    </button>
                  </div>
                </fieldset>
                <button
                  disabled={mutation.isPending}
                  type="button"
                  onClick={() => setRetiring(null)}
                >
                  انصراف از خروج
                </button>
              </form>
            )}
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="جدول سریال‌ها، قابل پیمایش افقی"
            >
              <AdminTable>
                <thead>
                  <tr>
                    <th>شناسهٔ دستگاه</th>
                    <th>وضعیت فیزیکی</th>
                    <th>سهم محفوظ</th>
                    <th>سفارش / پایان گارانتی</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.items.map((item) => {
                    const unit = item.unit;
                    return (
                      <tr key={unit.id}>
                        <td>
                          {unit.serial && (
                            <>
                              <small>Serial</small>
                              <bdi>{unit.serial}</bdi>
                            </>
                          )}
                          {unit.imei1 && (
                            <>
                              <small>IMEI 1</small>
                              <bdi>{unit.imei1}</bdi>
                            </>
                          )}
                          {unit.imei2 && (
                            <>
                              <small>IMEI 2</small>
                              <bdi>{unit.imei2}</bdi>
                            </>
                          )}
                          <small>
                            <bdi>{unit.id}</bdi>
                          </small>
                        </td>
                        <td>{stateLabels[unit.state]}</td>
                        <td>{item.hasActiveClaim ? 'دارای سهم محفوظ' : 'بدون سهم محفوظ'}</td>
                        <td>
                          <bdi>{unit.orderId ?? 'بدون اتصال به سفارش'}</bdi>
                          <small>
                            {unit.warrantyUntil === null
                              ? 'پایان گارانتی تعیین نشده'
                              : date(unit.warrantyUntil)}
                          </small>
                        </td>
                        <td>
                          <div className="row-buttons">
                            <button onClick={() => setHistory(unit)}>تاریخچهٔ واحد</button>
                            {writable && unit.state === 'available' && (
                              <button
                                disabled={blocked || !canRetireSerialV2(stock, item)}
                                onClick={() => {
                                  setRetiring(item);
                                  setRetireReason('');
                                  setFormError(undefined);
                                }}
                              >
                                خروج این واحد
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {page.data.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty">
                        واحدی با این فیلتر پیدا نشد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            <div className="pagination">
              <button
                disabled={cursors.length === 1 || page.isFetching}
                onClick={() => {
                  setCursors((v) => v.slice(0, -1));
                  if (!attempt) setRetiring(null);
                }}
              >
                سریال‌های قبلی
              </button>
              <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
              <button
                disabled={!page.data.nextCursor || page.isFetching}
                onClick={() => {
                  if (page.data?.nextCursor) setCursors((v) => [...v, page.data!.nextCursor]);
                  if (!attempt) setRetiring(null);
                }}
              >
                ۵۰ سریال بعدی
              </button>
            </div>
          </>
        )
      )}
      {history && (
        <SerialHistory
          key={history.id}
          variantId={variantId}
          unit={history}
          onClose={() => setHistory(null)}
        />
      )}
    </section>
  );
}

function SerialHistory({
  variantId,
  unit,
  onClose,
}: {
  variantId: string;
  unit: SerialUnit;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const [positions, setPositions] = useState<(string | null)[]>([null]);
  const before = positions.at(-1)!;
  const query = useQuery({
    queryKey: ['admin', 'serial-history', variantId, unit.id, before],
    queryFn: async ({ signal }) => {
      try {
        return readSerialHistory(
          await api<unknown>(serialHistoryPath(variantId, unit.id, before), { signal }),
          unit.id,
          before,
        );
      } catch (error) {
        throw problem(error);
      }
    },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return (
    <section ref={ref} tabIndex={-1} className="serial-history" aria-label="تاریخچهٔ واحد">
      <div className="section-heading">
        <h3>
          تاریخچهٔ واحد · <bdi>{unit.serial ?? unit.imei1}</bdi>
        </h3>
        <button onClick={onClose}>بستن تاریخچهٔ واحد</button>
      </div>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <button onClick={() => void query.refetch()}>دریافت دوبارهٔ تاریخچهٔ واحد</button>
      ) : (
        query.data && (
          <>
            <div className="table-wrap">
              <AdminTable>
                <thead>
                  <tr>
                    <th>رویداد / وضعیت</th>
                    <th>دلیل / عامل</th>
                    <th>سفارش / زمان</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <bdi>{row.id}</bdi>
                        <small>{stateLabels[row.state]}</small>
                      </td>
                      <td>
                        {row.reason}
                        <small>
                          <bdi>{row.actorId}</bdi>
                        </small>
                      </td>
                      <td>
                        <bdi>{row.orderId ?? '—'}</bdi>
                        <small>
                          <time dateTime={row.at}>{date(row.at)}</time>
                        </small>
                      </td>
                    </tr>
                  ))}
                  {query.data.items.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty">
                        رویدادی ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            <div className="pagination">
              <button
                disabled={positions.length === 1 || query.isFetching}
                onClick={() => setPositions((v) => v.slice(0, -1))}
              >
                رویدادهای جدیدتر
              </button>
              <span>صفحهٔ {positions.length.toLocaleString('fa-IR')}</span>
              <button
                disabled={!query.data.nextBefore || query.isFetching}
                onClick={() => {
                  if (query.data?.nextBefore) setPositions((v) => [...v, query.data!.nextBefore]);
                }}
              >
                ۵۰ رویداد قدیمی‌تر
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}
