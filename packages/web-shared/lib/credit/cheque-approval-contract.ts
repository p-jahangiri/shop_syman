import { z } from '../config/schema-runtime.ts';
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
import { chequeSummarySchema } from './cheque-ledger-contract.ts';
import { creditScheduleDateSchema } from './credit-schedule-contract.ts';
export const approvalActionSchema = z.enum(['Approve', 'Revoke']);
export const approvalBodySchema = z
  .strictObject({
    action: approvalActionSchema,
    orderVersion: version,
    scheduleVersion: version,
    ledgerVersion: version,
    version: version.nullable(),
    note: text(500, true),
    occurredAt: at,
    confirmed: z.literal(true),
    acknowledgedClosedOrder: z.boolean(),
  })
  .refine((v) => (v.action === 'Approve' ? !v.acknowledgedClosedOrder : v.version !== null));
export const approvalSummarySchema = z
  .strictObject({
    id,
    approvalId: id,
    orderId: id,
    chequeId: id,
    sequence: z.number().int().min(1).max(200),
    action: approvalActionSchema,
    state: z.enum(['Approved', 'Revoked']),
    version,
    orderVersion: version,
    scheduleVersion: version,
    ledgerVersion: version,
    occurredAt: at,
    recordedAt: at,
    bankVerified: z.literal(false),
  })
  .refine(
    (v) =>
      Date.parse(v.occurredAt) <= Date.parse(v.recordedAt) &&
      (v.action === 'Approve' ? v.state === 'Approved' : v.state === 'Revoked' && v.sequence > 1),
  );
export const approvalEventSchema = z
  .strictObject({
    summary: approvalSummarySchema,
    note: text(500, true),
    previousVersion: version.nullable(),
    acknowledgedClosedOrder: z.boolean(),
  })
  .refine(
    (v) =>
      (v.summary.sequence === 1) === (v.previousVersion === null) &&
      (v.summary.action === 'Revoke' || !v.acknowledgedClosedOrder),
  );
const eligible = (state: string) => ['Received', 'Deposited', 'CollectedReported'].includes(state);
export const approvalItemSchema = z
  .strictObject({
    sequence: z.number().int().min(1).max(60),
    dueDate: creditScheduleDateSchema,
    amountRial: rial.refine((v) => BigInt(v) > 0n),
    cheque: chequeSummarySchema.nullable(),
    current: approvalSummarySchema.nullable(),
    approvedForCurrentCheque: z.boolean(),
  })
  .refine(
    (v) =>
      (v.cheque === null
        ? v.current === null && v.approvedForCurrentCheque === false
        : v.cheque.sequence === v.sequence &&
          v.cheque.dueDate === v.dueDate &&
          v.cheque.amountRial === v.amountRial &&
          (v.current === null ||
            (v.current.chequeId === v.cheque.id && v.current.orderId === v.cheque.orderId))) &&
      (!v.approvedForCurrentCheque ||
        (v.cheque !== null &&
          v.current?.state === 'Approved' &&
          v.current.ledgerVersion === v.cheque.version &&
          eligible(v.cheque.state))),
  );
const safety = {
  bankVerified: z.literal(false),
  canPay: z.literal(false),
  canFulfill: z.literal(false),
};
export const approvalPageSchema = z
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
    scheduleVersion: version.nullable(),
    items: z.array(approvalItemSchema).max(60),
    allChequesApproved: z.boolean(),
    ...safety,
  })
  .refine(
    (p) =>
      p.items.every(
        (x, i) =>
          x.sequence === i + 1 &&
          (x.cheque === null || x.cheque.orderId === p.orderId) &&
          (x.current === null || x.current.orderId === p.orderId) &&
          x.approvedForCurrentCheque ===
            (x.cheque !== null &&
              x.current?.state === 'Approved' &&
              x.current.ledgerVersion === x.cheque.version &&
              x.current.scheduleVersion === p.scheduleVersion &&
              eligible(x.cheque.state)),
      ) &&
      p.allChequesApproved ===
        (p.items.length > 0 && p.items.every((x) => x.approvedForCurrentCheque)) &&
      (p.items.length === 0 || p.scheduleVersion !== null) &&
      new Set(p.items.flatMap((x) => (x.cheque ? [x.cheque.id] : []))).size ===
        p.items.filter((x) => x.cheque).length,
  );
export const approvalDetailSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    item: approvalItemSchema,
    instrumentReference: text(128, true),
    current: approvalEventSchema.nullable(),
    canApprove: z.boolean(),
    canRevoke: z.boolean(),
    closedOrderAcknowledgementRequired: z.boolean(),
  })
  .refine(
    (v) =>
      v.item.cheque !== null &&
      JSON.stringify(v.item.current) === JSON.stringify(v.current?.summary ?? null) &&
      (!v.canApprove ||
        (!v.closedOrderAcknowledgementRequired &&
          !v.item.approvedForCurrentCheque &&
          eligible(v.item.cheque.state))) &&
      (!v.canRevoke || v.current?.summary.state === 'Approved'),
  );
export const approvalHistorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    chequeId: id,
    items: z.array(approvalEventSchema).max(20),
    nextBefore: z.number().int().min(1).max(200).nullable(),
  })
  .refine(
    (v) =>
      v.items.every(
        (e, i) =>
          e.summary.orderId === v.orderId &&
          e.summary.chequeId === v.chequeId &&
          (i === 0 || e.summary.sequence === v.items[i - 1].summary.sequence - 1),
      ) &&
      new Set(v.items.map((x) => x.summary.id)).size === v.items.length &&
      (v.nextBefore === null ||
        (v.items.length === 20 && v.nextBefore === v.items[19].summary.sequence)),
  );
export const approvalResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: id,
    orderId: id,
    chequeId: id,
    event: approvalEventSchema,
    replayed: z.boolean(),
    ...safety,
  })
  .refine((v) => v.event.summary.orderId === v.orderId && v.event.summary.chequeId === v.chequeId);
export const approvalCommandSchema = z.strictObject({
  id,
  ownerId: owner,
  orderId: id,
  chequeId: id,
  body: approvalBodySchema,
});
export type ApprovalBody = z.infer<typeof approvalBodySchema>;
export type ApprovalCommand = z.infer<typeof approvalCommandSchema>;
export type ApprovalResult = z.infer<typeof approvalResultSchema>;
export type ApprovalPage = z.infer<typeof approvalPageSchema>;
export type ApprovalEvent = z.infer<typeof approvalEventSchema>;
export type ApprovalItem = z.infer<typeof approvalItemSchema>;
export type ApprovalAction = z.infer<typeof approvalActionSchema>;
export function approvalAdminBase(ownerId: string, orderId: string) {
  return `/api/admin/credit/orders/${owner.parse(ownerId)}/${id.parse(orderId)}/cheque-approvals`;
}
export function approvalCommandPath(c: ApprovalCommand) {
  approvalCommandSchema.parse(c);
  return approvalAdminBase(c.ownerId, c.orderId).slice(4) + '/' + c.chequeId + '/commands/' + c.id;
}
export function isChequeApprovalPath(path: string, method = 'GET') {
  return (
    method === 'GET' &&
    !/[\s%\\?#]/.test(path) &&
    /^\/api\/credit\/orders\/[a-f0-9]{32}\/cheque-approvals$/.test(path) &&
    !path.includes('/' + '0'.repeat(32) + '/')
  );
}
const instantKey = (v: string) => {
  const [date, fraction = ''] = v.replace(/(?:Z|\+00:00)$/, '').split('.');
  return date + '.' + fraction.padEnd(7, '0');
};
export function readApprovalResult(raw: unknown, c: ApprovalCommand) {
  const r = approvalResultSchema.parse(raw),
    e = r.event,
    b = c.body;
  if (
    r.commandId !== c.id ||
    r.orderId !== c.orderId ||
    r.chequeId !== c.chequeId ||
    e.summary.action !== b.action ||
    e.summary.orderVersion !== b.orderVersion ||
    e.summary.scheduleVersion !== b.scheduleVersion ||
    e.summary.ledgerVersion !== b.ledgerVersion ||
    e.previousVersion !== b.version ||
    e.note !== b.note ||
    e.acknowledgedClosedOrder !== b.acknowledgedClosedOrder ||
    instantKey(e.summary.occurredAt) !== instantKey(b.occurredAt)
  )
    throw Error('Unrelated cheque approval receipt');
  return r;
}
