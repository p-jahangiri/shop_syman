import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ImageEditor } from '../media/media';
import { Check, ErrorBox, Field } from '../../components/ui';
import { Text, Translations, useSave, FormActions } from '../../components/forms/forms';
import {
  emptyTranslations,
  nameOf,
  type AttributeDefinition,
  type AttributeValue,
  type Catalog,
  type ChequePlan,
  type Product,
  type PurchaseMethod,
  type Variant,
} from '../../types/types';
interface ValueInput {
  attributeId: string;
  textFa?: string;
  textEn?: string;
  number?: number;
  bool?: boolean;
  optionId?: string;
  optionIds?: string[];
}
interface VariantFormValue {
  id?: string;
  sku: string;
  priceRial: string;
  compareAtRial: string | null;
  color: string;
  colorNameFa: string;
  colorNameEn: string;
  labelFa: string;
  labelEn: string;
  warrantyFa: string;
  warrantyEn: string;
  isActive: boolean;
  attributes: ValueInput[];
  purchaseMethodIds: string[];
  version?: string;
}
const valuesOf = (values: AttributeValue[]): ValueInput[] =>
  values.map((a) => ({
    attributeId: a.attributeId,
    textFa: a.valueTextFa,
    textEn: a.valueTextEn,
    number: a.valueNumber,
    bool: a.valueBool,
    optionId: a.valueOptionId,
    optionIds: a.selections?.map((s) => s.optionId),
  }));
const blankVariant = (): VariantFormValue => ({
  sku: '',
  priceRial: '',
  compareAtRial: null,
  color: '#60685b',
  colorNameFa: '',
  colorNameEn: '',
  labelFa: '',
  labelEn: '',
  warrantyFa: '',
  warrantyEn: '',
  isActive: true,
  attributes: [],
  purchaseMethodIds: [],
});
function variantOf(v: Variant): VariantFormValue {
  return {
    ...v,
    compareAtRial: v.compareAtPriceRial ?? null,
    attributes: valuesOf(v.attributes),
    purchaseMethodIds: v.purchaseMethods.map((m) => m.methodId),
  };
}
function AttributeFields({
  definitions,
  value,
  onChange,
}: {
  definitions: AttributeDefinition[];
  value: ValueInput[];
  onChange: (v: ValueInput[]) => void;
}) {
  const update = (id: string, patch: Partial<ValueInput>) => {
    const next = { attributeId: id, ...patch };
    onChange([...value.filter((v) => v.attributeId !== id), next]);
  };
  return (
    <div className="form-grid">
      {definitions.map((d) => {
        const current = value.find((a) => a.attributeId === d.id);
        return (
          <div className="typed-attribute" key={d.id}>
            <small>
              {nameOf(d)} {d.unit && `(${d.unit})`}
            </small>
            {d.dataType === 'Text' ? (
              <div className="form-grid">
                <Text
                  label="فارسی"
                  value={current?.textFa ?? ''}
                  onChange={(textFa) => update(d.id, { textFa, textEn: current?.textEn })}
                />
                <Text
                  label="English"
                  dir="ltr"
                  value={current?.textEn ?? ''}
                  onChange={(textEn) => update(d.id, { textFa: current?.textFa, textEn })}
                />
              </div>
            ) : d.dataType === 'Number' ? (
              <input
                aria-label={nameOf(d)}
                type="number"
                step="any"
                value={current?.number ?? ''}
                onChange={(e) => {
                  if (e.target.value === '') onChange(value.filter((v) => v.attributeId !== d.id));
                  else update(d.id, { number: Number(e.target.value) });
                }}
              />
            ) : d.dataType === 'Bool' ? (
              <select
                aria-label={nameOf(d)}
                value={current?.bool === undefined ? '' : String(current.bool)}
                onChange={(e) => {
                  if (e.target.value === '') onChange(value.filter((v) => v.attributeId !== d.id));
                  else update(d.id, { bool: e.target.value === 'true' });
                }}
              >
                <option value="">تعیین نشده</option>
                <option value="true">بله</option>
                <option value="false">خیر</option>
              </select>
            ) : d.dataType === 'Select' ? (
              <select
                aria-label={nameOf(d)}
                value={current?.optionId ?? ''}
                onChange={(e) => {
                  if (!e.target.value) onChange(value.filter((v) => v.attributeId !== d.id));
                  else update(d.id, { optionId: e.target.value });
                }}
              >
                <option value="">انتخاب کنید</option>
                {d.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.labelFa} / {o.labelEn}
                  </option>
                ))}
              </select>
            ) : (
              <div className="inline-checks">
                {d.options.map((o) => (
                  <Check
                    key={o.id}
                    label={o.labelFa}
                    checked={current?.optionIds?.includes(o.id) ?? false}
                    onChange={(e) =>
                      update(d.id, {
                        optionIds: e.target.checked
                          ? [...(current?.optionIds ?? []), o.id]
                          : (current?.optionIds ?? []).filter((id) => id !== o.id),
                      })
                    }
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              className="clear-value"
              onClick={() => onChange(value.filter((v) => v.attributeId !== d.id))}
            >
              پاک کردن
            </button>
          </div>
        );
      })}
    </div>
  );
}
export function ProductForm({
  item,
  data,
  methods,
  plans,
  onClose,
}: {
  item?: Product;
  data: Catalog;
  methods: PurchaseMethod[];
  plans: ChequePlan[];
  onClose: () => void;
}) {
  const [uploadBusy, setUploadBusy] = useState(false);
  const [value, set] = useState({
    categoryId: item?.categoryId ?? data.categories[0]?.id ?? '',
    brandId: item?.brandId ?? data.brands[0]?.id ?? '',
    slug: item?.slug ?? '',
    status: item?.status ?? 'Draft',
    isDigital: item?.isDigital ?? false,
    featured: item?.featured ?? false,
    translations: item?.translations ?? emptyTranslations(),
    attributes: item ? valuesOf(item.attributes) : [],
    variants: item ? item.variants.map(variantOf) : [blankVariant()],
    imageUrls: item
      ? [...item.media].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => m.url)
      : [],
    purchaseMethodIds: item?.purchaseMethods.map((m) => m.methodId) ?? [],
    chequePlanIds: item?.creditPlans.map((p) => p.planId) ?? [],
    version: item?.version,
  });
  const mutation = useSave(`/admin/products${item ? `/${item.id}` : ''}`, onClose);
  const category = data.categories.find((c) => c.id === value.categoryId);
  const definitions = data.attributes.filter((a) =>
    category?.attributes.some((r) => r.attributeId === a.id),
  );
  const variantDefinitions = definitions.filter(
    (a) =>
      category?.attributes.some((r) => r.attributeId === a.id && r.isVariantAxis) &&
      a.dataType !== 'MultiSelect',
  );
  const variant = (index: number, patch: Partial<VariantFormValue>) =>
    set({
      ...value,
      variants: value.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    });
  function clean(values: ValueInput[]) {
    return values
      .filter(
        (v) =>
          v.number !== undefined ||
          v.bool !== undefined ||
          v.optionId ||
          v.optionIds?.length ||
          v.textFa?.trim() ||
          v.textEn?.trim(),
      )
      .map((v) => ({ ...v, optionIds: v.optionIds?.length ? v.optionIds : undefined }));
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (uploadBusy) return;
        mutation.mutate({
          ...value,
          attributes: clean(value.attributes),
          variants: value.variants.map((v) => ({ ...v, attributes: clean(v.attributes) })),
        });
      }}
    >
      <ErrorBox error={mutation.error} />
      <Translations
        value={value.translations}
        onChange={(translations) => set({ ...value, translations })}
      />
      <div className="form-grid">
        <Text
          label="اسلاگ کالا"
          value={value.slug}
          onChange={(slug) => set({ ...value, slug })}
          dir="ltr"
          required
        />
        <Field label="وضعیت">
          <select
            value={value.status}
            onChange={(e) => set({ ...value, status: e.target.value as Product['status'] })}
          >
            <option value="Draft">پیش‌نویس</option>
            <option value="Published">منتشرشده</option>
            <option value="Hidden">پنهان</option>
          </select>
        </Field>
        <Field label="دسته‌بندی">
          <select
            required
            value={value.categoryId}
            onChange={(e) =>
              set({
                ...value,
                categoryId: e.target.value,
                attributes: [],
                variants: value.variants.map((v) => ({ ...v, attributes: [] })),
              })
            }
          >
            <option value="">انتخاب کنید</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {nameOf(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="برند">
          <select
            required
            value={value.brandId}
            onChange={(e) => set({ ...value, brandId: e.target.value })}
          >
            <option value="">انتخاب کنید</option>
            {data.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Check
          label="کالای دیجیتال"
          checked={value.isDigital}
          onChange={(e) => set({ ...value, isDigital: e.target.checked })}
        />
        <Check
          label="محصول منتخب"
          checked={value.featured}
          onChange={(e) => set({ ...value, featured: e.target.checked })}
        />
      </div>
      <ImageEditor
        value={value.imageUrls}
        onChange={(imageUrls) => set((old) => ({ ...old, imageUrls }))}
        onBusy={setUploadBusy}
      />
      <fieldset>
        <legend>روش‌های خرید این کالا</legend>
        <div className="inline-checks">
          {methods.map((m) => (
            <Check
              key={m.id}
              label={`${m.nameFa}${m.enabled ? '' : ' (غیرفعال)'}`}
              checked={value.purchaseMethodIds.includes(m.id)}
              onChange={(e) =>
                set({
                  ...value,
                  purchaseMethodIds: e.target.checked
                    ? [...value.purchaseMethodIds, m.id]
                    : value.purchaseMethodIds.filter((id) => id !== m.id),
                  variants: value.variants.map((v) => ({
                    ...v,
                    purchaseMethodIds: v.purchaseMethodIds.filter((id) => id !== m.id),
                  })),
                })
              }
            />
          ))}
        </div>
        <small>
          طرح چکی انتخاب‌نشده یعنی همهٔ طرح‌های واجد شرایط. محدودیت نهایی مبلغ، دسته و موجودی در
          سرور بررسی می‌شود.
        </small>
        <div className="inline-checks">
          {plans.map((p) => (
            <Check
              key={p.id}
              label={p.nameFa}
              checked={value.chequePlanIds.includes(p.id)}
              onChange={(e) =>
                set({
                  ...value,
                  chequePlanIds: e.target.checked
                    ? [...value.chequePlanIds, p.id]
                    : value.chequePlanIds.filter((id) => id !== p.id),
                })
              }
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>مشخصات کالا</legend>
        <AttributeFields
          definitions={definitions}
          value={value.attributes}
          onChange={(attributes) => set({ ...value, attributes })}
        />
      </fieldset>
      <h3>تنوع‌ها، قیمت و گارانتی</h3>
      {value.variants.map((v, i) => (
        <fieldset key={v.id ?? `new-${i}`} className="variant">
          <legend>
            تنوع {(i + 1).toLocaleString('fa-IR')} {v.sku && `· ${v.sku}`}
          </legend>
          <div className="form-grid">
            <Text
              label="SKU مستقل"
              value={v.sku}
              dir="ltr"
              required
              onChange={(sku) => variant(i, { sku })}
            />
            <Text
              label="قیمت (ریال)"
              value={v.priceRial}
              dir="ltr"
              required
              onChange={(priceRial) => variant(i, { priceRial })}
              hint={
                /^\d+$/.test(v.priceRial)
                  ? `${(BigInt(v.priceRial) / 10n).toLocaleString('fa-IR')}${BigInt(v.priceRial) % 10n ? '٫' + (BigInt(v.priceRial) % 10n).toLocaleString('fa-IR') : ''} تومان`
                  : undefined
              }
            />
            <Text
              label="قیمت مرجع (ریال، اختیاری)"
              value={v.compareAtRial ?? ''}
              dir="ltr"
              onChange={(x) => variant(i, { compareAtRial: x || null })}
            />
            <Text
              label="رنگ"
              type="color"
              value={v.color}
              onChange={(color) => variant(i, { color })}
            />
            <Text
              label="نام رنگ فارسی"
              value={v.colorNameFa}
              onChange={(colorNameFa) => variant(i, { colorNameFa })}
            />
            <Text
              label="Color name"
              value={v.colorNameEn}
              dir="ltr"
              onChange={(colorNameEn) => variant(i, { colorNameEn })}
            />
            <Text
              label="عنوان تنوع فارسی"
              value={v.labelFa}
              onChange={(labelFa) => variant(i, { labelFa })}
            />
            <Text
              label="Variant label"
              value={v.labelEn}
              dir="ltr"
              onChange={(labelEn) => variant(i, { labelEn })}
            />
            <Text
              label="گارانتی فارسی"
              value={v.warrantyFa}
              onChange={(warrantyFa) => variant(i, { warrantyFa })}
            />
            <Text
              label="English warranty"
              value={v.warrantyEn}
              dir="ltr"
              onChange={(warrantyEn) => variant(i, { warrantyEn })}
            />
          </div>
          <AttributeFields
            definitions={variantDefinitions}
            value={v.attributes}
            onChange={(attributes) => variant(i, { attributes })}
          />
          <div className="inline-checks">
            <Check
              label="تنوع فعال"
              checked={v.isActive}
              onChange={(e) => variant(i, { isActive: e.target.checked })}
            />
            {methods
              .filter((m) => value.purchaseMethodIds.includes(m.id))
              .map((m) => (
                <Check
                  key={m.id}
                  label={m.nameFa}
                  checked={v.purchaseMethodIds.includes(m.id)}
                  onChange={(e) =>
                    variant(i, {
                      purchaseMethodIds: e.target.checked
                        ? [...v.purchaseMethodIds, m.id]
                        : v.purchaseMethodIds.filter((id) => id !== m.id),
                    })
                  }
                />
              ))}
          </div>
          <small>
            با انتخاب نکردن روش در سطح تنوع، روش‌های کالا به ارث می‌رسند. موجودی از بخش انبار مدیریت
            می‌شود.
          </small>
          <button
            className="danger"
            type="button"
            disabled={value.variants.length === 1}
            onClick={() => set({ ...value, variants: value.variants.filter((_, n) => n !== i) })}
          >
            <Trash2 size={15} />
            حذف از فرم (تنوع قبلی غیرفعال می‌شود)
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() => set({ ...value, variants: [...value.variants, blankVariant()] })}
      >
        <Plus size={16} />
        افزودن تنوع
      </button>
      <FormActions pending={mutation.isPending || uploadBusy} onClose={onClose} />
    </form>
  );
}
