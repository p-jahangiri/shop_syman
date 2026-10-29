import { z } from './schema-runtime.ts';
const id = z
    .string()
    .length(32)
    .regex(/^[a-f0-9]{32}$/)
    .refine((v) => !/^0+$/.test(v)),
  owner = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .refine((v) => v === v.trim()),
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
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/)
    .refine((v) => Number(v.slice(0, 4)) >= 2000 && !/\s/.test(v)),
  rial = z
    .string()
    .max(19)
    .refine(
      (v) =>
        v === v.trim() && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n,
    );
const text = (max: number, required = false) =>
  z
    .string()
    .max(max)
    .refine(
      (v) =>
        v === v.trim() &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(v) &&
        Array.from(v).every(
          (c) => c.length !== 1 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff,
        ) &&
        (!required || v.length > 0),
    );
export const upfrontActionSchema = z.enum([
  'ConfirmReceipt',
  'ConfirmNoUpfrontDue',
  'RevokeConfirmation',
]);
export const upfrontBodySchema = z
  .strictObject({
    action: upfrontActionSchema,
    orderVersion: version,
    scheduleVersion: version,
    version: version.nullable(),
    reference: text(256),
    note: text(500),
    occurredAt: at,
    confirmed: z.literal(true),
    acknowledgedClosedOrder: z.boolean(),
    acknowledgedCommittedOrder: z.boolean().optional(),
  })
  .refine(
    (v) =>
      (v.action === 'ConfirmReceipt' ? v.reference.length > 0 : v.reference === '') &&
      (v.action !== 'RevokeConfirmation' || (v.version !== null && v.note.length > 0)) &&
      (v.action === 'RevokeConfirmation' || !v.acknowledgedClosedOrder) &&
      (!v.acknowledgedCommittedOrder ||
        (v.version !== null && v.note.length > 0 && !v.acknowledgedClosedOrder)),
  );
export const upfrontSummarySchema = z
  .strictObject({
    id,
    confirmationId: id,
    orderId: id,
    sequence: z.number().int().min(1).max(200),
    action: upfrontActionSchema,
    state: z.enum(['ReceiptConfirmed', 'NoUpfrontDue', 'Revoked']),
    requiredAmountRial: rial,
    acknowledgedAmountRial: rial,
    version,
    occurredAt: at,
    recordedAt: at,
    bankVerified: z.literal(false),
  })
  .refine(
    (v) =>
      Date.parse(v.occurredAt) <= Date.parse(v.recordedAt) &&
      (v.action === 'ConfirmReceipt'
        ? v.state === 'ReceiptConfirmed' &&
          BigInt(v.requiredAmountRial) > 0n &&
          v.requiredAmountRial === v.acknowledgedAmountRial
        : v.action === 'ConfirmNoUpfrontDue'
          ? v.state === 'NoUpfrontDue' &&
            v.requiredAmountRial === '0' &&
            v.acknowledgedAmountRial === '0'
          : v.state === 'Revoked' && v.sequence > 1 && v.acknowledgedAmountRial === '0'),
  );
export const upfrontEventSchema = z
  .strictObject({
    summary: upfrontSummarySchema,
    reference: text(256),
    note: text(500),
    orderVersion: version,
    scheduleVersion: version,
    previousVersion: version.nullable(),
    acknowledgedClosedOrder: z.boolean(),
    acknowledgedCommittedOrder: z.boolean().optional(),
  })
  .refine(
    (v) =>
      (v.summary.sequence === 1) === (v.previousVersion === null) &&
      (v.summary.action === 'ConfirmReceipt' ? v.reference.length > 0 : v.reference === '') &&
      (v.summary.action !== 'RevokeConfirmation' || v.note.length > 0) &&
      (v.summary.action === 'RevokeConfirmation' || !v.acknowledgedClosedOrder) &&
      (!v.acknowledgedCommittedOrder ||
        (v.previousVersion !== null && v.note.length > 0 && !v.acknowledgedClosedOrder)),
  );
const safety = {
  bankVerified: z.literal(false),
  canPay: z.literal(false),
  canFulfill: z.literal(false),
};
export const upfrontPageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    orderVersion: version,
    orderState: z.enum([
      'AwaitingPayment',
      'Paid',
      'Cancelled',
      'Expired',
      'Fulfilled',
      'CreditApproved',
    ]),
    requiredAmountRial: rial,
    scheduleVersion: version.nullable(),
    current: upfrontSummarySchema.nullable(),
    canConfirmReceipt: z.boolean(),
    canConfirmNoUpfrontDue: z.boolean(),
    canRevoke: z.boolean(),
    blockers: z
      .array(
        z.enum([
          'order_closed',
          'schedule_required',
          'history_capacity',
          'shipment_already_dispatched',
        ]),
      )
      .max(3),
    ...safety,
  })
  .refine(
    (v) =>
      (v.current === null ||
        (v.current.orderId === v.orderId &&
          v.current.requiredAmountRial === v.requiredAmountRial)) &&
      new Set(v.blockers).size === v.blockers.length &&
      ((!v.canConfirmReceipt && !v.canConfirmNoUpfrontDue) ||
        ((v.orderState === 'AwaitingPayment' ||
          (v.orderState === 'CreditApproved' && v.current !== null)) &&
          v.scheduleVersion !== null &&
          v.blockers.length === 0 &&
          (v.current === null || v.current.state === 'Revoked'))) &&
      (!v.canConfirmReceipt || BigInt(v.requiredAmountRial) > 0n) &&
      (!v.canConfirmNoUpfrontDue || v.requiredAmountRial === '0') &&
      (!v.canRevoke ||
        (v.scheduleVersion !== null &&
          v.current !== null &&
          v.current.sequence < 200 &&
          ['ReceiptConfirmed', 'NoUpfrontDue'].includes(v.current.state) &&
          ['AwaitingPayment', 'Cancelled', 'Expired', 'CreditApproved'].includes(v.orderState) &&
          !v.blockers.includes('shipment_already_dispatched'))),
  );
export const upfrontCustomerSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    requiredAmountRial: rial,
    current: upfrontSummarySchema.nullable(),
    ...safety,
  })
  .refine(
    (v) =>
      v.current === null ||
      (v.current.orderId === v.orderId && v.current.requiredAmountRial === v.requiredAmountRial),
  );
export const upfrontHistorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    items: z.array(upfrontEventSchema).max(20),
    nextBefore: z.number().int().min(1).max(200).nullable(),
  })
  .refine(
    (v) =>
      v.items.every(
        (e, i) =>
          e.summary.orderId === v.orderId &&
          (i === 0 || v.items[i - 1].summary.sequence === e.summary.sequence + 1),
      ) &&
      new Set(v.items.map((e) => e.summary.id)).size === v.items.length &&
      (v.nextBefore === null ||
        (v.items.length === 20 && v.nextBefore === v.items[19].summary.sequence)),
  );
export const upfrontResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: id,
    orderId: id,
    event: upfrontEventSchema,
    replayed: z.boolean(),
    ...safety,
  })
  .refine((v) => v.event.summary.orderId === v.orderId);
export const upfrontCommandSchema = z.strictObject({
  id,
  ownerId: owner,
  orderId: id,
  body: upfrontBodySchema,
});
export type UpfrontSummary = z.infer<typeof upfrontSummarySchema>;
export type UpfrontPage = z.infer<typeof upfrontPageSchema>;
export type UpfrontBody = z.infer<typeof upfrontBodySchema>;
export type UpfrontCommand = z.infer<typeof upfrontCommandSchema>;
export type UpfrontResult = z.infer<typeof upfrontResultSchema>;
export type UpfrontEvent = z.infer<typeof upfrontEventSchema>;
export type UpfrontAction = z.infer<typeof upfrontActionSchema>;
export function upfrontAdminBase(ownerId: string, orderId: string) {
  return `/api/admin/credit/orders/${owner.parse(ownerId)}/${id.parse(orderId)}/upfront`;
}
export function upfrontCommandPath(c: UpfrontCommand) {
  upfrontCommandSchema.parse(c);
  return upfrontAdminBase(c.ownerId, c.orderId).slice(4) + '/commands/' + c.id;
}
export function isCreditUpfrontPath(path: string, method = 'GET') {
  return (
    method === 'GET' &&
    !/[\s%\\?#]/.test(path) &&
    /^\/api\/credit\/orders\/[a-f0-9]{32}\/upfront$/.test(path) &&
    !path.includes('/' + '0'.repeat(32) + '/')
  );
}
const instantKey = (v: string) => {
  const raw = v.replace(/(?:Z|\+00:00)$/, ''),
    [date, fraction = ''] = raw.split('.');
  return date + '.' + fraction.padEnd(7, '0');
};
export function readUpfrontResult(raw: unknown, c: UpfrontCommand) {
  const r = upfrontResultSchema.parse(raw),
    e = r.event,
    b = c.body;
  if (
    r.commandId !== c.id ||
    r.orderId !== c.orderId ||
    e.summary.action !== b.action ||
    e.reference !== b.reference ||
    e.note !== b.note ||
    e.orderVersion !== b.orderVersion ||
    e.scheduleVersion !== b.scheduleVersion ||
    e.previousVersion !== b.version ||
    e.acknowledgedClosedOrder !== b.acknowledgedClosedOrder ||
    (e.acknowledgedCommittedOrder ?? false) !== (b.acknowledgedCommittedOrder ?? false) ||
    instantKey(e.summary.occurredAt) !== instantKey(b.occurredAt)
  )
    throw Error('Unrelated upfront receipt');
  return r;
}
