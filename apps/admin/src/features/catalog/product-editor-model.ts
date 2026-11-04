import {
  validProductVideoUrl,
  type ProductVideo,
} from '../../api/contracts/catalog/product-video-contract.ts';
import type { AttributeDefinition, Catalog, Product, PurchaseMethod } from '../../types/types';
export interface ProductValueInput {
  attributeId: string;
  textFa?: string;
  textEn?: string;
  number?: number;
  bool?: boolean;
  optionId?: string;
  optionIds?: string[];
}
export interface ProductVariantDraft {
  key: string;
  id?: string;
  version?: string;
  sku: string;
  price: string;
  referencePrice: string;
  color: string;
  colorNameFa: string;
  colorNameEn: string;
  labelFa: string;
  labelEn: string;
  warrantyFa: string;
  warrantyEn: string;
  isActive: boolean;
  attributes: ProductValueInput[];
  purchaseMethodIds: string[];
}
export interface ProductDraft {
  id?: string;
  version?: string;
  categoryId: string;
  brandId: string;
  slug: string;
  status: Product['status'];
  isDigital: boolean;
  featured: boolean;
  nameFa: string;
  nameEn: string;
  descriptionFa: string;
  descriptionEn: string;
  badgeFa: string;
  badgeEn: string;
  attributes: ProductValueInput[];
  variants: ProductVariantDraft[];
  imageUrls: string[];
  videos: ProductVideo[];
  purchaseMethodIds: string[];
  chequePlanIds: string[];
}
export type ProductFieldErrors = Record<string, string>;
export function normalizedDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632));
}
export function tomanToRial(value: string): string | null {
  const clean = normalizedDigits(value)
    .trim()
    .replace(/[,،٬\s]/g, '')
    .replace('٫', '.');
  if (!/^(?:0|[1-9]\d{0,18})(?:\.\d)?$/.test(clean)) return null;
  const [whole, fraction = '0'] = clean.split('.'),
    rial = BigInt(whole) * 10n + BigInt(fraction);
  return rial <= 9223372036854775807n ? rial.toString() : null;
}
export function rialToToman(value: string) {
  const amount = BigInt(value);
  return String(amount / 10n) + (amount % 10n ? '.' + String(amount % 10n) : '');
}
export function moneyLabel(value: string | null | undefined) {
  if (value == null) return '—';
  const amount = BigInt(value);
  return (
    (amount / 10n).toLocaleString('fa-IR') +
    (amount % 10n ? '٫' + (amount % 10n).toLocaleString('fa-IR') : '') +
    ' تومان'
  );
}
export function blankProductVariant(key: string): ProductVariantDraft {
  return {
    key,
    sku: '',
    price: '',
    referencePrice: '',
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
  };
}
export function valuesOfProduct(values: Product['attributes']): ProductValueInput[] {
  return values.map((a) => ({
    attributeId: a.attributeId,
    textFa: a.valueTextFa,
    textEn: a.valueTextEn,
    number: a.valueNumber,
    bool: a.valueBool,
    optionId: a.valueOptionId,
    optionIds: a.selections?.length ? a.selections.map((s) => s.optionId) : undefined,
  }));
}
export function draftOfProduct(
  item: Product | undefined,
  _key: string,
  methods: PurchaseMethod[],
): ProductDraft {
  const fa = item?.translations.find((t) => t.locale === 'fa'),
    en = item?.translations.find((t) => t.locale === 'en');
  return {
    id: item?.id,
    version: item?.version,
    categoryId: item?.categoryId ?? '',
    brandId: item?.brandId ?? '',
    slug: item?.slug ?? 'product-' + _key.replace(/-/g, '').slice(0, 8),
    status: item?.status ?? 'Draft',
    isDigital: item?.isDigital ?? false,
    featured: item?.featured ?? false,
    nameFa: fa?.name ?? '',
    nameEn: en?.name ?? '',
    descriptionFa: fa?.description ?? '',
    descriptionEn: en?.description ?? '',
    badgeFa: fa?.badge ?? '',
    badgeEn: en?.badge ?? '',
    attributes: item ? valuesOfProduct(item.attributes) : [],
    videos: [],
    imageUrls: item
      ? [...item.media].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => m.url)
      : [],
    purchaseMethodIds: item
      ? item.purchaseMethods.map((m) => m.methodId)
      : methods.filter((m) => m.enabled && m.kind === 'online').map((m) => m.id),
    chequePlanIds: item?.creditPlans.map((p) => p.planId) ?? [],
    variants: item
      ? item.variants.map((v) => ({
          ...v,
          key: v.id,
          price: rialToToman(v.priceRial),
          referencePrice: v.compareAtPriceRial ? rialToToman(v.compareAtPriceRial) : '',
          attributes: valuesOfProduct(v.attributes),
          purchaseMethodIds: v.purchaseMethods.map((m) => m.methodId),
        }))
      : [],
  };
}
export function hasAttributeValue(value: ProductValueInput | undefined) {
  return (
    !!value &&
    (value.number != null ||
      value.bool != null ||
      !!value.optionId ||
      !!value.optionIds?.length ||
      !!value.textFa?.trim() ||
      !!value.textEn?.trim())
  );
}
export function validateProductDraft(value: ProductDraft, data: Catalog): ProductFieldErrors {
  const errors: ProductFieldErrors = {};
  if (!value.nameFa.trim() || value.nameFa.trim().length > 250)
    errors.nameFa = 'نام کالا را بین ۱ تا ۲۵۰ نویسه وارد کنید.';
  if (value.nameEn.length > 250) errors.nameEn = 'عنوان انگلیسی حداکثر ۲۵۰ نویسه است.';
  if (!data.categories.some((c) => c.id === value.categoryId))
    errors.categoryId = 'دستهٔ کالا را انتخاب کنید؛ از آیکون راهنما می‌توانید دسته بسازید.';
  if (!data.brands.some((b) => b.id === value.brandId))
    errors.brandId = 'برند کالا را انتخاب یا برند جدید اضافه کنید.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 150)
    errors.slug = 'نشانی یکتا با حروف کوچک انگلیسی، عدد و خط تیره وارد کنید.';
  if (value.descriptionFa.length > 8000)
    errors.descriptionFa = 'توضیح فارسی حداکثر ۸۰۰۰ نویسه است.';
  if (value.descriptionEn.length > 8000)
    errors.descriptionEn = 'توضیح انگلیسی حداکثر ۸۰۰۰ نویسه است.';
  if (value.variants.length > 500) errors.variants = 'تعداد تنوع‌ها بیش از حد مجاز است.';
  if (value.status === 'Published' && !value.variants.some((v) => v.isActive))
    errors.variants = 'برای انتشار، حداقل یک تنوع قابل نمایش لازم است.';
  if (value.status === 'Published' && !value.imageUrls.length)
    errors.images = 'برای انتشار، حداقل یک تصویر آماده اضافه کنید.';
  if (value.status === 'Published' && !value.purchaseMethodIds.length)
    errors.purchaseMethods = 'حداقل یک روش خرید برای کالا انتخاب کنید.';
  if (
    value.videos.length > 8 ||
    value.videos.some(
      (v) =>
        !validProductVideoUrl(v.url) ||
        (v.variantId !== null && !value.variants.some((row) => row.id === v.variantId)),
    )
  )
    errors.videos = 'حداکثر۸ویدیوی معتبر با تنوع همین کالا وارد کنید.';
  const category = data.categories.find((c) => c.id === value.categoryId);
  const required = category?.attributes.filter((a) => a.isRequired) ?? [];
  function validateValues(values: ProductValueInput[], prefix: string) {
    for (const item of values) {
      const definition = data.attributes.find((a) => a.id === item.attributeId);
      const path = prefix + 'attribute.' + item.attributeId;
      const groups = [
        Boolean(item.textFa?.trim() || item.textEn?.trim()),
        item.number != null,
        item.bool != null,
        Boolean(item.optionId),
        Boolean(item.optionIds?.length),
      ].filter(Boolean).length;
      const allowed = category?.attributes.some((a) => a.attributeId === item.attributeId);
      const valid =
        allowed &&
        definition &&
        groups === 1 &&
        (definition.dataType === 'Number'
          ? item.number != null &&
            Number.isFinite(item.number) &&
            Math.abs(item.number) < 1e20 &&
            Number(item.number.toFixed(8)) === item.number
          : definition.dataType === 'Bool'
            ? typeof item.bool === 'boolean'
            : definition.dataType === 'Text'
              ? Boolean(item.textFa?.trim()) &&
                (item.textFa?.length ?? 0) <= 2000 &&
                (item.textEn?.length ?? 0) <= 2000
              : definition.dataType === 'Select'
                ? definition.options.some((o) => o.id === item.optionId)
                : Boolean(item.optionIds?.length) &&
                  new Set(item.optionIds).size === item.optionIds?.length &&
                  item.optionIds?.every((id) => definition.options.some((o) => o.id === id)));
      if (!valid) errors[path] = 'مقدار این ویژگی با نوع و گزینه‌های دسته سازگار نیست.';
    }
  }
  validateValues(value.attributes, '');
  const skus = new Map<string, string[]>();
  for (const variant of value.variants) {
    const root = 'variants.' + variant.key + '.';
    validateValues(variant.attributes, root);
    if (!/^#[a-f0-9]{6}$/i.test(variant.color))
      errors[root + 'color'] = 'کد رنگ شش‌رقمی معتبر وارد کنید.';
    if (variant.warrantyFa.length > 2000 || variant.warrantyEn.length > 2000)
      errors[root + 'warrantyFa'] = 'توضیح گارانتی حداکثر۲۰۰۰نویسه است.';
    if (variant.purchaseMethodIds.some((id) => !value.purchaseMethodIds.includes(id)))
      errors[root + 'purchaseMethods'] = 'روش خرید تنوع باید از روش‌های کالای مادر باشد.';
    const sku = variant.sku.trim().toUpperCase();
    if (!sku || sku.length > 80) errors[root + 'sku'] = 'کد یکتای تنوع (حداکثر ۸۰ نویسه) لازم است.';
    skus.set(sku, [...(skus.get(sku) ?? []), variant.key]);
    const price = tomanToRial(variant.price),
      reference = variant.referencePrice.trim() ? tomanToRial(variant.referencePrice) : null;
    if (price === null)
      errors[root + 'price'] = 'قیمت تومان معتبر، حداکثر با یک رقم اعشار وارد کنید.';
    if (
      variant.referencePrice.trim() &&
      (reference === null || (price !== null && BigInt(reference) < BigInt(price)))
    )
      errors[root + 'referencePrice'] = 'قیمت پیش از تخفیف باید معتبر و کمتر از قیمت فروش نباشد.';
    for (const rule of required)
      if (
        value.status === 'Published' &&
        variant.isActive &&
        !hasAttributeValue(value.attributes.find((a) => a.attributeId === rule.attributeId)) &&
        !hasAttributeValue(variant.attributes.find((a) => a.attributeId === rule.attributeId))
      )
        errors[(rule.isVariantAxis ? root : '') + 'attribute.' + rule.attributeId] =
          'این ویژگی برای انتشار کالا لازم است.';
  }
  for (const [sku, keys] of skus)
    if (sku && keys.length > 1)
      for (const key of keys)
        errors['variants.' + key + '.sku'] =
          'این کد در چند ردیف تکرار شده؛ کد هر تنوع باید یکتا باشد.';
  return errors;
}
export function productInput(value: ProductDraft) {
  const clean = (values: ProductValueInput[]) =>
    values
      .filter(hasAttributeValue)
      .map((v) => (v.textFa && !v.textEn ? { ...v, textEn: v.textFa } : v));
  return {
    categoryId: value.categoryId,
    brandId: value.brandId,
    slug: value.slug,
    status: value.status,
    isDigital: value.isDigital,
    featured: value.featured,
    translations: [
      {
        locale: 'fa',
        name: value.nameFa.trim(),
        description: value.descriptionFa,
        badge: value.badgeFa || null,
      },
      {
        locale: 'en',
        name: value.nameEn.trim() || value.nameFa.trim(),
        description: value.descriptionEn,
        badge: value.badgeEn || null,
      },
    ],
    attributes: clean(value.attributes),
    imageUrls: value.imageUrls,
    videos: value.videos,
    purchaseMethodIds: value.purchaseMethodIds,
    chequePlanIds: value.chequePlanIds,
    version: value.version ?? null,
    variants: value.variants.map((v) => ({
      id: v.id ?? null,
      version: v.version ?? null,
      sku: v.sku.trim().toUpperCase(),
      priceRial: tomanToRial(v.price),
      compareAtRial: v.referencePrice.trim() ? tomanToRial(v.referencePrice) : null,
      color: v.color,
      colorNameFa: v.colorNameFa,
      colorNameEn: v.colorNameEn || v.colorNameFa,
      labelFa: v.labelFa,
      labelEn: v.labelEn || v.labelFa,
      warrantyFa: v.warrantyFa,
      warrantyEn: v.warrantyEn || v.warrantyFa,
      isActive: v.isActive,
      attributes: clean(v.attributes),
      purchaseMethodIds: v.purchaseMethodIds,
    })),
  };
}
export type VariantAxisChoice = { labelFa: string; labelEn: string; value: ProductValueInput };
export type VariantAxis = { definition: AttributeDefinition; choices: VariantAxisChoice[] };
export interface VariantColorChoice {
  hex: string;
  nameFa: string;
  nameEn: string;
}
export function variantCombinationSignature(
  color: string,
  colorName: string,
  values: ProductValueInput[],
) {
  return JSON.stringify([
    color.toLowerCase(),
    colorName.trim(),
    [...values]
      .sort((a, b) => a.attributeId.localeCompare(b.attributeId))
      .map((v) => [
        v.attributeId,
        v.optionId ?? null,
        v.number ?? null,
        v.bool ?? null,
        v.textFa?.trim() ?? null,
      ]),
  ]);
}
export function variantCandidates(
  colors: VariantColorChoice[],
  axes: VariantAxis[],
  current: ProductVariantDraft[],
) {
  const count =
    Math.max(1, colors.length) * axes.reduce((total, axis) => total * axis.choices.length, 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100)
    throw new Error('در هر نوبت بین ۱ تا ۱۰۰ ترکیب انتخاب کنید.');
  let combinations: { attributes: ProductValueInput[]; labelsFa: string[]; labelsEn: string[] }[] =
    [{ attributes: [], labelsFa: [], labelsEn: [] }];
  for (const axis of axes)
    combinations = combinations.flatMap((row) =>
      axis.choices.map((choice) => ({
        attributes: [...row.attributes, choice.value],
        labelsFa: [...row.labelsFa, choice.labelFa],
        labelsEn: [...row.labelsEn, choice.labelEn],
      })),
    );
  const existing = new Set(
    current.map((v) => variantCombinationSignature(v.color, v.colorNameFa, v.attributes)),
  );
  const seen = new Set<string>();
  return (colors.length ? colors : [{ hex: '#60685b', nameFa: '', nameEn: '' }])
    .flatMap((color) =>
      combinations.map((row) => ({
        color,
        attributes: row.attributes,
        labelFa: [...row.labelsFa, color.nameFa].filter(Boolean).join(' / '),
        labelEn: [...row.labelsEn, color.nameEn].filter(Boolean).join(' / '),
        signature: variantCombinationSignature(color.hex, color.nameFa, row.attributes),
      })),
    )
    .filter((row) => {
      if (existing.has(row.signature) || seen.has(row.signature)) return false;
      seen.add(row.signature);
      return true;
    });
}
