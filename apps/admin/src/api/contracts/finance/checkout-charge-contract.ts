import { z } from 'zod';
import { basisPoints, normalizeRial } from '../../../utils/finance-inputs.ts';

export const shippingModes = {
  unconfigured: 'تعیین نشده',
  free: 'ارسال رایگان',
  flat: 'هزینهٔ ثابت',
  postpaid: 'پس‌کرایه',
};
export const taxModes = {
  unconfigured: 'تعیین نشده',
  exempt: 'بدون مالیات جداگانه',
  exclusive: 'مالیات افزوده به مبلغ',
  inclusive: 'مالیات داخل قیمت با تفکیک',
  included_unitemized: 'مالیات داخل قیمت، بدون تفکیک',
};
export const taxBases = {
  items: 'اصل کالاها',
  goods: 'کالاها با افزودهٔ طرح چکی',
  goods_shipping: 'کالاها با افزودهٔ طرح و ارسال دریافتی فروشگاه',
};
export const taxRounding = {
  half_up: 'نزدیک‌ترین ریال؛ نیم به بالا',
  up: 'رو به بالا',
  down: 'رو به پایین',
};
const positiveRial = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => /^\d+$/.test(v) && BigInt(v) <= 9223372036854775807n);
const chargeVersion = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const input = z
  .object({
    shippingMode: z.enum(['unconfigured', 'free', 'flat', 'postpaid']),
    shippingNameFa: z.string().max(200),
    shippingNameEn: z.string().max(200),
    shippingDescriptionFa: z.string().max(2000),
    shippingDescriptionEn: z.string().max(2000),
    shippingFeeRial: positiveRial.nullable(),
    shippingFreeFromRial: positiveRial.nullable(),
    taxMode: z.enum(['unconfigured', 'exempt', 'exclusive', 'inclusive', 'included_unitemized']),
    taxRateBasisPoints: z.number().int().min(1).max(10000).nullable(),
    taxBase: z.enum(['items', 'goods', 'goods_shipping']),
    taxRounding: z.enum(['half_up', 'up', 'down']),
    version: chargeVersion.nullable(),
  })
  .strict();
export type ChargeInput = z.infer<typeof input>;
export type ChargeDraft = Pick<
  ChargeInput,
  | 'shippingMode'
  | 'shippingNameFa'
  | 'shippingNameEn'
  | 'shippingDescriptionFa'
  | 'shippingDescriptionEn'
  | 'taxMode'
  | 'taxBase'
  | 'taxRounding'
> & { fee: string; threshold: string; rate: string };
export const isRated = (mode: ChargeInput['taxMode']) =>
  mode === 'exclusive' || mode === 'inclusive';

export function readChargePolicy(raw: unknown): ChargeInput {
  const shape = input
    .extend({
      id: z.literal(1),
      shippingFeeRial: positiveRial.nullish(),
      shippingFreeFromRial: positiveRial.nullish(),
      taxRateBasisPoints: z.number().int().min(1).max(10000).nullish(),
      version: z.union([chargeVersion, z.literal('')]),
    })
    .safeParse(raw);
  if (!shape.success) throw Error('پاسخ تنظیمات هزینه معتبر نیست؛ دوباره دریافت کنید.');
  const {
    id: _id,
    shippingFeeRial,
    shippingFreeFromRial,
    taxRateBasisPoints,
    version,
    ...rest
  } = shape.data;
  const value: ChargeInput = {
    ...rest,
    shippingFeeRial: shippingFeeRial ?? null,
    shippingFreeFromRial: shippingFreeFromRial ?? null,
    taxRateBasisPoints: taxRateBasisPoints ?? null,
    version: version || null,
  };
  if (
    (value.shippingMode === 'flat') !== (value.shippingFeeRial !== null) ||
    (value.shippingMode !== 'flat' && value.shippingFreeFromRial !== null) ||
    isRated(value.taxMode) !== (value.taxRateBasisPoints !== null)
  )
    throw Error('شیوه و مبلغ تنظیمات هزینه با هم مطابقت ندارند؛ دوباره دریافت کنید.');
  return value;
}

export function prepareCharges(draft: ChargeDraft, version: ChargeInput['version']) {
  const { fee, threshold, rate, ...fields } = draft;
  const errors: Partial<Record<keyof ChargeDraft, string>> = {};
  let shippingFeeRial: string | null = null,
    shippingFreeFromRial: string | null = null,
    taxRateBasisPoints: number | null = null;
  if (fields.shippingMode !== 'unconfigured') {
    for (const field of ['shippingNameFa', 'shippingNameEn'] as const)
      if (!fields[field].trim()) errors[field] = 'نام روش ارسال را وارد کنید.';
  }
  if (fields.shippingMode === 'flat') {
    for (const [field, text] of [
      ['fee', fee],
      ['threshold', threshold],
    ] as const) {
      try {
        const normalized = normalizeRial(text);
        if (normalized === '0' || (field === 'fee' && !normalized))
          throw Error('مبلغ مثبت به ریال وارد کنید.');
        if (field === 'fee') shippingFeeRial = normalized;
        else shippingFreeFromRial = normalized || null;
      } catch (error) {
        errors[field] = (error as Error).message;
      }
    }
  }
  if (isRated(fields.taxMode)) {
    try {
      taxRateBasisPoints = basisPoints(rate, 1, 10000);
    } catch (error) {
      errors.rate = (error as Error).message;
    }
  }
  const candidate = input.safeParse({
    ...fields,
    shippingNameFa: fields.shippingNameFa.trim(),
    shippingNameEn: fields.shippingNameEn.trim(),
    shippingFeeRial,
    shippingFreeFromRial,
    taxRateBasisPoints,
    version,
  });
  return {
    errors,
    value: candidate.success && !Object.keys(errors).length ? candidate.data : null,
  };
}

export function sameChargeValues(a: ChargeInput, b: ChargeInput) {
  return Object.keys(a).every(
    (key) => key === 'version' || a[key as keyof ChargeInput] === b[key as keyof ChargeInput],
  );
}
