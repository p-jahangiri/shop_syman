import { z } from './schema-runtime.ts';
import { orderStateSchema } from './order-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((x) => !/^0+$/.test(x)),
  owner = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
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
  hash = z.string().regex(/^[A-F0-9]{64}$/),
  utc = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  rial = z
    .string()
    .max(19)
    .refine((x) => /^(?:0|[1-9]\d{0,18})$/.test(x) && BigInt(x) <= 9223372036854775807n),
  positive = rial.refine((x) => BigInt(x) > 0n),
  seq = z.number().int().min(1).max(200),
  note = z
    .string()
    .min(1)
    .max(500)
    .refine(
      // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
      (x) => x === x.trim() && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(x),
    ),
  safety = { bankVerified: z.literal(false), canPay: z.literal(false) },
  eligibleCustody = (s: string | null) =>
    s !== null && ['Received', 'Deposited', 'CollectedReported'].includes(s);
const cheque = z
  .strictObject({
    sequence: z.number().int().min(1).max(60),
    dueDate: z.iso.date(),
    amountRial: positive,
    chequeId: id.nullable(),
    ledgerVersion: version.nullable(),
    ledgerState: z
      .enum([
        'Received',
        'Deposited',
        'ReturnedToCustomer',
        'CollectedReported',
        'BouncedReported',
        'Withdrawn',
      ])
      .nullable(),
    approvalId: id.nullable(),
    approvalVersion: version.nullable(),
    approved: z.boolean(),
  })
  .refine(
    (x) =>
      (x.chequeId === null) === (x.ledgerVersion === null) &&
      (x.chequeId === null) === (x.ledgerState === null) &&
      (x.approvalId === null) === (x.approvalVersion === null) &&
      (!x.approved ||
        (x.chequeId !== null && x.approvalId !== null && eligibleCustody(x.ledgerState))),
  );
export const clearanceEvidenceSchema = z
  .strictObject({
    financialFingerprint: hash,
    quoteFingerprint: hash,
    scheduleId: id.nullable(),
    scheduleVersion: version.nullable(),
    requiredUpfrontRial: rial,
    upfrontId: id.nullable(),
    upfrontVersion: version.nullable(),
    upfrontState: z.enum(['ReceiptConfirmed', 'NoUpfrontDue', 'Revoked']).nullable(),
    upfrontConfirmed: z.boolean(),
    cheques: z.array(cheque).max(60),
    allChequesApproved: z.boolean(),
  })
  .refine(
    (e) =>
      (e.scheduleId === null) === (e.scheduleVersion === null) &&
      (e.upfrontId === null) === (e.upfrontVersion === null) &&
      (e.upfrontId === null) === (e.upfrontState === null) &&
      e.upfrontConfirmed ===
        (e.upfrontId !== null &&
          (e.requiredUpfrontRial === '0'
            ? e.upfrontState === 'NoUpfrontDue'
            : e.upfrontState === 'ReceiptConfirmed')) &&
      e.cheques.every((x, i) => x.sequence === i + 1) &&
      new Set(e.cheques.flatMap((x) => (x.chequeId ? [x.chequeId] : []))).size ===
        e.cheques.filter((x) => x.chequeId !== null).length &&
      e.allChequesApproved === (e.cheques.length > 0 && e.cheques.every((x) => x.approved)) &&
      (e.cheques.length === 0 || e.scheduleId !== null),
  );
export const clearanceSummarySchema = z
  .strictObject({
    id,
    orderId: id,
    sequence: seq,
    action: z.enum(['Approve', 'Revoke']),
    state: z.enum(['Approved', 'Revoked']),
    version,
    evidenceFingerprint: hash,
    sourceOrderVersion: version,
    resultOrderVersion: version,
    recordedAt: utc,
    bankVerified: z.literal(false),
  })
  .refine((s) =>
    s.action === 'Approve' ? s.state === 'Approved' : s.state === 'Revoked' && s.sequence > 1,
  );
export const clearanceEventSchema = z
  .strictObject({
    summary: clearanceSummarySchema,
    note,
    previousVersion: version.nullable(),
    acknowledgedPartialDispatch: z.literal(true).optional(),
  })
  .refine((e) => (e.previousVersion === null) === (e.summary.sequence === 1));
const blockers = z.enum([
  'order_closed',
  'reservation_not_ready',
  'shipment_already_dispatched',
  'upfront_confirmation_required',
  'all_current_cheques_required',
  'schedule_required',
  'clearance_history_required',
  'history_capacity',
]);
export const clearancePageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    orderVersion: version,
    orderState: orderStateSchema,
    reservationState: z.enum(['Active', 'Allocated', 'Released', 'Expired', 'Fulfilled']),
    shipmentState: z.enum(['packed', 'dispatched', 'delivered']).nullable(),
    evidence: clearanceEvidenceSchema,
    evidenceFingerprint: hash,
    previewFingerprint: hash,
    current: clearanceSummarySchema.nullable(),
    effective: z.boolean(),
    canApprove: z.boolean(),
    canRevoke: z.boolean(),
    blockers: z.array(blockers).max(8),
    ...safety,
  })
  .refine(
    (p) =>
      (p.current === null || p.current.orderId === p.orderId) &&
      p.effective ===
        (p.current?.state === 'Approved' &&
          p.current.evidenceFingerprint === p.evidenceFingerprint &&
          p.evidence.upfrontConfirmed &&
          p.evidence.allChequesApproved) &&
      new Set(p.blockers).size === p.blockers.length &&
      (!p.canApprove ||
        (p.blockers.length === 0 &&
          !p.effective &&
          p.evidence.scheduleId !== null &&
          p.evidence.upfrontConfirmed &&
          p.evidence.allChequesApproved)) &&
      (!p.canRevoke ||
        (p.current?.state === 'Approved' &&
          p.current.sequence < 200 &&
          p.orderState === 'CreditApproved' &&
          (p.shipmentState === null ||
            p.shipmentState === 'packed' ||
            (p.shipmentState === 'dispatched' && p.reservationState === 'Allocated')))),
  );
export const clearanceCustomerSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    orderState: orderStateSchema,
    current: clearanceSummarySchema.nullable(),
    effective: z.boolean(),
    ...safety,
  })
  .refine(
    (p) =>
      (p.current === null || p.current.orderId === p.orderId) &&
      (!p.effective || p.current?.state === 'Approved'),
  );
export const clearanceHistorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    items: z.array(clearanceEventSchema).max(20),
    nextBefore: seq.nullable(),
  })
  .refine(
    (h) =>
      h.items.every(
        (e, i) =>
          e.summary.orderId === h.orderId &&
          (i === 0 ||
            (e.summary.sequence === h.items[i - 1].summary.sequence - 1 &&
              e.summary.version === h.items[i - 1].previousVersion)),
      ) &&
      new Set(h.items.map((x) => x.summary.id)).size === h.items.length &&
      (h.nextBefore === null ||
        (h.items.length === 20 && h.nextBefore === h.items[19].summary.sequence)),
  );
export const clearanceBodySchema = z
  .strictObject({
    action: z.enum(['Approve', 'Revoke']),
    orderVersion: version,
    version: version.nullable(),
    previewFingerprint: hash,
    note,
    confirmed: z.literal(true),
    acknowledgedPartialDispatch: z.literal(true).optional(),
  })
  .refine(
    (x) =>
      (x.action === 'Approve' || x.version !== null) &&
      (!x.acknowledgedPartialDispatch || x.version !== null),
  );
export const clearanceResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: id,
    orderId: id,
    event: clearanceEventSchema,
    initialCommit: z.boolean(),
    replayed: z.boolean(),
    ...safety,
  })
  .refine(
    (r) =>
      r.event.summary.orderId === r.orderId &&
      r.initialCommit === (r.event.summary.sequence === 1) &&
      (!r.initialCommit || r.event.summary.action === 'Approve'),
  );
export const clearanceCommandSchema = z
  .strictObject({
    id,
    ownerId: owner,
    orderId: id,
    body: clearanceBodySchema,
    previewSnapshot: clearancePageSchema,
  })
  .refine(
    (c) =>
      c.orderId === c.previewSnapshot.orderId &&
      c.body.orderVersion === c.previewSnapshot.orderVersion &&
      c.body.version === (c.previewSnapshot.current?.version ?? null) &&
      c.body.previewFingerprint === c.previewSnapshot.previewFingerprint &&
      (c.body.acknowledgedPartialDispatch === true) ===
        (c.previewSnapshot.shipmentState === 'dispatched' &&
          c.previewSnapshot.reservationState === 'Allocated') &&
      (c.body.action === 'Approve' ? c.previewSnapshot.canApprove : c.previewSnapshot.canRevoke),
  );
export type ClearanceCommand = z.infer<typeof clearanceCommandSchema>;
export type ClearanceResult = z.infer<typeof clearanceResultSchema>;
export type ClearancePage = z.infer<typeof clearancePageSchema>;
export type ClearanceHistory = z.infer<typeof clearanceHistorySchema>;
export type ClearanceCustomer = z.infer<typeof clearanceCustomerSchema>;
export function clearanceBase(ownerId: string, orderId: string) {
  return '/admin/credit/orders/' + owner.parse(ownerId) + '/' + id.parse(orderId) + '/clearance';
}
export function readClearanceResult(raw: unknown, command: ClearanceCommand) {
  const c = clearanceCommandSchema.parse(command),
    r = clearanceResultSchema.parse(raw),
    s = r.event.summary;
  if (
    r.commandId !== c.id ||
    r.orderId !== c.orderId ||
    s.action !== c.body.action ||
    s.sourceOrderVersion !== c.body.orderVersion ||
    r.event.previousVersion !== c.body.version ||
    s.evidenceFingerprint !== c.previewSnapshot.evidenceFingerprint ||
    s.sequence !== (c.previewSnapshot.current?.sequence ?? 0) + 1 ||
    r.event.note !== c.body.note ||
    (r.event.acknowledgedPartialDispatch === true) !==
      (c.body.acknowledgedPartialDispatch === true) ||
    s.version === c.body.version ||
    r.initialCommit !== (c.previewSnapshot.current === null) ||
    (!r.initialCommit && s.resultOrderVersion !== s.sourceOrderVersion) ||
    (r.initialCommit && s.resultOrderVersion === s.sourceOrderVersion)
  )
    throw Error('Unrelated financial clearance receipt');
  return r;
}

export function isCreditClearancePath(path: string, method = 'GET') {
  return (
    method === 'GET' &&
    !/[\s%\\?#]/.test(path) &&
    /^\/api\/credit\/orders\/[a-f0-9]{32}\/clearance$/.test(path) &&
    !path.includes('/' + '0'.repeat(32) + '/')
  );
}
