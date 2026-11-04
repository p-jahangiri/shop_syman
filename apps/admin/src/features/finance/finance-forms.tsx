import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { Check, ErrorBox, Field } from '../../components/ui';
import { Area } from '../../components/forms/forms';
import { nameOf, type Catalog, type PurchaseMethod, type ChequePlan } from '../../types/types';
import { methodInputSchema, planInputSchema } from '../../api/contracts/finance/finance-contract';
import { FinanceReviewBox } from './finance-review-box';
import { basisPoints, displayPercent, displayRial, percentInput } from '../../utils/finance-inputs';
import { adminViewRevision } from '../../auth/admin-view-authority';
function MissingCatalog({ catalog }: { catalog?: Catalog }) {
  const client = useQueryClient();
  return catalog ? null : (
    <div className="notice">
      فهرست دسته‌ها دریافت نشده؛ برای ذخیره ابتدا آن را بررسی کنید.
      <button
        type="button"
        onClick={() => void client.invalidateQueries({ queryKey: ['admin', 'catalog'] })}
      >
        دریافت دسته‌ها
      </button>
    </div>
  );
}
function CategoryRules({
  catalog,
  value,
  onChange,
}: {
  catalog?: Catalog;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const missing = value.filter((id) => !catalog?.categories.some((c) => c.id === id));
  return (
    <fieldset>
      <legend>محدودیت دسته‌ها</legend>
      <small>
        بدون انتخاب دسته، محدودیت دسته‌ای اعمال نمی‌شود؛ محدودیت مبلغ، روش‌های مجاز کالا و وضعیت
        فعال‌بودن همچنان بررسی می‌شوند.
      </small>
      {!catalog ? (
        <p>انتخاب‌های فعلی تا دریافت فهرست دسته‌ها حفظ می‌شوند.</p>
      ) : (
        <>
          <div className="inline-checks">
            {catalog.categories.map((c) => (
              <Check
                key={c.id}
                label={nameOf(c)}
                checked={value.includes(c.id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, c.id] : value.filter((id) => id !== c.id))
                }
              />
            ))}
          </div>
          {missing.map((id) => (
            <div className="notice" key={id}>
              دستهٔ انتخاب‌شده در فهرست فعلی نیست: <bdi>{id}</bdi>
              <button type="button" onClick={() => onChange(value.filter((v) => v !== id))}>
                حذف این محدودیت
              </button>
            </div>
          ))}
        </>
      )}
    </fieldset>
  );
}
type EditProps = {
  catalog?: Catalog;
  onClose: () => void;
  onBusy?: (value: boolean) => void;
  readOnly?: boolean;
};
type FormErrors = Record<string, string>;
type ValidationIssues = readonly { path: readonly PropertyKey[]; message: string }[];
const methodLabel = { online: 'نقدی آنلاین', cheque: 'چکی', installment: 'اقساط ارائه‌دهنده' };
const fieldErrors = (issues: ValidationIssues): FormErrors =>
  Object.fromEntries(
    issues.map(({ path, message }) => [
      String(path[0] ?? 'form'),
      /^Invalid|^Too (small|big)/.test(message) ? 'مقدار این فیلد را بررسی کنید.' : message,
    ]),
  );
function focusInvalid(form: HTMLFormElement, issues: FormErrors) {
  const first = Object.keys(issues)[0];
  if (first) form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
}
function useConditionSave(
  path: string,
  id: string | undefined,
  onClose: () => void,
  onBusy?: (value: boolean) => void,
) {
  const client = useQueryClient();
  const lock = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const mutation = useMutation({
    mutationFn: async (value: unknown) => {
      const authority = adminViewRevision();
      const stored = await api<{ id?: unknown }>(path, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(value),
      });
      if (
        !stored ||
        typeof stored.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(stored.id) ||
        (id && stored.id.toLowerCase() !== id.toLowerCase())
      )
        throw Error('Invalid purchase condition receipt');
      return authority;
    },
    retry: false,
    onSuccess: async (authority) => {
      if (authority !== adminViewRevision()) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'purchase-page'] }),
        client.invalidateQueries({ queryKey: ['admin', 'purchase-detail'], refetchType: 'none' }),
        client.invalidateQueries({ queryKey: ['admin', 'purchase-summary'] }),
        client.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
      ]);
      if (authority === adminViewRevision()) onClose();
    },
    onError: (e) => {
      if (!(e instanceof ApiError) || [0, 408].includes(e.status) || e.status >= 500)
        setUncertain(true);
    },
    onSettled: () => {
      lock.current = false;
      onBusy?.(false);
    },
  });
  const stale =
    mutation.error instanceof ApiError && [401, 403, 404, 409].includes(mutation.error.status);
  const confirm = (value: unknown) => {
    if (lock.current || uncertain || stale) return;
    lock.current = true;
    onBusy?.(true);
    mutation.mutate(value);
  };
  return { mutation, uncertain, stale, confirm };
}
function ConditionFacts({
  value,
  extra,
}: {
  value: {
    nameFa: string;
    nameEn: string;
    enabled: boolean;
    categoryIds: string[];
    minAmountRial: string | null;
    maxAmountRial: string | null;
  };
  extra: React.ReactNode;
}) {
  return (
    <>
      <p>
        <strong>{value.nameFa}</strong> · <bdi>{value.nameEn}</bdi>
      </p>
      <dl className="finance-facts">
        <dt>خریدهای جدید</dt>
        <dd>{value.enabled ? 'فعال با رعایت شرایط' : 'غیرفعال'}</dd>
        <dt>حداقل مبلغ</dt>
        <dd>{value.minAmountRial === null ? 'بدون حداقل' : displayRial(value.minAmountRial)}</dd>
        <dt>حداکثر مبلغ</dt>
        <dd>{value.maxAmountRial === null ? 'بدون سقف' : displayRial(value.maxAmountRial)}</dd>
        <dt>محدودیت دسته</dt>
        <dd>
          {value.categoryIds.length
            ? `${value.categoryIds.length.toLocaleString('fa-IR')} دسته`
            : 'همهٔ دسته‌ها'}
        </dd>
        {extra}
      </dl>
      <p className="small">تغییر برای خریدهای جدید است. شرایط و سوابق خریدهای قبلی حفظ می‌شوند.</p>
    </>
  );
}
function Actions({
  disabled,
  pending,
  readOnly,
  onClose,
}: {
  disabled: boolean;
  pending: boolean;
  readOnly: boolean;
  onClose: () => void;
}) {
  return (
    <div className="form-actions">
      {!readOnly && (
        <button className="primary" type="submit" disabled={disabled}>
          بازبینی تغییرات
        </button>
      )}
      <button type="button" disabled={pending} onClick={onClose}>
        بستن و بررسی فهرست
      </button>
    </div>
  );
}
function SaveNotice({ uncertain, stale }: { uncertain: boolean; stale: boolean }) {
  return uncertain ? (
    <div className="notice" role="alert">
      نتیجهٔ ذخیره دریافت نشد؛ ممکن است تغییر ثبت شده باشد. این فرم دوباره ارسال نمی‌شود. فرم را
      ببندید و فهرست تازه را بررسی کنید.
    </div>
  ) : stale ? (
    <div className="notice" role="alert">
      شرایط تغییر کرده یا حذف شده‌اند. فرم را ببندید و اطلاعات تازه را دریافت کنید.
    </div>
  ) : null;
}
export function MethodForm({
  item,
  catalog,
  onClose,
  onBusy,
  readOnly = false,
}: EditProps & { item?: PurchaseMethod }) {
  const [v, set] = useState({
    kind: item?.kind ?? 'online',
    nameFa: item?.nameFa ?? '',
    nameEn: item?.nameEn ?? '',
    descriptionFa: item?.descriptionFa ?? '',
    descriptionEn: item?.descriptionEn ?? '',
    enabled: item?.enabled ?? false,
    requiresApproval: item?.requiresApproval ?? false,
    minAmountRial: item?.minAmountRial ?? '',
    maxAmountRial: item?.maxAmountRial ?? '',
    categoryIds: item?.categories.map((c) => c.categoryId) ?? [],
    version: item?.version ?? null,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [review, setReview] = useState<ReturnType<typeof methodInputSchema.parse> | null>(null);
  const { mutation, uncertain, stale, confirm } = useConditionSave(
    `/admin/purchase-methods${item ? `/${item.id}` : ''}`,
    item?.id,
    onClose,
    onBusy,
  );
  const disabled = readOnly || mutation.isPending || uncertain || stale || !catalog;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    const parsed = methodInputSchema.safeParse({
      ...v,
      requiresApproval: v.requiresApproval || v.kind === 'cheque',
    });
    if (!parsed.success) {
      const issues = fieldErrors(parsed.error.issues);
      setErrors(issues);
      focusInvalid(e.currentTarget, issues);
      return;
    }
    setErrors({});
    setReview(parsed.data);
  }
  if (review)
    return (
      <>
        <SaveNotice uncertain={uncertain} stale={stale} />
        <ErrorBox error={uncertain || stale ? undefined : mutation.error} />
        <FinanceReviewBox
          title="بازبینی روش خرید"
          blocked={disabled}
          backBlocked={uncertain || stale}
          pending={mutation.isPending}
          onBack={() => {
            if (!uncertain && !stale) setReview(null);
          }}
          onConfirm={() => confirm(review)}
        >
          <ConditionFacts
            value={review}
            extra={
              <>
                <dt>نوع روش</dt>
                <dd>{methodLabel[review.kind]}</dd>
                <dt>نیاز به تأیید</dt>
                <dd>{review.requiresApproval ? 'دارد' : 'ندارد'}</dd>
              </>
            }
          />
        </FinanceReviewBox>
        {(uncertain || stale) && (
          <button type="button" onClick={onClose}>
            بستن و بررسی فهرست
          </button>
        )}
      </>
    );
  return (
    <form onSubmit={submit} noValidate className="finance-policy-form">
      <ErrorBox
        error={
          errors.form || errors.categoryIds
            ? new Error(errors.form || errors.categoryIds)
            : undefined
        }
      />
      <MissingCatalog catalog={catalog} />
      <fieldset disabled={disabled} className="finance-fields">
        <legend>تنظیمات روش خرید</legend>
        <div className="notice">
          <Check
            name="purchase-method-enabled"
            role="switch"
            label="اجازهٔ استفاده از این روش برای خریدهای جدید"
            checked={v.enabled}
            onChange={(e) => set({ ...v, enabled: e.target.checked })}
          />
          <p role="status">
            {v.enabled
              ? 'با ذخیره، این روش در سطح فروشگاه فعال خواهد بود؛ انتخاب آن برای هر خرید به شرایط کالا، مبلغ، دسته و سرویس مربوط هم وابسته است.'
              : 'با ذخیره، این روش برای خرید جدید قابل انتخاب نخواهد بود؛ سفارش‌ها، برنامه‌های چکی و سوابق قبلی حفظ می‌شوند.'}
          </p>
          <small>
            تغییر کلید فقط پس از ذخیره اعمال می‌شود. برای حذف معرفی و تبلیغ یک نوع خرید، همهٔ
            روش‌های همان نوع را غیرفعال کنید؛ خاموش‌کردن یک روش، روش‌های هم‌نوع دیگر را خاموش
            نمی‌کند.
          </small>
        </div>
        <div className="form-grid">
          <Field label="عنوان فارسی" error={errors.nameFa} required>
            <input
              name="nameFa"
              maxLength={200}
              dir="rtl"
              value={v.nameFa}
              onChange={(e) => {
                set({ ...v, nameFa: e.target.value });
                setErrors((old) => ({ ...old, nameFa: '' }));
              }}
            />
          </Field>
          <Field label="English title" error={errors.nameEn} required>
            <input
              name="nameEn"
              maxLength={200}
              dir="ltr"
              value={v.nameEn}
              onChange={(e) => {
                set({ ...v, nameEn: e.target.value });
                setErrors((old) => ({ ...old, nameEn: '' }));
              }}
            />
          </Field>
          <Field
            label="نوع روش"
            hint="نقدی آنلاین برای درگاه نقدی، چکی برای فروش با چک، و اقساط ارائه‌دهنده برای سرویس اقساطی بیرونی است."
          >
            <select
              value={v.kind}
              onChange={(e) => set({ ...v, kind: e.target.value as PurchaseMethod['kind'] })}
            >
              <option value="online">نقدی آنلاین</option>
              <option value="cheque">چکی</option>
              <option value="installment">اقساط ارائه‌دهنده</option>
            </select>
          </Field>
          <Field label="حداقل مبلغ ریال (اختیاری)" error={errors.minAmountRial}>
            <input
              name="minAmountRial"
              maxLength={32}
              dir="ltr"
              inputMode="numeric"
              value={v.minAmountRial}
              onChange={(e) => {
                set({ ...v, minAmountRial: e.target.value });
                setErrors((old) => ({ ...old, minAmountRial: '' }));
              }}
            />
          </Field>
          <Field label="حداکثر مبلغ ریال (اختیاری)" error={errors.maxAmountRial}>
            <input
              name="maxAmountRial"
              maxLength={32}
              dir="ltr"
              inputMode="numeric"
              value={v.maxAmountRial}
              onChange={(e) => {
                set({ ...v, maxAmountRial: e.target.value });
                setErrors((old) => ({ ...old, maxAmountRial: '' }));
              }}
            />
          </Field>
        </div>
        <Area
          label="توضیح فارسی"
          value={v.descriptionFa}
          onChange={(descriptionFa) => set({ ...v, descriptionFa })}
        />
        <Area
          label="English description"
          value={v.descriptionEn}
          dir="ltr"
          onChange={(descriptionEn) => set({ ...v, descriptionEn })}
        />
        <CategoryRules
          catalog={catalog}
          value={v.categoryIds}
          onChange={(categoryIds) => set({ ...v, categoryIds })}
        />
        <div className="inline-checks">
          <Check
            label="نیازمند تأیید (برای چکی اجباری است)"
            checked={v.requiresApproval || v.kind === 'cheque'}
            disabled={v.kind === 'cheque'}
            onChange={(e) => set({ ...v, requiresApproval: e.target.checked })}
          />
        </div>
        <p className="muted">
          فعال‌بودن این روش، اتصال یا پذیرش درگاه را اثبات نمی‌کند. برای چکی، تأیید اعتبار و مدارک
          جداست؛ اجازهٔ ارسال پس از دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها بررسی می‌شود.
        </p>
      </fieldset>
      <Actions
        disabled={disabled}
        pending={mutation.isPending}
        readOnly={readOnly}
        onClose={onClose}
      />
    </form>
  );
}
export function PlanForm({
  item,
  catalog,
  onClose,
  onBusy,
  readOnly = false,
}: EditProps & { item?: ChequePlan }) {
  const [v, set] = useState({
    nameFa: item?.nameFa ?? '',
    nameEn: item?.nameEn ?? '',
    months: item ? String(item.months) : '',
    markupBasisPoints: item ? percentInput(item.markupBasisPoints) : '',
    downPaymentBasisPoints: item ? percentInput(item.downPaymentBasisPoints) : '',
    intervalMonths: item ? String(item.intervalMonths) : '',
    roundingUnitRial: String(item?.roundingUnitRial ?? 10),
    enabled: item?.enabled ?? false,
    minAmountRial: item?.minAmountRial ?? '',
    maxAmountRial: item?.maxAmountRial ?? '',
    categoryIds: item?.categories.map((c) => c.categoryId) ?? [],
    version: item?.version ?? null,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [review, setReview] = useState<ReturnType<typeof planInputSchema.parse> | null>(null);
  const { mutation, uncertain, stale, confirm } = useConditionSave(
    `/admin/cheque-plans${item ? `/${item.id}` : ''}`,
    item?.id,
    onClose,
    onBusy,
  );
  const disabled = readOnly || mutation.isPending || uncertain || stale || !catalog;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    const issues: FormErrors = {};
    const normalized = { ...v };
    for (const [field, max] of [
      ['markupBasisPoints', 100000],
      ['downPaymentBasisPoints', 10000],
    ] as const) {
      try {
        normalized[field] = String(basisPoints(v[field], 0, max));
      } catch (err) {
        issues[field] = (err as Error).message;
      }
    }
    const parsed = planInputSchema.safeParse(normalized);
    if (!parsed.success || Object.keys(issues).length) {
      const all = { ...(!parsed.success ? fieldErrors(parsed.error.issues) : {}), ...issues };
      setErrors(all);
      focusInvalid(e.currentTarget, all);
      return;
    }
    setErrors({});
    setReview(parsed.data);
  }
  if (review)
    return (
      <>
        <SaveNotice uncertain={uncertain} stale={stale} />
        <ErrorBox error={uncertain || stale ? undefined : mutation.error} />
        <FinanceReviewBox
          title="بازبینی طرح چکی"
          blocked={disabled}
          backBlocked={uncertain || stale}
          pending={mutation.isPending}
          onBack={() => {
            if (!uncertain && !stale) setReview(null);
          }}
          onConfirm={() => confirm(review)}
        >
          <ConditionFacts
            value={review}
            extra={
              <>
                <dt>مدت و فاصلهٔ چک‌ها</dt>
                <dd>
                  {review.months.toLocaleString('fa-IR')} ماه · هر{' '}
                  {review.intervalMonths.toLocaleString('fa-IR')} ماه
                </dd>
                <dt>افزایش کل</dt>
                <dd>{displayPercent(review.markupBasisPoints)}</dd>
                <dt>پیش‌پرداخت</dt>
                <dd>{displayPercent(review.downPaymentBasisPoints)}</dd>
                <dt>گردکردن</dt>
                <dd>{review.roundingUnitRial.toLocaleString('fa-IR')} ریال</dd>
              </>
            }
          />
        </FinanceReviewBox>
        {(uncertain || stale) && (
          <button type="button" onClick={onClose}>
            بستن و بررسی فهرست
          </button>
        )}
      </>
    );
  return (
    <form onSubmit={submit} noValidate className="finance-policy-form">
      <ErrorBox
        error={
          errors.form || errors.categoryIds
            ? new Error(errors.form || errors.categoryIds)
            : undefined
        }
      />
      <MissingCatalog catalog={catalog} />
      <fieldset disabled={disabled} className="finance-fields">
        <legend>تنظیمات طرح چکی</legend>
        <div className="notice">
          <Check
            name="cheque-plan-enabled"
            role="switch"
            label="اجازهٔ انتخاب این طرح برای خریدهای چکی جدید"
            checked={v.enabled}
            onChange={(e) => set({ ...v, enabled: e.target.checked })}
          />
          <p role="status">
            {v.enabled
              ? 'با ذخیره، این طرح برای انتخاب‌های جدید فعال خواهد بود؛ روش چکی فعال و شرایط مجاز همان کالا و خرید هم لازم است.'
              : 'با ذخیره، این طرح از انتخاب‌های جدید خارج می‌شود؛ اقساط و شرایط ثبت‌شدهٔ سفارش‌های قبلی تغییر نمی‌کنند.'}
          </p>
          <small>
            برای توقف کامل معرفی و خرید چکی، در تب روش‌های خرید همهٔ روش‌های نوع «چکی» را غیرفعال
            کنید. غیرفعال‌کردن این طرح، روش چکی یا سایر طرح‌ها را خاموش نمی‌کند.
          </small>
        </div>
        <div className="form-grid">
          <Field label="عنوان فارسی" error={errors.nameFa} required>
            <input
              name="nameFa"
              maxLength={200}
              dir="rtl"
              value={v.nameFa}
              onChange={(e) => {
                set({ ...v, nameFa: e.target.value });
                setErrors((old) => ({ ...old, nameFa: '' }));
              }}
            />
          </Field>
          <Field label="English name" error={errors.nameEn} required>
            <input
              name="nameEn"
              maxLength={200}
              dir="ltr"
              value={v.nameEn}
              onChange={(e) => {
                set({ ...v, nameEn: e.target.value });
                setErrors((old) => ({ ...old, nameEn: '' }));
              }}
            />
          </Field>
          <Field label="مدت (ماه)" error={errors.months} required>
            <input
              name="months"
              maxLength={8}
              dir="ltr"
              inputMode="numeric"
              value={v.months}
              onChange={(e) => {
                set({ ...v, months: e.target.value });
                setErrors((old) => ({ ...old, months: '' }));
              }}
            />
          </Field>
          <Field label="فاصلهٔ چک‌ها (ماه)" error={errors.intervalMonths} required>
            <input
              name="intervalMonths"
              maxLength={8}
              dir="ltr"
              inputMode="numeric"
              value={v.intervalMonths}
              onChange={(e) => {
                set({ ...v, intervalMonths: e.target.value });
                setErrors((old) => ({ ...old, intervalMonths: '' }));
              }}
            />
          </Field>
          <Field label="واحد گردکردن مبالغ">
            <select
              value={v.roundingUnitRial}
              onChange={(e) => set({ ...v, roundingUnitRial: e.target.value })}
            >
              <option value="1">یک ریال</option>
              <option value="10">یک تومان (۱۰ ریال)</option>
            </select>
          </Field>
          <Field
            label="افزایش کل (درصد)"
            error={errors.markupBasisPoints}
            hint="درصد را وارد کنید؛ مثلاً ۱۲٫۵ یعنی ۱۲٫۵ درصد."
            required
          >
            <input
              name="markupBasisPoints"
              maxLength={8}
              dir="ltr"
              inputMode="decimal"
              value={v.markupBasisPoints}
              onChange={(e) => {
                set({ ...v, markupBasisPoints: e.target.value });
                setErrors((old) => ({ ...old, markupBasisPoints: '' }));
              }}
            />
          </Field>
          <Field
            label="پیش‌پرداخت (درصد)"
            error={errors.downPaymentBasisPoints}
            hint="درصد را وارد کنید؛ مثلاً ۱۲٫۵ یعنی ۱۲٫۵ درصد."
            required
          >
            <input
              name="downPaymentBasisPoints"
              maxLength={8}
              dir="ltr"
              inputMode="decimal"
              value={v.downPaymentBasisPoints}
              onChange={(e) => {
                set({ ...v, downPaymentBasisPoints: e.target.value });
                setErrors((old) => ({ ...old, downPaymentBasisPoints: '' }));
              }}
            />
          </Field>
          <Field label="حداقل مبلغ ریال" error={errors.minAmountRial}>
            <input
              name="minAmountRial"
              maxLength={32}
              dir="ltr"
              inputMode="numeric"
              value={v.minAmountRial}
              onChange={(e) => {
                set({ ...v, minAmountRial: e.target.value });
                setErrors((old) => ({ ...old, minAmountRial: '' }));
              }}
            />
          </Field>
          <Field label="حداکثر مبلغ ریال" error={errors.maxAmountRial}>
            <input
              name="maxAmountRial"
              maxLength={32}
              dir="ltr"
              inputMode="numeric"
              value={v.maxAmountRial}
              onChange={(e) => {
                set({ ...v, maxAmountRial: e.target.value });
                setErrors((old) => ({ ...old, maxAmountRial: '' }));
              }}
            />
          </Field>
        </div>
        <CategoryRules
          catalog={catalog}
          value={v.categoryIds}
          onChange={(categoryIds) => set({ ...v, categoryIds })}
        />
        <p className="notice">
          شرایط عددی را مدیر تعیین می‌کند؛ گردش مدارک، تأیید اعتبار و وصول چک جدا تکمیل می‌شود.
        </p>
      </fieldset>
      <Actions
        disabled={disabled}
        pending={mutation.isPending}
        readOnly={readOnly}
        onClose={onClose}
      />
    </form>
  );
}
