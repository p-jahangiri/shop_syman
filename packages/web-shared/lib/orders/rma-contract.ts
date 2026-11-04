import { z } from '../config/schema-runtime.ts';

const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((s) => s.length === 32 && !/^0+$/.test(s));
const key = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .refine((s) => !/[^A-Za-z0-9_-]/.test(s));
const version = z
  .string()
  .regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/)
  .refine((s) => s.length === 12);
const hash = z
  .string()
  .regex(/^[A-F0-9]{64}$/)
  .refine((s) => s.length === 64);
const utc = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const text = (max: number, required = true) =>
  z
    .string()
    .max(max)
    .refine(
      (s) =>
        (!required || s.trim().length > 0) &&
        // eslint-disable-next-line no-control-regex -- Reject dangerous control/bidi characters at the API boundary.
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(s),
    );
const quantity = z.number().int().min(1).max(1000000);
const count = z.number().int().min(0).max(1000000);
const state = z.enum(['submitted', 'reviewing', 'reviewed', 'withdrawn']);
const outcome = z.enum(['followUp', 'declined']).nullable();
const kind = z.enum(['physicalReturn', 'digitalComplaint']);
const policyFields = {
  enabled: z.boolean(),
  physicalReturns: z.boolean(),
  digitalComplaints: z.boolean(),
  conditionsFa: text(4000),
  conditionsEn: text(4000),
  windowMode: z.enum(['manualReview', 'deliveryDays']),
  windowDays: z.number().int().min(1).max(3650).nullable(),
};
const policyValid = (p: {
  windowMode: string;
  windowDays: number | null;
  enabled: boolean;
  physicalReturns: boolean;
  digitalComplaints: boolean;
}) =>
  (p.windowMode === 'deliveryDays' ? p.windowDays !== null : p.windowDays === null) &&
  (!p.enabled || p.physicalReturns || p.digitalComplaints);
const unavailable = {
  canRefund: z.literal(false),
  refundAvailability: z.literal('provider_unconfigured'),
};
export const rmaPublicPolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    configured: z.boolean(),
    enabled: z.boolean(),
    physicalReturns: z.boolean(),
    digitalComplaints: z.boolean(),
    conditionsFa: text(4000).nullable(),
    conditionsEn: text(4000).nullable(),
    windowMode: z.enum(['manualReview', 'deliveryDays']).nullable(),
    windowDays: z.number().int().min(1).max(3650).nullable(),
    ...unavailable,
  })
  .refine((p) =>
    p.configured
      ? p.conditionsFa !== null &&
        p.conditionsEn !== null &&
        p.windowMode !== null &&
        policyValid({ ...p, windowMode: p.windowMode })
      : !p.enabled &&
        !p.physicalReturns &&
        !p.digitalComplaints &&
        p.conditionsFa === null &&
        p.conditionsEn === null &&
        p.windowMode === null &&
        p.windowDays === null,
  );
export const rmaPolicyDataSchema = z
  .strictObject({
    id,
    revision: z.number().int().min(1).max(10000),
    version,
    ...policyFields,
    maxOpenPerOwner: z.number().int().min(1).max(10000).nullable(),
    at: utc,
  })
  .refine(policyValid);
export const rmaPolicyCurrentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  current: rmaPolicyDataSchema.nullable(),
  ...unavailable,
});
export const rmaPolicyHistorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    items: z.array(rmaPolicyDataSchema).max(20),
    nextBefore: z.number().int().min(1).max(10000).nullable(),
  })
  .refine(
    (p) =>
      new Set(p.items.map((x) => x.id)).size === p.items.length &&
      p.items.every((x, i) => i === 0 || x.revision < p.items[i - 1].revision) &&
      (p.nextBefore === null || p.nextBefore === p.items.at(-1)?.revision),
  );
export const rmaPolicyInputSchema = z
  .strictObject({
    version: version.nullable(),
    ...policyFields,
    maxOpenPerOwner: z.number().int().min(1).max(10000).nullable(),
    note: text(1000),
    confirmed: z.literal(true),
  })
  .refine(policyValid);
export const rmaPolicyResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: id,
    replayed: z.boolean(),
    policy: rmaPolicyCurrentSchema,
  })
  .refine((r) => r.policy.current !== null);
const identity = {
  lineKey: key,
  variantId: key,
  sku: text(80),
  name: text(250),
  label: z.string().max(524288),
  isDigital: z.boolean(),
  orderedQuantity: quantity,
  handedOffOrAvailableQuantity: count,
};
const contextLine = z
  .strictObject({ ...identity, requestableQuantity: count })
  .refine(
    (l) =>
      l.requestableQuantity <= l.handedOffOrAvailableQuantity &&
      l.handedOffOrAvailableQuantity <= l.orderedQuantity,
  );
export const rmaContextSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    originalSnapshotVersion: z.union([z.literal(1), z.literal(2)]),
    orderVersion: version,
    orderState: z.enum([
      'AwaitingPayment',
      'Paid',
      'CreditApproved',
      'Fulfilled',
      'Cancelled',
      'Expired',
    ]),
    snapshotHash: hash,
    policy: rmaPolicyCurrentSchema,
    lines: z.array(contextLine).min(1).max(64),
    canRequest: z.boolean(),
    blockers: z
      .array(
        z
          .string()
          .regex(/^[a-z_]{1,100}$/)
          .refine((s) => !/[^a-z_]/.test(s)),
      )
      .max(20),
    canRefund: z.literal(false),
    canRestock: z.literal(false),
    canReship: z.literal(false),
  })
  .refine(
    (c) =>
      new Set(c.lines.map((l) => l.lineKey)).size === c.lines.length &&
      (!c.canRequest ||
        (c.blockers.length === 0 &&
          c.policy.current?.enabled === true &&
          c.lines.some((l) => l.requestableQuantity > 0) &&
          ['Paid', 'CreditApproved', 'Fulfilled'].includes(c.orderState))) &&
      (c.canRequest || c.blockers.length > 0) &&
      c.lines.every(
        (l) =>
          l.requestableQuantity === 0 ||
          (c.policy.current?.enabled === true &&
            (l.isDigital ? c.policy.current.digitalComplaints : c.policy.current.physicalReturns)),
      ),
  );
export const rmaSummarySchema = z
  .strictObject({
    id,
    reference: z
      .string()
      .regex(/^RMA-[1-9][0-9]{0,18}$/)
      .refine((s) => !/\s/.test(s)),
    orderId: id,
    locale: z.enum(['fa', 'en']),
    kind,
    state,
    outcome,
    isOpen: z.boolean(),
    version,
    itemCount: z.number().int().min(1).max(64000000),
    createdAt: utc,
    changedAt: utc,
    ownerId: key.optional(),
  })
  .refine(
    (c) =>
      Date.parse(c.changedAt) >= Date.parse(c.createdAt) &&
      (c.state === 'reviewed'
        ? c.outcome !== null && c.isOpen === (c.outcome === 'followUp')
        : c.outcome === null && c.isOpen === (c.state !== 'withdrawn')),
  );
const line = z
  .strictObject({ ...identity, quantity })
  .refine(
    (l) =>
      l.quantity <= l.handedOffOrAvailableQuantity &&
      l.handedOffOrAvailableQuantity <= l.orderedQuantity,
  );
const event = z
  .strictObject({
    sequence: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine((s) => !/\s/.test(s)),
    action: z.enum(['submitted', 'withdrawn', 'startReview', 'completeReview']),
    state,
    outcome,
    author: z.enum(['customer', 'staff']),
    at: utc,
    message: text(4000, false).nullable(),
    staffNote: text(4000, false).optional(),
  })
  .refine((e) =>
    e.action === 'submitted'
      ? e.author === 'customer' &&
        e.state === 'submitted' &&
        e.outcome === null &&
        e.message === null &&
        e.staffNote === undefined
      : e.action === 'withdrawn'
        ? e.author === 'customer' &&
          e.state === 'withdrawn' &&
          e.outcome === null &&
          e.message !== null &&
          e.staffNote === undefined
        : e.author === 'staff' &&
          (e.action === 'startReview'
            ? e.state === 'reviewing' && e.outcome === null
            : e.state === 'reviewed' && e.outcome !== null),
  );
export const rmaDetailSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    case: rmaSummarySchema,
    originalSnapshotVersion: z.union([z.literal(1), z.literal(2)]),
    snapshotHash: hash,
    policy: rmaPolicyDataSchema,
    reason: text(4000),
    lines: z.array(line).min(1).max(64),
    events: z.array(event).min(1).max(1000),
    canWithdraw: z.boolean(),
    ...unavailable,
    canReceive: z.literal(false),
    canRestock: z.literal(false),
    canReship: z.literal(false),
  })
  .refine(
    (d) =>
      new Set(d.lines.map((l) => l.lineKey)).size === d.lines.length &&
      d.lines.reduce((n, l) => n + l.quantity, 0) === d.case.itemCount &&
      d.lines.every((l) => l.isDigital === (d.case.kind === 'digitalComplaint')) &&
      d.canWithdraw === d.case.isOpen &&
      d.events.every(
        (e, i) =>
          (i === 0 || BigInt(e.sequence) > BigInt(d.events[i - 1].sequence)) &&
          Date.parse(e.at) >= Date.parse(d.case.createdAt) &&
          Date.parse(e.at) <= Date.parse(d.case.changedAt),
      ) &&
      d.events.at(-1)?.state === d.case.state &&
      d.events.at(-1)?.outcome === d.case.outcome &&
      d.events[0].action === 'submitted' &&
      Date.parse(d.events[0].at) === Date.parse(d.case.createdAt) &&
      Date.parse(d.events.at(-1)!.at) === Date.parse(d.case.changedAt) &&
      new Set(d.events.map((e) => e.action)).size === d.events.length &&
      d.policy.enabled &&
      (d.case.kind === 'physicalReturn' ? d.policy.physicalReturns : d.policy.digitalComplaints),
  );
export const rmaPageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    items: z.array(rmaSummarySchema).max(20),
    nextCursor: z
      .string()
      .max(180)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine((s) => !/\s/.test(s))
      .nullable(),
  })
  .refine((p) => new Set(p.items.map((c) => c.id)).size === p.items.length);
export const rmaCommandResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: id,
  payloadHash: hash,
  replayed: z.boolean(),
  case: rmaDetailSchema,
});
export const rmaCreateInputSchema = z
  .strictObject({
    policyRevisionId: id,
    orderVersion: version,
    kind,
    lines: z
      .array(z.strictObject({ lineKey: key, quantity }))
      .min(1)
      .max(64),
    reason: text(4000),
    acknowledgeNoFinancialAction: z.literal(true),
  })
  .refine((c) => new Set(c.lines.map((l) => l.lineKey)).size === c.lines.length);
export const rmaWithdrawInputSchema = z.strictObject({
  version,
  reason: text(4000),
  confirmed: z.literal(true),
});
export const rmaReviewInputSchema = z
  .strictObject({
    ownerId: key,
    version,
    action: z.enum(['startReview', 'completeReview']),
    outcome,
    note: text(4000),
    customerMessage: text(2000).nullable(),
    acknowledgeNoFinancialAction: z.literal(true),
  })
  .refine((x) => (x.action === 'startReview' ? x.outcome === null : x.outcome !== null));
export type RmaPublicPolicy = z.infer<typeof rmaPublicPolicySchema>;
export type RmaPolicyData = z.infer<typeof rmaPolicyDataSchema>;
export type RmaPolicyCurrent = z.infer<typeof rmaPolicyCurrentSchema>;
export type RmaContext = z.infer<typeof rmaContextSchema>;
export type RmaDetail = z.infer<typeof rmaDetailSchema>;
export type RmaPage = z.infer<typeof rmaPageSchema>;
export type RmaCommandResult = z.infer<typeof rmaCommandResultSchema>;
export type RmaPolicyResult = z.infer<typeof rmaPolicyResultSchema>;
export type RmaPolicyInput = z.infer<typeof rmaPolicyInputSchema>;
export type RmaBinding = { caseId?: string; orderId?: string; staff?: boolean; ownerId?: string };
function bound(detail: RmaDetail, b: RmaBinding) {
  if (
    (b.caseId && detail.case.id !== b.caseId) ||
    (b.orderId && detail.case.orderId !== b.orderId) ||
    (b.ownerId && detail.case.ownerId !== b.ownerId) ||
    (b.staff
      ? !detail.case.ownerId
      : detail.case.ownerId !== undefined || detail.events.some((e) => e.staffNote !== undefined))
  )
    throw new Error('rma_unavailable');
  return detail;
}
export const readRmaPublicPolicy = (raw: unknown) => rmaPublicPolicySchema.parse(raw);
export function readRmaContext(raw: unknown, orderId: string) {
  const c = rmaContextSchema.parse(raw);
  if (c.orderId !== orderId) throw new Error('rma_unavailable');
  return c;
}
export function readRmaPage(raw: unknown, b: { staff?: boolean } = {}) {
  const p = rmaPageSchema.parse(raw);
  if (p.items.some((c) => (b.staff ? c.ownerId === undefined : c.ownerId !== undefined)))
    throw new Error('rma_unavailable');
  return p;
}
export function readRmaDetail(raw: unknown, b: RmaBinding = {}) {
  return bound(rmaDetailSchema.parse(raw), b);
}
export function readRmaCommandResult(raw: unknown, b: RmaBinding & { commandId: string }) {
  const r = rmaCommandResultSchema.parse(raw);
  if (r.commandId !== b.commandId) throw new Error('rma_unavailable');
  bound(r.case, b);
  return r;
}
export const readRmaPolicyCurrent = (raw: unknown) => rmaPolicyCurrentSchema.parse(raw);
export const readRmaPolicyHistory = (raw: unknown) => rmaPolicyHistorySchema.parse(raw);
export function readRmaPolicyResult(raw: unknown, commandId: string) {
  const r = rmaPolicyResultSchema.parse(raw);
  if (r.commandId !== commandId) throw new Error('rma_unavailable');
  return r;
}

const uuidPattern = '(?!0{32}(?:/|$))[a-f0-9]{32}';
export function isCustomerRmaPath(path: string, method = 'GET') {
  if (
    path.includes('#') ||
    // eslint-disable-next-line no-control-regex -- Reject raw path whitespace and controls before URL parsing.
    /[\u0000-\u0020\u007f]/.test(path) ||
    path.includes('\\') ||
    !path.startsWith('/api/') ||
    !['GET', 'PUT'].includes(method)
  )
    return false;
  const [pathname, query, ...extra] = path.split('?');
  if (extra.length || pathname.includes('%')) return false;
  if (pathname === '/api/returns') {
    if (method !== 'GET') return false;
    if (query === undefined) return true;
    const params = new URLSearchParams(query),
      keys = [...params.keys()];
    return (
      keys.length > 0 &&
      new Set(keys).size === keys.length &&
      keys.every((k) => k === 'state' || k === 'after') &&
      (!params.has('state') ||
        ['submitted', 'reviewing', 'reviewed', 'withdrawn'].includes(params.get('state')!)) &&
      (!params.has('after') ||
        (/^[A-Za-z0-9+/]+={0,2}$/.test(params.get('after')!) &&
          !/\s/.test(params.get('after')!) &&
          params.get('after')!.length <= 180))
    );
  }
  if (query !== undefined) return false;
  return method === 'GET'
    ? new RegExp('^/api/returns/(?:' + uuidPattern + '|commands/' + uuidPattern + ')$').test(
        pathname,
      ) || new RegExp('^/api/orders/' + uuidPattern + '/returns/context$').test(pathname)
    : new RegExp('^/api/returns/' + uuidPattern + '/withdrawals/' + uuidPattern + '$').test(
        pathname,
      ) ||
        new RegExp('^/api/orders/' + uuidPattern + '/returns/commands/' + uuidPattern + '$').test(
          pathname,
        );
}
