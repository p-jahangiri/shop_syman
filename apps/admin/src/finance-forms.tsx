import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { Check, ErrorBox, Field } from './ui';
import { Text, Area } from './forms';
import { nameOf, type Catalog, type PurchaseMethod, type ChequePlan } from './types';
import { methodInputSchema, planInputSchema } from './finance-contract';
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
function useConditionSave(path: string, onClose: () => void) {
  const client = useQueryClient();
  const [uncertain, setUncertain] = useState(false);
  const mutation = useMutation({
    mutationFn: (value: unknown) =>
      api(path, {
        method: path.split('/').length > 3 ? 'PUT' : 'POST',
        body: JSON.stringify(value),
      }),
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e) => {
      if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) setUncertain(true);
    },
  });
  const stale = mutation.error instanceof ApiError && [404, 409].includes(mutation.error.status);
  return { mutation, uncertain, stale };
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
          ذخیره تغییرات
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
  readOnly = false,
}: {
  item?: PurchaseMethod;
  catalog?: Catalog;
  onClose: () => void;
  readOnly?: boolean;
}) {
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
  const [error, setError] = useState<unknown>();
  const { mutation, uncertain, stale } = useConditionSave(
    `/admin/purchase-methods${item ? `/${item.id}` : ''}`,
    onClose,
  );
  const disabled = readOnly || mutation.isPending || uncertain || stale || !catalog;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const parsed = methodInputSchema.safeParse({
      ...v,
      requiresApproval: v.requiresApproval || v.kind === 'cheque',
    });
    if (!parsed.success) {
      setError(new Error('نام‌های دو زبان، مبالغ صحیح ریال و محدودیت‌های دسته را بررسی کنید.'));
      return;
    }
    setError(undefined);
    mutation.mutate(parsed.data);
  }
  return (
    <form onSubmit={submit} noValidate>
      <ErrorBox error={error ?? (uncertain || stale ? undefined : mutation.error)} />
      <SaveNotice uncertain={uncertain} stale={stale} />
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
          <Text
            label="عنوان فارسی"
            value={v.nameFa}
            onChange={(nameFa) => set({ ...v, nameFa })}
            required
          />
          <Text
            label="English title"
            value={v.nameEn}
            dir="ltr"
            onChange={(nameEn) => set({ ...v, nameEn })}
            required
          />
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
          <Text
            label="حداقل مبلغ ریال (اختیاری)"
            value={v.minAmountRial}
            dir="ltr"
            onChange={(minAmountRial) => set({ ...v, minAmountRial })}
          />
          <Text
            label="حداکثر مبلغ ریال (اختیاری)"
            value={v.maxAmountRial}
            dir="ltr"
            onChange={(maxAmountRial) => set({ ...v, maxAmountRial })}
          />
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
  readOnly = false,
}: {
  item?: ChequePlan;
  catalog?: Catalog;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const [v, set] = useState({
    nameFa: item?.nameFa ?? '',
    nameEn: item?.nameEn ?? '',
    months: item ? String(item.months) : '',
    markupBasisPoints: item ? String(item.markupBasisPoints) : '',
    downPaymentBasisPoints: item ? String(item.downPaymentBasisPoints) : '',
    intervalMonths: item ? String(item.intervalMonths) : '',
    roundingUnitRial: String(item?.roundingUnitRial ?? 10),
    enabled: item?.enabled ?? false,
    minAmountRial: item?.minAmountRial ?? '',
    maxAmountRial: item?.maxAmountRial ?? '',
    categoryIds: item?.categories.map((c) => c.categoryId) ?? [],
    version: item?.version ?? null,
  });
  const [error, setError] = useState<unknown>();
  const { mutation, uncertain, stale } = useConditionSave(
    `/admin/cheque-plans${item ? `/${item.id}` : ''}`,
    onClose,
  );
  const disabled = readOnly || mutation.isPending || uncertain || stale || !catalog;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const parsed = planInputSchema.safeParse(v);
    if (!parsed.success) {
      setError(
        new Error(
          'نام‌های دو زبان، مدت، نرخ‌ها، فاصلهٔ قابل تقسیم چک‌ها و مبالغ صحیح ریال را بررسی کنید.',
        ),
      );
      return;
    }
    setError(undefined);
    mutation.mutate(parsed.data);
  }
  return (
    <form onSubmit={submit} noValidate>
      <ErrorBox error={error ?? (uncertain || stale ? undefined : mutation.error)} />
      <SaveNotice uncertain={uncertain} stale={stale} />
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
          <Text
            label="عنوان فارسی"
            value={v.nameFa}
            onChange={(nameFa) => set({ ...v, nameFa })}
            required
          />
          <Text
            label="English name"
            value={v.nameEn}
            dir="ltr"
            onChange={(nameEn) => set({ ...v, nameEn })}
            required
          />
          <Text
            label="مدت (ماه)"
            value={v.months}
            onChange={(months) => set({ ...v, months })}
            required
          />
          <Text
            label="فاصلهٔ چک‌ها (ماه)"
            value={v.intervalMonths}
            onChange={(intervalMonths) => set({ ...v, intervalMonths })}
            required
          />
          <Field label="واحد گردکردن مبالغ">
            <select
              value={v.roundingUnitRial}
              onChange={(e) => set({ ...v, roundingUnitRial: e.target.value })}
            >
              <option value="1">یک ریال</option>
              <option value="10">یک تومان (۱۰ ریال)</option>
            </select>
          </Field>
          <Text
            label="افزایش کل (basis point)"
            value={v.markupBasisPoints}
            onChange={(markupBasisPoints) => set({ ...v, markupBasisPoints })}
            hint="۱۰۰ واحد یعنی ۱ درصد"
            required
          />
          <Text
            label="پیش‌پرداخت (basis point)"
            value={v.downPaymentBasisPoints}
            onChange={(downPaymentBasisPoints) => set({ ...v, downPaymentBasisPoints })}
            hint="۱۰۰ واحد یعنی ۱ درصد"
            required
          />
          <Text
            label="حداقل مبلغ ریال"
            value={v.minAmountRial}
            dir="ltr"
            onChange={(minAmountRial) => set({ ...v, minAmountRial })}
          />
          <Text
            label="حداکثر مبلغ ریال"
            value={v.maxAmountRial}
            dir="ltr"
            onChange={(maxAmountRial) => set({ ...v, maxAmountRial })}
          />
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
