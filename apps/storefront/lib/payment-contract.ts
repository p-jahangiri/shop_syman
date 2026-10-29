import { z } from './schema-runtime.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => !/^0+$/.test(x));
const version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
const rial = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((x) => /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n);
const utc = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const ticks = (s: string) => {
  if (s.length > 33 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(s))
    return 0n;
  const seconds = Date.parse(s.replace(/\.\d+(?=Z|\+00:00$)/, ''));
  return Number.isFinite(seconds)
    ? BigInt(seconds) * 10000n + BigInt((s.match(/\.(\d+)/)?.[1] ?? '').padEnd(7, '0'))
    : 0n;
};
export const paymentStateSchema = z.enum([
  'created',
  'initiating',
  'pending',
  'verified',
  'review',
  'failed',
  'cancelled',
]);
const base = {
  id,
  orderId: id,
  state: paymentStateSchema,
  amountRial: rial,
  currency: z.literal('IRR'),
  createdAt: utc,
  orderExpiresAt: utc,
  version,
  containsDemo: z.boolean(),
};
export const paymentAttemptSchema = z
  .object({ schemaVersion: z.literal(1), ...base })
  .strict()
  .refine((x) => ticks(x.createdAt) < ticks(x.orderExpiresAt));
export const paymentReadItemSchema = z
  .object({
    ...base,
    changedAt: utc,
    verifiedAmountRial: rial.nullable(),
    verificationDisposition: z.enum(['applied', 'requires_review']).nullable(),
    verificationReason: z
      .string()
      .regex(/^[a-z_]{1,100}$/)
      .nullable(),
    verifiedAt: utc.nullable(),
  })
  .strict()
  .superRefine((x, c) => {
    const bad = () =>
      c.addIssue({
        code: 'custom',
        message: 'Payment evidence does not match its recorded state.',
      });
    if (ticks(x.createdAt) >= ticks(x.orderExpiresAt) || ticks(x.createdAt) > ticks(x.changedAt))
      bad();
    if (x.verifiedAmountRial === null) {
      if (
        x.verificationDisposition !== null ||
        x.verificationReason !== null ||
        x.verifiedAt !== null ||
        x.state === 'verified'
      )
        bad();
    } else if (
      x.verificationDisposition === null ||
      x.verificationReason === null ||
      x.verifiedAt === null ||
      ticks(x.verifiedAt) < ticks(x.createdAt) ||
      ticks(x.verifiedAt) > ticks(x.changedAt) ||
      x.state !== (x.verificationDisposition === 'applied' ? 'verified' : 'review') ||
      (x.verificationDisposition === 'applied' && x.verifiedAmountRial !== x.amountRial)
    )
      bad();
  });
export const paymentFilterSchema = z
  .object({ state: paymentStateSchema.nullable(), orderId: id.nullable() })
  .strict();
export const paymentPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    filter: paymentFilterSchema,
    items: z.array(paymentReadItemSchema).max(50),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,512}$/)
      .nullable(),
  })
  .strict()
  .superRefine((x, c) => {
    const bad = () =>
      c.addIssue({ code: 'custom', message: 'Payment page does not match its scope.' });
    if (
      new Set(x.items.map((i) => i.id)).size !== x.items.length ||
      (x.nextCursor !== null && x.items.length !== 50) ||
      x.items.some(
        (i) =>
          (x.filter.state !== null && i.state !== x.filter.state) ||
          (x.filter.orderId !== null && i.orderId !== x.filter.orderId),
      )
    )
      bad();
    for (let n = 1; n < x.items.length; n++) {
      const previous = x.items[n - 1],
        current = x.items[n];
      if (
        ticks(current.createdAt) > ticks(previous.createdAt) ||
        (ticks(current.createdAt) === ticks(previous.createdAt) && current.id >= previous.id)
      )
        bad();
    }
  });
export const paymentDetailSchema = z
  .object({ schemaVersion: z.literal(1), attempt: paymentReadItemSchema })
  .strict();
export type PaymentPage = z.infer<typeof paymentPageSchema>;
export type PaymentItem = z.infer<typeof paymentReadItemSchema>;
export type PaymentFilter = z.infer<typeof paymentFilterSchema>;
export function readPaymentPage(value: unknown, filter: PaymentFilter) {
  const data = paymentPageSchema.parse(value);
  if (data.filter.state !== filter.state || data.filter.orderId !== filter.orderId)
    throw Error('Payment page belongs to another filter.');
  return data;
}
export function readCustomerPaymentPage(value: unknown, orderId: string) {
  return readPaymentPage(value, { state: null, orderId: id.parse(orderId) });
}
export function readPaymentAttempt(value: unknown, attemptId: string) {
  const data = paymentDetailSchema.parse(value);
  if (data.attempt.id !== id.parse(attemptId))
    throw Error('Payment response belongs to another attempt.');
  return data;
}
