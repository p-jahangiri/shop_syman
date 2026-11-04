import { z } from '../config/schema-runtime.ts';

export function normalizeOrderDigits(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    );
}
export function normalizeOrderPhone(value: string) {
  return normalizeOrderDigits(value)
    .replace(/[ -]/g, '')
    .replace(/^(?:0098|\+98)/, '0');
}
export const orderFormSchema = z.object({
  contactName: z.string().trim().min(2).max(100),
  contactPhone: z
    .string()
    .max(64)
    .refine((v) => /^09\d{9}$/.test(normalizeOrderPhone(v))),
  province: z.string(),
  city: z.string(),
  address: z.string(),
  postalCode: z.string(),
  note: z.string().max(500),
  acknowledgeTemporary: z.boolean().refine((v) => v),
});
export type OrderFormValues = z.infer<typeof orderFormSchema>;
export function validateOrderForm(values: OrderFormValues, physical: boolean) {
  return orderFormSchema
    .superRefine((v, ctx) => {
      if (!physical) return;
      for (const [key, min, max] of [
        ['province', 2, 100],
        ['city', 2, 100],
        ['address', 10, 2000],
      ] as const) {
        const s = v[key].trim();
        if (s.length < min || s.length > max)
          ctx.addIssue({ code: 'custom', path: [key], message: 'invalid' });
      }
      if (!/^\d{10}$/.test(normalizeOrderDigits(v.postalCode).replace(/ /g, '')))
        ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'invalid' });
    })
    .safeParse(values);
}
export function orderReturnTo(value: string | null) {
  return value !== null && /^\/(?:checkout|orders(?:\/[a-f0-9]{32})?)$/.test(value) ? value : null;
}

export function accountReturnTo(value: string | null, tab: string | null) {
  return (
    (value !== null && /^\/(?:cart|sourcing(?:\/[a-f0-9]{32})?)$/.test(value)
      ? value
      : value === '/addresses' ||
          value === '/credit/purchases' ||
          value === '/phone-interests' ||
          (value !== null &&
            /^\/market\/[A-Za-z0-9_-]{1,64}\?configuration=[a-f0-9]{32}$/.test(value))
        ? value
        : orderReturnTo(value)) ??
    (tab === 'orders'
      ? '/orders'
      : tab === 'addresses'
        ? '/addresses'
        : tab === 'sourcing'
          ? '/sourcing'
          : null)
  );
}
