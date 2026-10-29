import { AdminTable } from './admin-table';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { adminViewRevision } from './admin-view-authority';
import { Busy, Check, ErrorBox, Field } from './ui';
import {
  stockApplyInputSchema,
  stockApplicationSchema,
  type StockPreview,
  type StockApplication,
  stockApplyIssues,
} from './accounting-stock-contract';
import {
  subscribeStockJournal,
  stockJournalSnapshot,
  clearStockJournal,
} from './accounting-stock-journal';
import { sendStockApplication, recoverStockApplication } from './accounting-stock-actions';
export const stockIssueText: Record<(typeof stockApplyIssues)[number], string> = {
  warehouse_mapping_required: 'نگاشت انبار لازم است',
  warehouse_mapping_inactive: 'نگاشت انبار غیرفعال است',
  available_quantity_requires_reconciliation:
    'این مقدار، موجودی پس از تعهدات است؛ فایل ماندهٔ فیزیکی لازم است',
  quantity_meaning_unknown: 'معنای مانده مشخص نیست',
  item_mapping_required: 'کالا نگاشت فعال ندارد',
  mapped_sku_not_eligible: 'SKU فعال و فیزیکی نیست',
  unit_mapping_required: 'نگاشت واحد همین منبع و SKU لازم است',
  accounting_quantity_invalid: 'قالب مقدار خام قابل استفاده نیست',
  accounting_quantity_conversion: 'تبدیل دقیق به تعداد صحیح ممکن نیست',
  tracked_stock_requires_serial_receipt: 'گردش سریال/IMEI لازم است',
  single_unit_requires_inspection_flow: 'از گردش همان دستگاه کارکرده استفاده کنید',
  stock_moved_since_observation: 'پس از مشاهدهٔ فایل، گردش انبار ثبت شده؛ فایل تازه لازم است',
  stock_below_commitments: 'مانده از مجموع رزروهای سفارش و تأمین کمتر است',
  quantity_missing: 'تعداد در فایل مشخص نیست',
  accounting_observation_future: 'زمان مشاهدهٔ فایل هنوز در آینده است',
  accounting_batch_row_applied: 'این ردیف قبلاً اعمال شده است',
  accounting_catalog_conflict: 'نسخه یا هویت فعلی SKU قابل تأیید نیست',
  accounting_observation_not_newer: 'زمان این فایل از آخرین اعمال همین SKU جدیدتر نیست',
  accounting_duplicate_sku: 'چند ردیف به یک SKU متصل‌اند',
  accounting_stock_delta_limit: 'اندازهٔ اصلاح از سقف فنی یک میلیون واحد بیشتر است',
};
const useStockJournal = (owner: string) =>
  useSyncExternalStore(
    subscribeStockJournal,
    () => stockJournalSnapshot(owner),
    () => null,
  );
const count = (n: number) => n.toLocaleString('fa-IR'),
  date = (v: string) => new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });

export function AccountingStockResult({ result }: { result: StockApplication }) {
  return (
    <div>
      <p className="notice">
        این رسید، وضعیت تاریخی هنگام اعمال است؛ مانده و رزرو فعلی را جدا بازخوانی کنید. قیمت و
        محتوای کالا با این فرمان تغییر نمی‌کنند.
      </p>
      <p>
        سند اعمال: <code dir="ltr">{result.id}</code> · فرمان:{' '}
        <code dir="ltr">{result.commandId}</code>
      </p>
      <p>
        فایل: <bdi>{result.batchId}</bdi> · مشاهده: {date(result.observedAt)} · اعمال:{' '}
        {date(result.appliedAt)}
      </p>
      <p>{result.reason}</p>
      <div className="table-wrap" role="region" aria-label="رسید اعمال موجودی هلو" tabIndex={0}>
        <AdminTable>
          <thead>
            <tr>
              <th>ردیف / SKU</th>
              <th>تبدیل منبع</th>
              <th>فیزیکی قبل / بعد</th>
              <th>رزرو سفارش / تأمین</th>
              <th>تغییر / گردش</th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line) => (
              <tr key={line.rowNumber}>
                <td>
                  {count(line.rowNumber)} · <bdi>{line.sku}</bdi>
                  <small>{line.nameFa}</small>
                </td>
                <td>
                  <bdi>
                    {line.sourceQuantity} × {line.numerator}/{line.denominator}
                  </bdi>
                  <small>
                    <bdi>
                      {line.externalItemId} / {line.externalUnitKey}
                    </bdi>
                  </small>
                </td>
                <td>
                  <bdi>
                    {count(line.beforeOnHand)} → {count(line.afterOnHand)}
                  </bdi>
                </td>
                <td>
                  <bdi>
                    {count(line.reserved)} / {count(line.sourcingReserved)}
                  </bdi>
                </td>
                <td>
                  {count(line.delta)}
                  <small>
                    {line.movementId ? (
                      <>
                        <span>گردش انبار: </span>
                        <bdi>{line.movementId}</bdi>
                      </>
                    ) : (
                      'بدون تغییر مقدار؛ گردش اضافه ثبت نشده'
                    )}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </div>
    </div>
  );
}

export function AccountingStockCommandPanel({
  viewerId,
  writable,
  inline = false,
}: {
  viewerId: string;
  writable: boolean;
  inline?: boolean;
}) {
  const entry = useStockJournal(viewerId),
    client = useQueryClient();
  const [batch, setBatch] = useState(''),
    [command, setCommand] = useState(''),
    [history, setHistory] = useState<StockApplication | null>(null),
    [error, setError] = useState<unknown>(),
    [reading, setReading] = useState(false);
  useEffect(() => {
    if (!entry || entry.state === 'done' || entry.state === 'rejected') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [entry]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'holoo-stock-preview'] });
    void client.invalidateQueries({ queryKey: ['admin', 'inventory'] });
    void client.invalidateQueries({ queryKey: ['admin', 'inventory-history'] });
    void client.invalidateQueries({ queryKey: ['admin', 'inventory-summary'] });
  };
  async function lookup() {
    const revision = adminViewRevision();
    setError(undefined);
    setReading(true);
    try {
      if (!/^[a-f0-9]{32}$/.test(batch) || !/^([a-f0-9]{32})$/.test(command))
        throw Error('شناسهٔ فایل و فرمان باید UUID بدون خط تیره باشند.');
      const value = stockApplicationSchema.parse(
        await api<unknown>(
          '/admin/accounting/holoo/imports/' + batch + '/stock-commands/' + command,
        ),
      );
      if (value.batchId !== batch || value.commandId !== command)
        throw Error('رسید به شناسه‌های واردشده تعلق ندارد.');
      if (adminViewRevision() === revision) setHistory(value);
    } catch (error) {
      if (adminViewRevision() === revision) setError(error);
    } finally {
      if (adminViewRevision() === revision) setReading(false);
    }
  }
  return (
    <section className="panel">
      <h2>رسید و پیگیری اصلاح موجودی هلو</h2>
      {entry && (
        <div className="notice" role="status">
          <strong>
            {entry.state === 'done'
              ? 'اعمال موجودی با رسید سرور تأیید شد.'
              : entry.state === 'rejected'
                ? 'فرمان اعمال موجودی پذیرفته نشد.'
                : entry.state === 'pending'
                  ? 'در حال پیگیری همان فرمان موجودی…'
                  : 'نتیجهٔ اعمال موجودی هنوز مشخص نیست.'}
          </strong>
          <p>
            شناسهٔ فایل: <code dir="ltr">{entry.command.batchId}</code> · فرمان:{' '}
            <code dir="ltr">{entry.command.input.commandId}</code>
          </p>
          {entry.message && <p>{entry.message}</p>}
          {entry.result ? (
            <>
              <AccountingStockResult result={entry.result} />
              <button
                onClick={() => {
                  refresh();
                  clearStockJournal(viewerId);
                }}
              >
                بازخوانی وضعیت و آماده‌کردن انتخاب تازه
              </button>
            </>
          ) : entry.state === 'rejected' ? (
            <button
              onClick={() => {
                refresh();
                clearStockJournal(viewerId);
              }}
            >
              بازخوانی برای اصلاح انتخاب‌ها
            </button>
          ) : (
            <>
              <p>
                ردیف‌ها، نسخه‌ها و شناسهٔ همین فرمان در حافظهٔ تب و فقط برای همین حساب محفوظ‌اند.
                پیش از دریافت رسید، فرمان تازه نسازید. بستن تب یا خروج این بدنه را پاک می‌کند؛
                شناسه‌ها را برای خواندن رسید نگه دارید.
              </p>
              <div className="row-buttons">
                <button
                  disabled={entry.state === 'pending' || !writable}
                  onClick={() => void recoverStockApplication(viewerId, entry.command)}
                >
                  رسید همین اعمال موجودی
                </button>
                <button
                  disabled={entry.state === 'pending' || !writable}
                  onClick={() => void sendStockApplication(viewerId, entry.command)}
                >
                  ارسال دقیق همان اعمال موجودی
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {writable && !inline && (
        <details>
          <summary>خواندن رسید تاریخی با شناسهٔ فایل و فرمان</summary>
          <ErrorBox error={error} />
          <Field label="شناسهٔ فایل برای رسید موجودی">
            <input
              dir="ltr"
              maxLength={32}
              value={batch}
              disabled={reading}
              onChange={(e) => {
                setBatch(e.target.value);
                setHistory(null);
              }}
            />
          </Field>
          <Field label="شناسهٔ فرمان اعمال موجودی">
            <input
              dir="ltr"
              maxLength={32}
              value={command}
              disabled={reading}
              onChange={(e) => {
                setCommand(e.target.value);
                setHistory(null);
              }}
            />
          </Field>
          <button disabled={reading} onClick={() => void lookup()}>
            خواندن رسید تاریخی موجودی
          </button>
          {reading ? <Busy /> : history && <AccountingStockResult result={history} />}
        </details>
      )}
    </section>
  );
}

export function AccountingStockControls({
  viewerId,
  writable,
  preview,
  fresh,
}: {
  viewerId: string;
  writable: boolean;
  preview: StockPreview;
  fresh: boolean;
}) {
  const entry = useStockJournal(viewerId),
    [selected, setSelected] = useState<number[]>([]),
    [reason, setReason] = useState(''),
    [physical, setPhysical] = useState(false),
    [unposted, setUnposted] = useState(false),
    [error, setError] = useState<unknown>();
  function changed() {
    setPhysical(false);
    setUnposted(false);
  }
  function submit() {
    try {
      if (!writable || !fresh || entry) return;
      const input = stockApplyInputSchema.parse({
        commandId: crypto.randomUUID().replaceAll('-', ''),
        previewFingerprint: preview.fingerprint,
        rowNumbers: selected,
        reason,
        acknowledgeWholeStorePhysical: physical,
        acknowledgeUnpostedSalesReconciled: unposted,
      });
      void sendStockApplication(
        viewerId,
        { batchId: preview.reconciliation.batchId, input, preview },
        true,
      );
    } catch (error) {
      setError(error);
    }
  }
  return (
    <section>
      <h4>انتخاب صریح ردیف‌ها برای اصلاح ماندهٔ فیزیکی</h4>
      <p>
        این فرمان موجودی سایت را با فایل بررسی‌شده تطبیق می‌دهد. ارسال یا ثبت سند در هلو انجام
        نمی‌شود. ردیف غایب یا نامشخص به صفر تبدیل نمی‌شود؛ قیمت، محتوا و رزروها تغییر نمی‌کنند.
      </p>
      <p>
        شناسهٔ فایل برای پیگیری: <code dir="ltr">{preview.reconciliation.batchId}</code>
      </p>
      <ErrorBox error={error} />
      <fieldset disabled={!writable || !fresh || !!entry}>
        <legend>ردیف‌های همین فایل</legend>
        {preview.candidates.map((candidate) => {
          const row = preview.reconciliation.rows.find((x) => x.rowNumber === candidate.rowNumber)!;
          return (
            <div key={candidate.rowNumber} className="sourcing-request-line">
              <Check
                label={`ردیف ${count(candidate.rowNumber)} · ${row.match?.sku ?? row.externalItemId} · اصلاح ${row.delta === null ? 'نامشخص' : count(row.delta)} واحد`}
                disabled={!candidate.canApply}
                checked={selected.includes(candidate.rowNumber)}
                onChange={(e) => {
                  setSelected((v) =>
                    e.target.checked
                      ? [...v, candidate.rowNumber]
                      : v.filter((n) => n !== candidate.rowNumber),
                  );
                  changed();
                }}
              />
              {candidate.issues.map((issue) => (
                <small key={issue}>{stockIssueText[issue]}</small>
              ))}
              {candidate.priorApplicationId && (
                <small>
                  سند اعمال قبلی: <bdi>{candidate.priorApplicationId}</bdi>
                </small>
              )}
            </div>
          );
        })}
        <Field label="دلیل اصلاح ماندهٔ فیزیکی">
          <textarea
            rows={3}
            maxLength={400}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              changed();
            }}
          />
        </Field>
        <Check
          label="فایل این ردیف‌ها را با ماندهٔ فیزیکی واقعی و کامل فروشگاه تطبیق داده‌ام؛ موجودی پس از تعهدات یا ماندهٔ یک انبار جزئی نیست."
          checked={physical}
          onChange={(e) => setPhysical(e.target.checked)}
        />
        <Check
          label="اثر فروش‌ها و عملیات ثبت‌نشده در منبع هلو را بررسی و در ماندهٔ این فایل تطبیق داده‌ام."
          checked={unposted}
          onChange={(e) => setUnposted(e.target.checked)}
        />
        <button
          className="primary"
          disabled={
            !selected.length || !physical || !unposted || !reason.trim() || !preview.canApplyManual
          }
          onClick={submit}
        >
          اعمال {count(selected.length)} ردیف انتخاب‌شده روی موجودی سایت
        </button>
      </fieldset>
      {entry && (
        <p role="status">
          فرمان موجودی در بخش «رسید و پیگیری اصلاح موجودی هلو» همین صفحه محفوظ است؛ ابتدا نتیجهٔ
          همان فرمان را پیگیری کنید.
        </p>
      )}
      {!writable && <p>برای اصلاح، مجوز نوشتن انبار لازم است.</p>}
      {!fresh && (
        <p className="notice">پیش‌نمایش تازه و بدون خطا را پیش از تأیید اصلاح دریافت کنید.</p>
      )}
    </section>
  );
}
