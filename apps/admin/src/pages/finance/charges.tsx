import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, RefreshCw, Truck } from 'lucide-react';
import { api, ApiError, save } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, ErrorBox, Field, Modal } from '../../components/ui';
import { FinanceReviewBox } from '../../features/finance/finance-review-box';
import { displayPercent, displayRial, percentInput } from '../../utils/finance-inputs';
import {
  isRated,
  prepareCharges,
  readChargePolicy,
  sameChargeValues,
  shippingModes,
  taxModes,
  taxBases,
  taxRounding,
  type ChargeDraft,
  type ChargeInput,
} from '../../api/contracts/finance/checkout-charge-contract';
import '../../styles/finance/finance-workspace.css';

const key = ['admin', 'checkout-charges'];
const path = '/admin/checkout-charges';

function PolicyCards({
  policy: p,
  reviewCopy = false,
}: {
  policy: ChargeInput;
  reviewCopy?: boolean;
}) {
  return (
    <div className="finance-cards">
      <article className="finance-card">
        <h3>
          <Truck size={19} aria-hidden="true" /> ارسال سفارش فیزیکی
        </h3>
        <span
          className="finance-status"
          data-tone={p.shippingMode === 'unconfigured' ? 'attention' : 'good'}
        >
          {shippingModes[p.shippingMode]}
        </span>
        {p.shippingMode !== 'unconfigured' && (
          <>
            <p>
              <strong>{p.shippingNameFa}</strong> · <bdi>{p.shippingNameEn}</bdi>
            </p>
          </>
        )}
        {p.shippingMode === 'flat' && (
          <dl className="finance-facts">
            <dt>دریافت فروشگاه برای هر سفارش</dt>
            <dd>{displayRial(p.shippingFeeRial)}</dd>
            <dt>رایگان از جمع اصل کالا</dt>
            <dd>{p.shippingFreeFromRial ? displayRial(p.shippingFreeFromRial) : 'آستانه ندارد'}</dd>
          </dl>
        )}
        {p.shippingMode === 'postpaid' && (
          <p>
            هزینهٔ حمل را حمل‌کننده تعیین و جداگانه دریافت می‌کند. مبلغ حمل در جمع پرداختی فروشگاه
            نیست.
          </p>
        )}
        {p.shippingMode === 'free' && <p>فروشگاه برای ارسال مبلغی از مشتری دریافت نمی‌کند.</p>}
        {p.shippingMode !== 'unconfigured' &&
          (p.shippingDescriptionFa || p.shippingDescriptionEn) && (
            <details className="finance-policy-copy" open={reviewCopy || undefined}>
              <summary>متن نمایش در فروشگاه</summary>
              {p.shippingDescriptionFa && (
                <p lang="fa" dir="rtl">
                  {p.shippingDescriptionFa}
                </p>
              )}
              {p.shippingDescriptionEn && (
                <p lang="en" dir="ltr">
                  {p.shippingDescriptionEn}
                </p>
              )}
            </details>
          )}
      </article>
      <article className="finance-card">
        <h3>
          <Calculator size={19} aria-hidden="true" /> مالیات قیمت سفارش
        </h3>
        <span
          className="finance-status"
          data-tone={p.taxMode === 'unconfigured' ? 'attention' : 'good'}
        >
          {taxModes[p.taxMode]}
        </span>
        {p.taxRateBasisPoints !== null && (
          <dl className="finance-facts">
            <dt>نرخ</dt>
            <dd>{displayPercent(p.taxRateBasisPoints)}</dd>
            <dt>مبنا</dt>
            <dd>{taxBases[p.taxBase]}</dd>
            <dt>گردکردن</dt>
            <dd>{taxRounding[p.taxRounding]}</dd>
          </dl>
        )}
        {p.taxMode === 'included_unitemized' && (
          <p>نرخ و مبلغ جداگانه اعلام نمی‌شود. این انتخاب معافیت یا نرخ صفر نیست.</p>
        )}
      </article>
    </div>
  );
}

export function ChargesPage({ writable }: { writable: boolean }) {
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => readChargePolicy(await api(path, { signal })),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [editing, setEditing] = useState<ChargeInput | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section className="panel finance-workspace">
      <div className="finance-section-head">
        <div>
          <h2>هزینه‌های خرید</h2>
          <p>سیاست جاری ارسال و مالیات برای محاسبه‌های تازهٔ فروشگاه.</p>
        </div>
        <div className="row-buttons">
          <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw size={16} aria-hidden="true" /> تازه‌سازی
          </button>
          {writable && (
            <button
              type="button"
              className="primary"
              disabled={!query.data || query.isFetching || !!query.error}
              onClick={() => {
                if (query.data) setEditing(query.data);
              }}
            >
              ویرایش هزینه‌ها
            </button>
          )}
        </div>
      </div>
      {query.isPending && <Busy />}
      <ErrorBox error={query.error} />
      {query.data && <PolicyCards policy={query.data} />}
      {!writable && <p className="small">دسترسی شما فقط برای مشاهدهٔ سیاست فعلی است.</p>}
      <details className="notice">
        <summary>اثر این تنظیمات بر محاسبه و سفارش</summary>
        <ul>
          <li>
            سبد تماماً دیجیتال هزینهٔ ارسال فیزیکی ندارد. آستانهٔ رایگان بر جمع اصل کالا سنجیده
            می‌شود.
          </li>
          <li>مبلغ ناشناختهٔ پس‌کرایه وارد مبنای مالیات یا جمع دریافتی فروشگاه نمی‌شود.</li>
          <li>
            تغییر برای محاسبه‌های تازه است؛ هنگام ثبت سفارش، نسخهٔ محاسبه دوباره بررسی می‌شود.
          </li>
        </ul>
      </details>
      {editing && (
        <Modal title="تنظیم ارسال و مالیات" preventClose={pending} onClose={() => setEditing(null)}>
          <ChargeForm initial={editing} onBusy={setPending} onClose={() => setEditing(null)} />
        </Modal>
      )}
    </section>
  );
}

const fieldNames = [
  ['shippingNameFa', 'نام روش فارسی', 'rtl'],
  ['shippingNameEn', 'نام روش انگلیسی', 'ltr'],
] as const;
const descriptions = [
  ['shippingDescriptionFa', 'توضیح فارسی', 'rtl'],
  ['shippingDescriptionEn', 'توضیح انگلیسی', 'ltr'],
] as const;

function ChargeForm({
  initial,
  onBusy,
  onClose,
}: {
  initial: ChargeInput;
  onBusy: (value: boolean) => void;
  onClose: () => void;
}) {
  const { shippingFeeRial, shippingFreeFromRial, taxRateBasisPoints, version, ...rules } = initial;
  const [draft, setDraft] = useState<ChargeDraft>(() => ({
    ...rules,
    fee: shippingFeeRial ?? '',
    threshold: shippingFreeFromRial ?? '',
    rate: taxRateBasisPoints === null ? '' : percentInput(taxRateBasisPoints),
  }));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ChargeDraft, string>>>({});
  const [review, setReview] = useState<ChargeInput | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'stale' | 'uncertain'>('idle');
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const client = useQueryClient();
  const blocked = status !== 'idle';
  const rated = isRated(draft.taxMode);
  function set<K extends keyof ChargeDraft>(name: K, value: ChargeDraft[K]) {
    setDraft((d) => ({ ...d, [name]: value }));
    setFieldErrors((errors) => ({ ...errors, [name]: undefined }));
    setError(null);
  }
  function prepare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked || review || lock.current) return;
    const result = prepareCharges(draft, version);
    setFieldErrors(result.errors);
    if (!result.value) {
      const field = Object.keys(result.errors)[0];
      if (field) e.currentTarget.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      else setError(new Error('حدود طول و مقادیر فرم را بررسی کنید.'));
      return;
    }
    if (sameChargeValues(initial, result.value)) {
      setError(new Error('تنظیمات تغییری نکرده‌اند.'));
      return;
    }
    setError(null);
    setReview(result.value);
  }
  async function confirm() {
    if (!review || blocked || lock.current) return;
    lock.current = true;
    onBusy(true);
    setStatus('pending');
    setError(null);
    const authority = adminViewRevision();
    try {
      const stored = readChargePolicy(await save(path, review, 'PUT'));
      if (!stored.version || stored.version === review.version || !sameChargeValues(review, stored))
        throw Error('Saved policy did not match the submitted revision');
      if (authority !== adminViewRevision()) return;
      await client.invalidateQueries({ queryKey: key });
      if (authority === adminViewRevision()) onClose();
    } catch (cause) {
      if (authority !== adminViewRevision()) return;
      if (cause instanceof ApiError && [401, 403, 404, 409].includes(cause.status))
        setStatus('stale');
      else if (
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        cause.status !== 408
      ) {
        setStatus('idle');
        setReview(null);
        setError(cause);
      } else setStatus('uncertain');
    } finally {
      lock.current = false;
      onBusy(false);
    }
  }
  return (
    <>
      <ErrorBox error={error} />
      {(status === 'stale' || status === 'uncertain') && (
        <div className="notice" role="alert">
          <p>
            {status === 'stale'
              ? 'نسخه یا دسترسی تغییر کرده است. برای جلوگیری از بازنویسی، آخرین وضعیت را دوباره بخوانید.'
              : 'نتیجهٔ ثبت مشخص نیست. درخواست دوباره ارسال نمی‌شود؛ اول سیاست ذخیره‌شده را بررسی کنید.'}
          </p>
          <button
            type="button"
            onClick={() => {
              void client.invalidateQueries({ queryKey: key });
              onClose();
            }}
          >
            بستن و دریافت وضعیت جاری
          </button>
        </div>
      )}
      {review ? (
        <FinanceReviewBox
          title="بازبینی پیش از اعمال هزینه‌ها"
          blocked={blocked}
          backBlocked={blocked}
          pending={status === 'pending'}
          onBack={() => {
            if (!blocked) setReview(null);
          }}
          onConfirm={() => void confirm()}
        >
          <p>
            ارسال:{' '}
            <strong>
              {shippingModes[initial.shippingMode]} ← {shippingModes[review.shippingMode]}
            </strong>{' '}
            · مالیات:{' '}
            <strong>
              {taxModes[initial.taxMode]} ← {taxModes[review.taxMode]}
            </strong>
          </p>
          <PolicyCards policy={review} reviewCopy />
          <p>این تغییر برای محاسبه‌های تازه اعمال می‌شود.</p>
        </FinanceReviewBox>
      ) : (
        <form className="finance-policy-form" onSubmit={prepare} noValidate>
          <fieldset disabled={blocked}>
            <legend>۱. ارسال فیزیکی</legend>
            <Field label="سیاست ارسال">
              <select
                value={draft.shippingMode}
                onChange={(e) => set('shippingMode', e.target.value as ChargeDraft['shippingMode'])}
              >
                {Object.entries(shippingModes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {draft.shippingMode !== 'unconfigured' && (
              <div className="form-grid">
                {fieldNames.map(([name, label, dir]) => (
                  <Field key={name} label={label} error={fieldErrors[name]} required>
                    <input
                      name={name}
                      dir={dir}
                      value={draft[name]}
                      maxLength={200}
                      onChange={(e) => set(name, e.target.value)}
                    />
                  </Field>
                ))}
                {descriptions.map(([name, label, dir]) => (
                  <Field key={name} label={label}>
                    <textarea
                      name={name}
                      dir={dir}
                      value={draft[name]}
                      maxLength={2000}
                      onChange={(e) => set(name, e.target.value)}
                    />
                  </Field>
                ))}
              </div>
            )}
            {draft.shippingMode === 'flat' && (
              <div className="form-grid">
                <Field label="هزینهٔ هر سفارش (ریال)" error={fieldErrors.fee} required>
                  <input
                    name="fee"
                    inputMode="numeric"
                    dir="ltr"
                    maxLength={32}
                    value={draft.fee}
                    onChange={(e) => set('fee', e.target.value)}
                  />
                </Field>
                <Field
                  label="ارسال رایگان از مبلغ (ریال، اختیاری)"
                  hint="مبنای آستانه، جمع اصل کالاهاست."
                  error={fieldErrors.threshold}
                >
                  <input
                    name="threshold"
                    inputMode="numeric"
                    dir="ltr"
                    maxLength={32}
                    value={draft.threshold}
                    onChange={(e) => set('threshold', e.target.value)}
                  />
                </Field>
              </div>
            )}
            {draft.shippingMode === 'postpaid' && (
              <p className="notice">
                مبلغ حمل را مشتری جداگانه به حمل‌کننده می‌پردازد. هزینهٔ ثابت و آستانهٔ رایگان ذخیره
                نمی‌شوند.
              </p>
            )}
          </fieldset>
          <fieldset disabled={blocked}>
            <legend>۲. مالیات</legend>
            <Field label="نحوهٔ محاسبه">
              <select
                value={draft.taxMode}
                onChange={(e) => {
                  const next = e.target.value as ChargeDraft['taxMode'];
                  set('taxMode', next);
                  if (!isRated(next)) set('rate', '');
                }}
              >
                {Object.entries(taxModes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {rated && (
              <div className="form-grid">
                <Field
                  label="نرخ (درصد)"
                  hint="حداکثر دو رقم اعشار، مثلاً ۹٫۲۵"
                  required
                  error={fieldErrors.rate}
                >
                  <input
                    name="rate"
                    inputMode="decimal"
                    dir="ltr"
                    maxLength={8}
                    value={draft.rate}
                    onChange={(e) => set('rate', e.target.value)}
                  />
                </Field>
                <Field label="مبنا">
                  <select
                    value={draft.taxBase}
                    onChange={(e) => set('taxBase', e.target.value as ChargeDraft['taxBase'])}
                  >
                    {Object.entries(taxBases).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="گردکردن">
                  <select
                    value={draft.taxRounding}
                    onChange={(e) =>
                      set('taxRounding', e.target.value as ChargeDraft['taxRounding'])
                    }
                  >
                    {Object.entries(taxRounding).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            {draft.taxMode === 'included_unitemized' && (
              <p className="notice">
                مالیات دیگری اضافه نمی‌شود و نرخ یا مبلغ تفکیک‌شده ذخیره نمی‌شود.
              </p>
            )}
            {draft.taxMode === 'inclusive' && (
              <p className="notice">
                سهم مالیات از قیمت موجود استخراج می‌شود و دوباره به جمع پرداخت اضافه نمی‌شود.
              </p>
            )}
          </fieldset>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              انصراف
            </button>
            <button type="submit" className="primary" disabled={blocked}>
              بازبینی تغییرات
            </button>
          </div>
        </form>
      )}
    </>
  );
}
