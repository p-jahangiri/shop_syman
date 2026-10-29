import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, save } from './api';
import { Busy, ErrorBox, Field, Modal } from './ui';
import { FormActions } from './forms';

interface Policy {
  id: number;
  version: string;
  shippingMode: 'unconfigured' | 'free' | 'flat';
  shippingNameFa: string;
  shippingNameEn: string;
  shippingDescriptionFa: string;
  shippingDescriptionEn: string;
  shippingFeeRial?: string;
  shippingFreeFromRial?: string;
  taxMode: 'unconfigured' | 'exempt' | 'exclusive' | 'inclusive';
  taxRateBasisPoints?: number;
  taxBase: 'items' | 'goods' | 'goods_shipping';
  taxRounding: 'down' | 'up' | 'half_up';
}
const modes = {
  unconfigured: 'هنوز تعیین نشده',
  free: 'ارسال رایگان',
  flat: 'هزینهٔ ثابت برای هر سفارش',
};
const taxes = {
  unconfigured: 'هنوز تعیین نشده',
  exempt: 'بدون مالیات جداگانه',
  exclusive: 'مالیات افزوده به مبلغ',
  inclusive: 'مالیات داخل قیمت',
};
const bases = {
  items: 'جمع اصل کالاها',
  goods: 'کالاها با افزودهٔ طرح چکی',
  goods_shipping: 'کالاها با افزودهٔ طرح و ارسال',
};
const rounding = {
  half_up: 'نزدیک‌ترین ریال؛ نیم به بالا',
  up: 'رو به بالا تا ریال بعد',
  down: 'رو به پایین تا ریال قبل',
};
function digits(value: string) {
  return value
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    )
    .replace(/٫/g, '.')
    .replace(/[٬,\s]/g, '');
}
function rial(value: string, required: boolean) {
  const normal = digits(value);
  if (!normal && !required) return null;
  if (!/^\d{1,19}$/.test(normal) || BigInt(normal) <= 0n || BigInt(normal) > 9223372036854775807n)
    throw new Error('مبلغ باید عدد صحیح مثبت به ریال باشد.');
  return BigInt(normal).toString();
}
function percent(value: string) {
  const normal = digits(value);
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normal))
    throw new Error('درصد را با حداکثر دو رقم اعشار وارد کنید.');
  const [whole, fraction = ''] = normal.split('.');
  const bp = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (bp < 1n || bp > 10000n)
    throw new Error('درصد باید بین ۰٫۰۱ و ۱۰۰ است؛ برای صفر، حالت بدون مالیات را انتخاب کنید.');
  return Number(bp);
}
const amount = (value?: string) =>
  value ? new Intl.NumberFormat('fa-IR').format(BigInt(value)) + ' ریال' : '—';
export function ChargesPage({ writable }: { writable: boolean }) {
  const query = useQuery({
    queryKey: ['admin', 'checkout-charges'],
    queryFn: () => api<Policy>('/admin/checkout-charges'),
    refetchOnWindowFocus: false,
  });
  const [editing, setEditing] = useState<Policy | null>(null);
  if (query.isPending) return <Busy />;
  if (query.error)
    return (
      <>
        <ErrorBox error={query.error} />
        <button onClick={() => void query.refetch()}>تلاش دوباره</button>
      </>
    );
  const p = query.data!;
  const rated = p.taxMode === 'exclusive' || p.taxMode === 'inclusive';
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>هزینه‌های خرید</h2>
            <p>
              تنظیمات ذخیره‌شده روی محاسبه‌های تازه اعمال می‌شوند. محاسبهٔ قبلی تا پایان مهلت، مبلغ
              و شرایط ثبت‌شده را حفظ می‌کند؛ هنگام ثبت سفارش دوباره بررسی خواهد شد.
            </p>
          </div>
          <button className="primary" disabled={!writable} onClick={() => setEditing(p)}>
            ویرایش هزینه‌ها
          </button>
        </div>
        <div className="notice">
          هزینه‌ها با انتخاب صریح شما ذخیره و برای محاسبه‌های تازه استفاده می‌شوند. سفارش موقت از
          بخش سفارش‌ها قابل تنظیم است؛ اتصال درگاه هنوز آماده نیست.
        </div>
        <dl className="charge-details">
          <dt>ارسال فیزیکی</dt>
          <dd>{modes[p.shippingMode]}</dd>
          {p.shippingMode !== 'unconfigured' && (
            <>
              <dt>نام روش</dt>
              <dd>
                {p.shippingNameFa} · {p.shippingNameEn}
              </dd>
              <dt>توضیحات</dt>
              <dd>{p.shippingDescriptionFa || '—'}</dd>
            </>
          )}
          {p.shippingMode === 'flat' && (
            <>
              <dt>هزینهٔ هر سفارش</dt>
              <dd>{amount(p.shippingFeeRial)}</dd>
              <dt>ارسال رایگان از جمع اصل کالا</dt>
              <dd>{amount(p.shippingFreeFromRial)}</dd>
            </>
          )}
          <dt>مالیات</dt>
          <dd>{taxes[p.taxMode]}</dd>
          {rated && (
            <>
              <dt>نرخ</dt>
              <dd>{new Intl.NumberFormat('fa-IR').format(p.taxRateBasisPoints! / 100)}٪</dd>
              <dt>مبنای محاسبه</dt>
              <dd>{bases[p.taxBase]}</dd>
              <dt>گردکردن</dt>
              <dd>{rounding[p.taxRounding]}</dd>
            </>
          )}
        </dl>
        <p className="small">
          سبد تماماً دیجیتال هزینهٔ ارسال فیزیکی ندارد. آستانهٔ ارسال رایگان بر جمع اصل کالاها
          سنجیده می‌شود. زمان تحویل و نرخ وابسته به مقصد/شرکت حمل در مرحلهٔ ارسال تکمیل می‌شوند.
        </p>
      </section>
      {editing && (
        <Modal title="تنظیم ارسال و مالیات" onClose={() => setEditing(null)}>
          <ChargeForm initial={editing} onClose={() => setEditing(null)} />
        </Modal>
      )}
    </>
  );
}
function ChargeForm({ initial, onClose }: { initial: Policy; onClose: () => void }) {
  const [p, set] = useState(initial),
    [fee, setFee] = useState(initial.shippingFeeRial ?? ''),
    [threshold, setThreshold] = useState(initial.shippingFreeFromRial ?? ''),
    [rate, setRate] = useState(
      initial.taxRateBasisPoints === undefined ? '' : String(initial.taxRateBasisPoints / 100),
    ),
    [validation, setValidation] = useState<unknown>();
  const client = useQueryClient();
  const rated = p.taxMode === 'exclusive' || p.taxMode === 'inclusive';
  const mutation = useMutation({
    mutationFn: (value: unknown) => save('/admin/checkout-charges', value, 'PUT'),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    setValidation(undefined);
    try {
      mutation.mutate({
        shippingMode: p.shippingMode,
        shippingNameFa: p.shippingNameFa,
        shippingNameEn: p.shippingNameEn,
        shippingDescriptionFa: p.shippingDescriptionFa,
        shippingDescriptionEn: p.shippingDescriptionEn,
        shippingFeeRial: p.shippingMode === 'flat' ? rial(fee, true) : null,
        shippingFreeFromRial: p.shippingMode === 'flat' ? rial(threshold, false) : null,
        taxMode: p.taxMode,
        taxRateBasisPoints: rated ? percent(rate) : null,
        taxBase: p.taxBase,
        taxRounding: p.taxRounding,
        version: initial.version || null,
      });
    } catch (error) {
      setValidation(error);
    }
  }
  return (
    <form onSubmit={submit}>
      <ErrorBox error={validation ?? mutation.error} />
      <fieldset disabled={mutation.isPending}>
        <legend>ارسال فیزیکی</legend>
        <Field label="سیاست ارسال">
          <select
            value={p.shippingMode}
            onChange={(e) => set({ ...p, shippingMode: e.target.value as Policy['shippingMode'] })}
          >
            {Object.entries(modes).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {p.shippingMode !== 'unconfigured' && (
          <div className="form-grid">
            <Field label="نام روش فارسی">
              <input
                required
                maxLength={200}
                value={p.shippingNameFa}
                onChange={(e) => set({ ...p, shippingNameFa: e.target.value })}
              />
            </Field>
            <Field label="English delivery name">
              <input
                required
                maxLength={200}
                dir="ltr"
                value={p.shippingNameEn}
                onChange={(e) => set({ ...p, shippingNameEn: e.target.value })}
              />
            </Field>
            <Field label="توضیح فارسی">
              <textarea
                maxLength={2000}
                value={p.shippingDescriptionFa}
                onChange={(e) => set({ ...p, shippingDescriptionFa: e.target.value })}
              />
            </Field>
            <Field label="English delivery description">
              <textarea
                maxLength={2000}
                dir="ltr"
                value={p.shippingDescriptionEn}
                onChange={(e) => set({ ...p, shippingDescriptionEn: e.target.value })}
              />
            </Field>
          </div>
        )}
        {p.shippingMode === 'flat' && (
          <div className="form-grid">
            <Field
              label="هزینهٔ هر سفارش (ریال)"
              hint="مبلغ صحیح مثبت؛ این مقدار برای هر سفارش یک بار اعمال می‌شود."
            >
              <input
                required
                inputMode="numeric"
                dir="ltr"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </Field>
            <Field
              label="ارسال رایگان از جمع اصل کالا (ریال، اختیاری)"
              hint="جمع اصل کالا، پیش از افزودهٔ چک و مالیات؛ مرز انتخاب‌شده شامل آستانه است."
            >
              <input
                inputMode="numeric"
                dir="ltr"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </Field>
          </div>
        )}
      </fieldset>
      <fieldset disabled={mutation.isPending}>
        <legend>مالیات</legend>
        <Field label="نحوهٔ محاسبهٔ مالیات">
          <select
            value={p.taxMode}
            onChange={(e) => set({ ...p, taxMode: e.target.value as Policy['taxMode'] })}
          >
            {Object.entries(taxes).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {rated && (
          <div className="form-grid">
            <Field
              label="نرخ مالیات (درصد)"
              hint="نرخ واقعی فروشگاه را با حداکثر دو رقم اعشار وارد کنید."
            >
              <input
                required
                inputMode="decimal"
                dir="ltr"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
            <Field label="مبنای مالیات">
              <select
                value={p.taxBase}
                onChange={(e) => set({ ...p, taxBase: e.target.value as Policy['taxBase'] })}
              >
                {Object.entries(bases).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="گردکردن مبلغ مالیات">
              <select
                value={p.taxRounding}
                onChange={(e) =>
                  set({ ...p, taxRounding: e.target.value as Policy['taxRounding'] })
                }
              >
                {Object.entries(rounding).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {p.taxMode === 'inclusive' && (
          <p className="notice">
            مالیات از مبنای انتخاب‌شده استخراج و در خلاصه نمایش داده می‌شود؛ دوباره به مبلغ پرداخت
            اضافه نمی‌شود.
          </p>
        )}
      </fieldset>
      <FormActions pending={mutation.isPending} onClose={onClose} />
    </form>
  );
}
