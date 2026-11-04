import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { AdminTable } from '../../components/tables/admin-table';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { orderDigitalJournal as journal } from '../../state/orders/order-digital-journal';
import { orderParcelJournal } from '../../state/orders/order-parcel-journal';
import {
  subscribeShipmentJournal,
  shipmentJournalSnapshot,
} from '../../state/orders/order-shipment-journal';
import {
  digitalBase,
  digitalContentBytes,
  digitalDeliveryInputSchema,
  digitalDeliveryMetadata,
  readAdminDigitalDeliveries,
  type AdminDigitalDeliveryPage,
} from '@sayman/web-shared/lib/orders/order-digital-contract.ts';

const date = (v: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(v));
const blockers: Record<string, string> = {
  payment_not_confirmed: 'پرداخت یا وضعیت مالی مستقل سفارش تأیید نشده است.',
  credit_clearance_required:
    'دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها باید مجوز مالی جاری داشته باشد.',
  reservation_not_allocated: 'موجودی این سفارش هنوز متعهد و تخصیص داده نشده است.',
  delivery_capacity_reached: 'ظرفیت دفعات تحویل این سفارش تمام شده است.',
  complete_serial_assignment_required:
    'دستگاه‌های سریال/IMEI سفارش باید به خطوط درست تخصیص داده شوند.',
};
async function invalidate(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['admin', 'order-digital'] }),
    client.invalidateQueries({ queryKey: ['admin', 'order-parcels'] }),
    client.invalidateQueries({ queryKey: ['admin', 'orders-v2'] }),
    client.invalidateQueries({ queryKey: ['admin', 'order-v2'] }),
    client.invalidateQueries({ queryKey: ['admin', 'credit-clearance'] }),
    client.invalidateQueries({ queryKey: ['admin', 'credit-upfront'] }),
  ]);
}
export function DigitalJournalPanel({
  viewerId,
  writable,
}: {
  viewerId: string;
  writable: boolean;
}) {
  const client = useQueryClient(),
    entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!entry) return null;
  const meta = entry.metadata;
  async function recover() {
    if (!writable || busy) return;
    const revision = adminViewRevision();
    setBusy(true);
    setError('');
    try {
      const result = await api(
        digitalBase(meta.ownerId, meta.orderId) + '/commands/' + meta.commandId,
      );
      if (revision !== adminViewRevision()) return;
      journal.finish(viewerId, meta, result);
      await invalidate(client);
    } catch {
      if (revision === adminViewRevision())
        setError(
          'رسید تأیید نشد. نبودن رسید در این لحظه، مجوز ثبت دوباره نیست؛ همان شناسه را دوباره پیگیری کنید.',
        );
    } finally {
      if (revision === adminViewRevision()) setBusy(false);
    }
  }
  return (
    <section className="panel" role="status">
      <h2>پیگیری فرمان تحویل دیجیتال</h2>
      <p>
        شناسهٔ سفارش: <code dir="ltr">{meta.orderId}</code> · فرمان:{' '}
        <code dir="ltr">{meta.commandId}</code>
      </p>
      <p>
        {entry.state === 'pending'
          ? 'فرمان در حال ثبت است؛ فرمان تازه نفرستید.'
          : entry.state === 'unknown'
            ? 'نتیجه نامعلوم است. فقط رسید همین فرمان خوانده می‌شود؛ ارسال دوباره یا ساخت فرمان جدید مجاز نیست.'
            : entry.state === 'done'
              ? 'رسید تحویل تأیید شد. متن خصوصی در رسید یا این پیگیری نگهداری نشده است.'
              : entry.failure === 'metadata'
                ? 'حجم مشخصات کالا برای تحویل امن بیش از حد مجاز است؛ بررسی فنی لازم است. برای خرید جدید، عنوان و مشخصات تنوع را کوتاه کنید. اصلاح کاتالوگ، مشخصات تاریخی سفارش قبلی را بازنویسی نمی‌کند.'
                : entry.failure === 'capacity'
                  ? 'این تعداد، ظرفیت دفعات تحویل باقیمانده را کافی نگه نمی‌دارد. وضعیت تازه را بگیرید؛ واحدهای بیشتری از مانده را در این نوبت انتخاب کنید و مجموع متن‌ها را زیر ۶۵۵۳۶ بایت نگه دارید. برای سفارش مختلط، ظرفیت بخش فیزیکی هم باید باقی بماند.'
                  : 'سرور این فرمان را رد کرده است. وضعیت تازه را پیش از تلاش بعدی بررسی کنید.'}
      </p>
      {entry.result && (
        <p>
          در حساب مشتری قابل دریافت از {date(entry.result.delivery.availableAt)}؛ این زمان، مشاهدهٔ
          مشتری را تأیید نمی‌کند.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {entry.state === 'unknown' && (
        <button disabled={busy || !writable} onClick={() => void recover()}>
          {busy ? 'در حال بررسی…' : 'دریافت رسید همین فرمان'}
        </button>
      )}
      {['done', 'rejected'].includes(entry.state) && (
        <button
          onClick={() => {
            journal.clear(viewerId);
            setError('');
            void invalidate(client);
          }}
        >
          بستن نتیجه و دریافت وضعیت تازه
        </button>
      )}
      <small>
        فقط مشخصات سفارش، شناسه، نسخه‌ها و تعداد خطوط در حافظهٔ همین نشست نگهداری می‌شوند؛ متن خصوصی
        یا اثر انگشت متن ذخیره نمی‌شود.
      </small>
    </section>
  );
}
export function OrderDigitalDeliveryManager({
  viewerId,
  ownerId,
  orderId,
  writable,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  writable: boolean;
}) {
  const authority = useRef(adminViewRevision()).current,
    client = useQueryClient();
  const [editing, setEditing] = useState<AdminDigitalDeliveryPage | null>(null);
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    ),
    parcel = useSyncExternalStore(
      orderParcelJournal.subscribe,
      () => orderParcelJournal.snapshot(viewerId),
      () => null,
    ),
    single = useSyncExternalStore(
      subscribeShipmentJournal,
      () => shipmentJournalSnapshot(viewerId),
      () => null,
    );
  const query = useQuery({
    queryKey: ['admin', 'order-digital', viewerId, ownerId, orderId],
    queryFn: async ({ signal }) => {
      const p = readAdminDigitalDeliveries(
        await api(digitalBase(ownerId, orderId), { signal }),
        ownerId,
        orderId,
      );
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرده است.');
      return p;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const p = query.data,
    locked = !writable || !!entry || !!parcel || !!single || query.isFetching;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>تحویل خصوصی کالای دیجیتال</h2>
          <p>
            برای هر واحد یک متن یا کد ثبت کنید. تأیید نهایی آن را در حساب همین مشتری قابل دریافت
            می‌کند و موجودی متعهد را خارج می‌کند.
          </p>
        </div>
        <button disabled={query.isFetching || !!editing} onClick={() => void query.refetch()}>
          دریافت وضعیت تازه
        </button>
      </div>
      <details>
        <summary>راهنمای تحویل دیجیتال</summary>
        <p>
          پیش از ارسال، کالا و تعداد، پرداخت یا مجوز مالی چکی و نسخهٔ جاری را بررسی کنید. ثبت نهایی
          برگشت‌پذیر و قابل ویرایش نیست؛ دریافت در حساب به معنی مشاهدهٔ مشتری نیست. سفارش مختلط، بخش
          فیزیکی جدا دارد. هر متن حداکثر ۴۰۹۶ بایت؛ هر فرمان حداکثر ۱۰۰ واحد و مجموع ۶۵۵۳۶ بایت است.
          متن‌ها تنها در فرم باز می‌مانند و پس از بستن یا ارسال پاک می‌شوند.
        </p>
      </details>
      <ErrorBox error={query.error} />
      {query.isPending && <Busy />}
      {p && (
        <>
          {p.containsDemo && <p className="notice">دادهٔ نمونهٔ توسعه</p>}
          <div className="table-wrap">
            <AdminTable>
              <caption>ماندهٔ تحویل دیجیتال همین سفارش</caption>
              <thead>
                <tr>
                  <th>کالا / SKU</th>
                  <th>سفارش</th>
                  <th>قابل دریافت در حساب</th>
                  <th>مانده</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.lineKey}>
                    <td>
                      {l.name}
                      <small>
                        {l.label} · <bdi>{l.sku}</bdi>
                      </small>
                    </td>
                    {[l.ordered, l.available, l.remaining].map((n, i) => (
                      <td key={i}>{n.toLocaleString('fa-IR')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </div>
          {p.blockers.length > 0 && (
            <ul>
              {p.blockers.map((b) => (
                <li key={b}>{blockers[b] ?? 'مانع تحویل: ' + b}</li>
              ))}
            </ul>
          )}
          {p.lines.length > 0 && p.lines.every((l) => l.remaining === 0) && (
            <p className="notice">تمام واحدهای دیجیتال در حساب مشتری قابل دریافت‌اند.</p>
          )}
          <button
            className="primary"
            disabled={locked || !p.canDeliver}
            onClick={() => setEditing(p)}
          >
            آماده‌سازی تحویل دیجیتال
          </button>
          {!!entry && (
            <p className="notice">
              ابتدا نتیجهٔ فرمان قبلی تحویل دیجیتال را در بالای صفحه پیگیری کنید.
            </p>
          )}
          {!!parcel || !!single ? (
            <p className="notice">ابتدا فرمان باز ارسال فیزیکی را تعیین تکلیف کنید.</p>
          ) : null}
          <h3>سابقهٔ قابل دریافت‌شدن در حساب</h3>
          {!p.deliveries.length && <p>هنوز تحویل دیجیتالی ثبت نشده است.</p>}
          {p.deliveries.map((d) => (
            <div className="notice" key={d.id}>
              <p>
                <code dir="ltr">{d.id}</code> · {date(d.availableAt)}
              </p>
              <ul>
                {d.lines.map((l) => (
                  <li key={l.lineKey}>
                    {l.name} · {l.quantity.toLocaleString('fa-IR')} واحد
                  </li>
                ))}
              </ul>
              <small>متن خصوصی از پنل یا رسید خوانده نمی‌شود.</small>
            </div>
          ))}
        </>
      )}
      {editing && (
        <DigitalDeliveryForm
          key={`${viewerId}:${ownerId}:${orderId}`}
          page={editing}
          viewerId={viewerId}
          writable={writable}
          onClose={() => setEditing(null)}
          onChanged={() => void invalidate(client)}
        />
      )}
    </section>
  );
}
function DigitalDeliveryForm({
  page,
  viewerId,
  writable,
  onClose,
  onChanged,
}: {
  page: AdminDigitalDeliveryPage;
  viewerId: string;
  writable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [texts, setTexts] = useState<Record<string, string[]>>({}),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const revision = useRef(adminViewRevision()).current,
    mounted = useRef(true),
    sent = useRef(false);
  const total = Object.values(texts).reduce((n, a) => n + a.length, 0),
    bytes = Object.values(texts)
      .flat()
      .reduce((n, s) => n + Math.max(0, digitalContentBytes(s.replace(/\r\n/g, '\n'))), 0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (sent.current) journal.interrupt();
    };
  }, []);
  function close() {
    setTexts({});
    setReason('');
    setAck(false);
    onClose();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !writable ||
      busy ||
      sent.current ||
      revision !== adminViewRevision() ||
      journal.snapshot(viewerId)
    )
      return;
    let input;
    try {
      input = digitalDeliveryInputSchema.parse({
        ownerId: page.ownerId,
        commandId: crypto.randomUUID().replaceAll('-', ''),
        orderVersion: page.orderVersion,
        inventoryFingerprint: page.inventoryFingerprint,
        reason: reason.trim(),
        acknowledge: ack,
        lines: Object.entries(texts)
          .filter(([, contents]) => contents.length)
          .map(([lineKey, contents]) => ({ lineKey, contents })),
      });
      const meta = digitalDeliveryMetadata(page, input);
      journal.begin(viewerId, meta);
      sent.current = true;
      setBusy(true);
      setError('');
      // Do not retain the request in any journal/query. Erase the draft before the
      // network boundary; uncertainty may only trigger a metadata receipt GET.
      const body = JSON.stringify(input);
      setTexts({});
      setReason('');
      setAck(false);
      input = undefined;
      try {
        const raw = await api(
          digitalBase(meta.ownerId, meta.orderId) + '/commands/' + meta.commandId,
          { method: 'POST', body },
        );
        if (revision === adminViewRevision()) journal.finish(viewerId, meta, raw);
      } catch (e) {
        journal.fail(
          viewerId,
          meta,
          e instanceof ApiError ? e.status : 0,
          e instanceof ApiError ? e.code : 'unknown',
        );
      }
      if (mounted.current && revision === adminViewRevision()) {
        setBusy(false);
        onChanged();
        onClose();
      }
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'digital_delivery_capacity_conflict'
          ? 'ظرفیت دفعات تحویل برای مانده کافی نیست. واحدهای بیشتری را برای این نوبت انتخاب کنید؛ مجموع متن‌ها باید حداکثر ۶۵۵۳۶ بایت بماند. وضعیت تازه و ماندهٔ فیزیکی هم در سرور بررسی می‌شوند.'
          : 'کالا، تعداد، متن‌ها، محدودیت بایت، دلیل و تأیید نهایی را بررسی کنید.',
      );
    }
  }
  return (
    <Modal title="بازبینی و ثبت تحویل دیجیتال" onClose={close} preventClose={busy}>
      <form onSubmit={(e) => void submit(e)} autoComplete="off">
        <p className="notice">
          ثبت نهایی، متن‌ها را فوراً در حساب همین مشتری قابل دریافت می‌کند. امکان بازگردانی یا
          ویرایش این تحویل وجود ندارد.
        </p>
        <p>
          سفارش: <code dir="ltr">{page.orderId}</code> · مشتری: <bdi>{page.ownerId}</bdi>
        </p>
        <fieldset disabled={busy || !writable}>
          {page.lines
            .filter((l) => l.remaining > 0)
            .map((l) => (
              <section key={l.lineKey}>
                <h3>{l.name}</h3>
                <p>
                  {l.label} · <bdi>{l.sku}</bdi> · مانده: {l.remaining.toLocaleString('fa-IR')}
                </p>
                <Field label={`تعداد تحویل ${l.sku} (صفر برای عدم انتخاب)`}>
                  <input
                    type="number"
                    min="0"
                    max={Math.min(
                      l.remaining,
                      Math.max(0, 100 - total + (texts[l.lineKey]?.length ?? 0)),
                    )}
                    value={texts[l.lineKey]?.length ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isInteger(n) || n < 0) return;
                      setTexts((old) => {
                        const own = old[l.lineKey]?.length ?? 0,
                          used = Object.values(old).reduce((sum, values) => sum + values.length, 0),
                          max = Math.min(l.remaining, Math.max(0, 100 - used + own));
                        if (n > max) return old;
                        return {
                          ...old,
                          [l.lineKey]: Array.from(
                            { length: n },
                            (_, i) => old[l.lineKey]?.[i] ?? '',
                          ),
                        };
                      });
                      setAck(false);
                    }}
                  />
                </Field>
                {(texts[l.lineKey] ?? []).map((s, i) => (
                  <Field
                    key={i}
                    label={`متن خصوصی واحد ${(i + 1).toLocaleString('fa-IR')} از ${l.sku}`}
                    hint="متن عادی؛ حداکثر ۴۰۹۶ بایت UTF-8. کد یا نشانی به لینک تبدیل نمی‌شود."
                  >
                    <textarea
                      dir="auto"
                      rows={3}
                      maxLength={4096}
                      value={s}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => {
                        const v = e.target.value;
                        setTexts((old) => ({
                          ...old,
                          [l.lineKey]: old[l.lineKey].map((s, n) => (n === i ? v : s)),
                        }));
                        setAck(false);
                      }}
                      required
                    />
                  </Field>
                ))}
              </section>
            ))}
          <p aria-live="polite">
            {total.toLocaleString('fa-IR')} از ۱۰۰ واحد؛ {bytes.toLocaleString('fa-IR')} از ۶۵۵۳۶
            بایت.
          </p>
          <Field label="دلیل ثبت (بدون درج کد خصوصی)">
            <input
              maxLength={400}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setAck(false);
              }}
              required
            />
          </Field>
          <Check
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            label="کالا، مشتری، تعداد، متن هر واحد و وضعیت مالی را بررسی کردم؛ قابل دریافت‌شدن قطعی در حساب مشتری را تأیید می‌کنم."
          />
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || !writable || !ack || total < 1 || total > 100 || bytes > 65536}
          >
            {busy ? 'در حال ثبت…' : 'تأیید نهایی و تحویل در حساب مشتری'}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            بستن و پاک‌کردن متن‌ها
          </button>
        </div>
      </form>
    </Modal>
  );
}
