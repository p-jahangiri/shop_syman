import { z } from '../config/schema-runtime.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((v) => !/^0+$/.test(v)),
  owner = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  hash = z.string().regex(/^[A-F0-9]{64}$/),
  version = z
    .string()
    .regex(/^[A-Za-z0-9+/]{11}=$/)
    .refine((v) => {
      try {
        return btoa(atob(v)) === v && atob(v).length === 8;
      } catch {
        return false;
      }
    }),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  money = z
    .string()
    .max(19)
    .refine((v) => /^(?:0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n),
  positive = money.refine((v) => money.safeParse(v).success && BigInt(v) > 0n),
  calendar = z.enum(['Persian', 'Gregorian']),
  state = z.enum([
    'AwaitingPayment',
    'Paid',
    'Cancelled',
    'Expired',
    'Fulfilled',
    'CreditApproved',
  ]),
  integer = z.number().int().min(1).max(2147483647);
export const creditScheduleDateSchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .refine((v) => {
    const x = new Date(v + 'T12:00:00Z');
    return (
      Number.isFinite(x.getTime()) &&
      Number(v.slice(0, 4)) >= 1 &&
      x.toISOString().slice(0, 10) === v
    );
  });
const line = z
  .object({
    sequence: z.number().int().min(1).max(60),
    monthOffset: z.number().int().min(1).max(60),
    dueDate: creditScheduleDateSchema,
    amountRial: positive,
  })
  .strict();
export const creditScheduleCalculationSchema = z
  .object({
    calendarKind: calendar,
    anchorDate: creditScheduleDateSchema,
    timeZone: z.literal('Asia/Tehran'),
    planDownPaymentRial: money,
    chargesOutsideChequesRial: money,
    upfrontTotalRial: money,
    installmentsTotalRial: money,
    payableTotalRial: positive,
    lines: z.array(line).max(60),
  })
  .strict()
  .refine((x) => {
    if (
      ![
        x.planDownPaymentRial,
        x.chargesOutsideChequesRial,
        x.upfrontTotalRial,
        x.installmentsTotalRial,
        x.payableTotalRial,
        ...x.lines.map((l) => l.amountRial),
      ].every((v) => money.safeParse(v).success)
    )
      return false;
    if (
      BigInt(x.planDownPaymentRial) + BigInt(x.chargesOutsideChequesRial) !==
        BigInt(x.upfrontTotalRial) ||
      BigInt(x.upfrontTotalRial) + BigInt(x.installmentsTotalRial) !== BigInt(x.payableTotalRial) ||
      x.lines.reduce((sum, l) => sum + BigInt(l.amountRial), 0n) !== BigInt(x.installmentsTotalRial)
    )
      return false;
    let offset = 0,
      due = x.anchorDate;
    for (let i = 0; i < x.lines.length; i++) {
      const l = x.lines[i];
      if (l.sequence !== i + 1 || l.monthOffset <= offset || l.dueDate <= due) return false;
      offset = l.monthOffset;
      due = l.dueDate;
    }
    return (x.lines.length === 0) === (x.installmentsTotalRial === '0');
  });
export const creditSchedulePreviewInputSchema = z
  .object({
    orderVersion: version,
    scheduleVersion: version.nullable(),
    calendarKind: calendar,
    anchorDate: creditScheduleDateSchema,
  })
  .strict();
export const creditScheduleSaveInputSchema = creditSchedulePreviewInputSchema
  .extend({ previewFingerprint: hash, confirmed: z.literal(true) })
  .strict();
export const creditSchedulePreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: id,
    orderVersion: version,
    scheduleVersion: version.nullable(),
    fingerprint: hash,
    creditQuoteId: id,
    quoteFingerprint: hash,
    planName: z.string().min(1).max(200),
    locale: z.enum(['fa', 'en']),
    calculation: creditScheduleCalculationSchema,
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict();
export const creditScheduleRevisionSchema = z
  .object({
    id,
    orderId: id,
    revision: integer,
    version,
    creditQuoteId: id,
    quoteFingerprint: hash,
    planName: z.string().min(1).max(200),
    locale: z.enum(['fa', 'en']),
    calculation: creditScheduleCalculationSchema,
    createdAt: at,
    state: z.literal('Planned'),
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict();
export const creditScheduleResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    revision: creditScheduleRevisionSchema,
  })
  .strict();
export const creditSchedulePageSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: id,
    orderVersion: version,
    orderState: state,
    current: creditScheduleRevisionSchema.nullable(),
    canAmend: z.boolean(),
    blockers: z
      .array(z.enum(['credit_schedule_order_closed', 'credit_schedule_instruments_recorded']))
      .max(2),
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      (!x.current || x.current.orderId === x.orderId) &&
      (!x.canAmend || (x.orderState === 'AwaitingPayment' && x.blockers.length === 0)) &&
      (x.orderState === 'AwaitingPayment' || x.blockers.includes('credit_schedule_order_closed')),
  );
export const creditScheduleHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: id,
    items: z.array(creditScheduleRevisionSchema).max(20),
    nextRevision: integer.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      x.items.every(
        (r, i) => r.orderId === x.orderId && (i === 0 || r.revision < x.items[i - 1].revision),
      ) &&
      new Set(x.items.map((r) => r.id)).size === x.items.length &&
      (x.nextRevision === null ||
        (x.items.length === 20 && x.nextRevision === x.items.at(-1)!.revision)),
  );
export const creditScheduleOrderSummarySchema = z
  .object({
    orderId: id,
    ownerId: owner,
    reference: z.string().min(1).max(64),
    locale: z.enum(['fa', 'en']),
    state,
    createdAt: at,
    expiresAt: at,
    payableTotalRial: positive,
    itemCount: z.number().int().min(1).max(1000000),
    version,
  })
  .strict()
  .refine((x) => Date.parse(x.expiresAt) > Date.parse(x.createdAt));
export const creditScheduleOrderQueueSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(creditScheduleOrderSummarySchema).max(20),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .max(180)
      .nullable(),
  })
  .strict()
  .refine((x) => new Set(x.items.map((r) => r.orderId)).size === x.items.length);
export const creditScheduleCommandSchema = z
  .object({
    id,
    ownerId: owner,
    orderId: id,
    body: creditScheduleSaveInputSchema,
    previewSnapshot: creditSchedulePreviewSchema,
  })
  .strict()
  .refine(
    (c) =>
      c.orderId === c.previewSnapshot.orderId &&
      c.body.orderVersion === c.previewSnapshot.orderVersion &&
      c.body.scheduleVersion === c.previewSnapshot.scheduleVersion &&
      c.body.previewFingerprint === c.previewSnapshot.fingerprint &&
      c.body.calendarKind === c.previewSnapshot.calculation.calendarKind &&
      c.body.anchorDate === c.previewSnapshot.calculation.anchorDate,
  );
export type CreditScheduleCalculation = z.infer<typeof creditScheduleCalculationSchema>;
export type CreditScheduleRevision = z.infer<typeof creditScheduleRevisionSchema>;
export type CreditSchedulePage = z.infer<typeof creditSchedulePageSchema>;
export type CreditSchedulePreview = z.infer<typeof creditSchedulePreviewSchema>;
export type CreditSchedulePreviewInput = z.infer<typeof creditSchedulePreviewInputSchema>;
export type CreditScheduleSaveInput = z.infer<typeof creditScheduleSaveInputSchema>;
export type CreditScheduleResult = z.infer<typeof creditScheduleResultSchema>;
export type CreditScheduleHistory = z.infer<typeof creditScheduleHistorySchema>;
export type CreditScheduleOrderQueue = z.infer<typeof creditScheduleOrderQueueSchema>;
export type CreditScheduleCommand = z.infer<typeof creditScheduleCommandSchema>;
export function readCreditSchedulePreview(
  raw: unknown,
  orderId: string,
  input: CreditSchedulePreviewInput,
) {
  const q = creditSchedulePreviewSchema.parse(raw),
    i = creditSchedulePreviewInputSchema.parse(input);
  if (
    q.orderId !== id.parse(orderId) ||
    q.orderVersion !== i.orderVersion ||
    q.scheduleVersion !== i.scheduleVersion ||
    q.calculation.calendarKind !== i.calendarKind ||
    q.calculation.anchorDate !== i.anchorDate
  )
    throw Error('Wrong dated cheque preview');
  return q;
}
export function readCreditScheduleResult(raw: unknown, command: CreditScheduleCommand) {
  const c = creditScheduleCommandSchema.parse(command),
    r = creditScheduleResultSchema.parse(raw),
    p = c.previewSnapshot;
  if (
    r.commandId !== c.id ||
    r.revision.orderId !== c.orderId ||
    r.revision.creditQuoteId !== p.creditQuoteId ||
    r.revision.quoteFingerprint !== p.quoteFingerprint ||
    r.revision.planName !== p.planName ||
    r.revision.locale !== p.locale ||
    JSON.stringify(r.revision.calculation) !== JSON.stringify(p.calculation) ||
    (c.body.scheduleVersion === null ? r.revision.revision !== 1 : r.revision.revision < 2) ||
    r.revision.version === c.body.scheduleVersion
  )
    throw Error('Wrong frozen dated cheque receipt');
  return r;
}
export const creditScheduleAdminBase = (ownerId: string, orderId: string) =>
  '/api/admin/credit/orders/' + owner.parse(ownerId) + '/' + id.parse(orderId) + '/schedule';
export function isCreditSchedulePath(path: string, method = 'GET') {
  if (method !== 'GET' || path.includes('#') || /(?:^|\/)0{32}(?:\/|$)/.test(path)) return false;
  return (
    /^\/api\/credit\/orders\/[a-f0-9]{32}\/schedule(?:\/history(?:\?beforeRevision=[1-9][0-9]{0,9})?)?$/.test(
      path,
    ) &&
    (!path.includes('?') || Number(path.split('=').at(-1)) <= 2147483647)
  );
}
export function isCreditScheduleAdminPath(path: string, method = 'GET') {
  if (path.includes('#') || /(?:^|\/)0{32}(?:\/|$)/.test(path)) return false;
  if (method === 'GET' && path.startsWith('/api/admin/credit/orders?')) {
    try {
      const u = new URL(path, 'http://localhost'),
        entries = [...u.searchParams],
        value = u.searchParams.get('cursor');
      return (
        entries.length === 1 &&
        entries[0][0] === 'cursor' &&
        value !== null &&
        value.length <= 180 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
        u.search === '?cursor=' + encodeURIComponent(value)
      );
    } catch {
      return false;
    }
  }
  const base = '^/api/admin/credit/orders/[A-Za-z0-9_-]{1,64}/[a-f0-9]{32}/schedule';
  return (
    (method === 'GET' &&
      (path === '/api/admin/credit/orders' ||
        (new RegExp(
          base + '(?:/commands/[a-f0-9]{32}|/history(?:\\?beforeRevision=[1-9][0-9]{0,9})?)?$',
        ).test(path) &&
          (!path.includes('?') || Number(path.split('=').at(-1)) <= 2147483647)))) ||
    (method === 'POST' && new RegExp(base + '/(?:preview|commands/[a-f0-9]{32})$').test(path))
  );
}
