import { z } from './schema-runtime.ts';
import { creditScheduleDateSchema } from './credit-schedule-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((v) => !/^0+$/.test(v)),
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
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  amount = z
    .string()
    .max(19)
    .refine((v) => /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n);
const text = (max: number, required = false) =>
  z
    .string()
    .max(max)
    .refine(
      (v) =>
        v === v.trim() &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/.test(v) &&
        (!required || v.length > 0),
    );
export const chequeStateSchema = z.enum([
  'Received',
  'Deposited',
  'CollectedReported',
  'BouncedReported',
  'Withdrawn',
  'ReturnedToCustomer',
]);
export const chequeActionSchema = z.enum([
  'Deposit',
  'ReportCollection',
  'ReportBounce',
  'Withdraw',
  'ReturnToCustomer',
  'CorrectCollectionReport',
]);
export type ChequeState = z.infer<typeof chequeStateSchema>;
export type ChequeAction = z.infer<typeof chequeActionSchema>;
export function chequeActions(state: ChequeState): ChequeAction[] {
  switch (state) {
    case 'Received':
      return ['Deposit', 'ReturnToCustomer'];
    case 'Deposited':
      return ['ReportCollection', 'ReportBounce', 'Withdraw'];
    case 'BouncedReported':
    case 'Withdrawn':
      return ['Deposit', 'ReturnToCustomer'];
    case 'CollectedReported':
      return ['CorrectCollectionReport'];
    case 'ReturnedToCustomer':
      return [];
  }
}
export function nextChequeState(state: ChequeState, action: ChequeAction): ChequeState {
  if (!chequeActions(state).includes(action)) throw Error('Invalid cheque transition');
  return (
    {
      Deposit: 'Deposited',
      ReportCollection: 'CollectedReported',
      ReportBounce: 'BouncedReported',
      Withdraw: 'Withdrawn',
      ReturnToCustomer: 'ReturnedToCustomer',
      CorrectCollectionReport: 'Deposited',
    } as const
  )[action];
}
export const receiveChequeInputSchema = z
  .object({
    orderVersion: version,
    scheduleVersion: version,
    sequence: z.number().int().min(1).max(60),
    instrumentReference: text(128, true),
    note: text(500),
    occurredAt: at,
    confirmed: z.literal(true),
  })
  .strict();
export const moveChequeInputSchema = z
  .object({
    version,
    action: chequeActionSchema,
    note: text(500, true),
    occurredAt: at,
    confirmed: z.literal(true),
    acknowledgedClosedOrder: z.boolean(),
  })
  .strict();
export const chequeSummarySchema = z
  .object({
    id,
    internalReference: z.string().regex(/^CH-[A-F0-9]{32}$/),
    orderId: id,
    scheduleId: id,
    sequence: z.number().int().min(1).max(60),
    dueDate: creditScheduleDateSchema,
    amountRial: amount,
    state: chequeStateSchema,
    version,
    occurredAt: at,
    recordedAt: at,
    bankVerified: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      x.internalReference === 'CH-' + x.id.toUpperCase() &&
      Date.parse(x.occurredAt) <= Date.parse(x.recordedAt),
  );
export const chequeEventSchema = z
  .object({
    id,
    chequeId: id,
    sequence: z.number().int().min(1).max(200),
    action: z.enum(['Receive', ...chequeActionSchema.options]),
    state: chequeStateSchema,
    version,
    occurredAt: at,
    recordedAt: at,
    note: text(500),
    bankVerified: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      Date.parse(x.occurredAt) <= Date.parse(x.recordedAt) &&
      (x.sequence === 1
        ? x.action === 'Receive' && x.state === 'Received'
        : x.action !== 'Receive' &&
          (
            {
              Deposit: 'Deposited',
              ReportCollection: 'CollectedReported',
              ReportBounce: 'BouncedReported',
              Withdraw: 'Withdrawn',
              ReturnToCustomer: 'ReturnedToCustomer',
              CorrectCollectionReport: 'Deposited',
            } as Record<string, string>
          )[x.action] === x.state),
  );
export const chequeLedgerPageSchema = z
  .object({
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
    canReceive: z.boolean(),
    scheduleFrozen: z.boolean(),
    items: z.array(chequeSummarySchema).max(60),
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      x.items.every(
        (c, i) => c.orderId === x.orderId && (i === 0 || c.sequence > x.items[i - 1].sequence),
      ) &&
      new Set(x.items.map((c) => c.id)).size === x.items.length &&
      x.scheduleFrozen === x.items.length > 0 &&
      (!x.canReceive || (x.orderState === 'AwaitingPayment' && x.scheduleVersion !== null)),
  );
export const chequeDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    cheque: chequeSummarySchema,
    instrumentReference: text(128, true),
    receiptNote: text(500),
    current: chequeEventSchema,
    allowedActions: z.array(chequeActionSchema).max(3),
    closedOrderAcknowledgementRequired: z.boolean(),
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      x.cheque.id === x.current.chequeId &&
      x.cheque.version === x.current.version &&
      x.cheque.state === x.current.state &&
      x.cheque.occurredAt === x.current.occurredAt &&
      x.cheque.recordedAt === x.current.recordedAt &&
      (x.allowedActions.length === 0 ||
        JSON.stringify(x.allowedActions) === JSON.stringify(chequeActions(x.cheque.state))),
  );
export const chequeHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    chequeId: id,
    items: z.array(chequeEventSchema).max(20),
    nextSequence: z.number().int().min(1).max(200).nullable(),
  })
  .strict()
  .refine(
    (x) =>
      x.items.every(
        (e, i) =>
          e.chequeId === x.chequeId && (i === 0 || e.sequence === x.items[i - 1].sequence - 1),
      ) &&
      new Set(x.items.map((e) => e.id)).size === x.items.length &&
      (x.nextSequence === null ||
        (x.items.length === 20 && x.nextSequence === x.items.at(-1)!.sequence)),
  );
export const chequeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    cheque: chequeSummarySchema,
    event: chequeEventSchema,
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      x.event.chequeId === x.cheque.id &&
      x.event.version === x.cheque.version &&
      x.event.state === x.cheque.state &&
      x.event.occurredAt === x.cheque.occurredAt &&
      x.event.recordedAt === x.cheque.recordedAt,
  );
const boundLine = z
  .object({
    scheduleId: id,
    sequence: z.number().int().min(1).max(60),
    dueDate: creditScheduleDateSchema,
    amountRial: amount,
  })
  .strict();
const receiveCommand = z
  .object({
    kind: z.literal('receive'),
    id,
    ownerId: owner,
    orderId: id,
    body: receiveChequeInputSchema,
    line: boundLine,
  })
  .strict()
  .refine((x) => x.line.sequence === x.body.sequence);
const moveCommand = z
  .object({
    kind: z.literal('move'),
    id,
    ownerId: owner,
    orderId: id,
    body: moveChequeInputSchema,
    before: chequeSummarySchema,
    beforeEventSequence: z.number().int().min(1).max(199),
  })
  .strict()
  .refine(
    (x) =>
      x.orderId === x.before.orderId &&
      x.body.version === x.before.version &&
      chequeActions(x.before.state).includes(x.body.action),
  );
export const chequeCommandSchema = z.union([receiveCommand, moveCommand]);
export type ChequeSummary = z.infer<typeof chequeSummarySchema>;
export type ChequeEvent = z.infer<typeof chequeEventSchema>;
export type ChequeLedgerPage = z.infer<typeof chequeLedgerPageSchema>;
export type ChequeDetail = z.infer<typeof chequeDetailSchema>;
export type ChequeHistory = z.infer<typeof chequeHistorySchema>;
export type ChequeResult = z.infer<typeof chequeResultSchema>;
export type ChequeCommand = z.infer<typeof chequeCommandSchema>;
const instant = (v: string) =>
  v
    .replace('+00:00', 'Z')
    .replace(
      /(?:\.([0-9]+))?Z$/,
      (_, digits: string | undefined) => '.' + (digits ?? '').padEnd(7, '0') + 'Z',
    );
export function readChequeResult(raw: unknown, command: ChequeCommand) {
  const c = chequeCommandSchema.parse(command),
    r = chequeResultSchema.parse(raw);
  if (
    r.commandId !== c.id ||
    r.cheque.orderId !== c.orderId ||
    instant(r.event.occurredAt) !== instant(c.body.occurredAt) ||
    r.event.note !== c.body.note
  )
    throw Error('Wrong cheque receipt');
  if (c.kind === 'receive') {
    if (
      r.event.action !== 'Receive' ||
      r.event.sequence !== 1 ||
      r.cheque.scheduleId !== c.line.scheduleId ||
      r.cheque.sequence !== c.line.sequence ||
      r.cheque.dueDate !== c.line.dueDate ||
      r.cheque.amountRial !== c.line.amountRial
    )
      throw Error('Wrong received cheque facts');
  } else {
    if (
      r.event.action !== c.body.action ||
      r.event.sequence !== c.beforeEventSequence + 1 ||
      r.cheque.state !== nextChequeState(c.before.state, c.body.action) ||
      r.cheque.id !== c.before.id ||
      r.cheque.scheduleId !== c.before.scheduleId ||
      r.cheque.sequence !== c.before.sequence ||
      r.cheque.dueDate !== c.before.dueDate ||
      r.cheque.amountRial !== c.before.amountRial ||
      r.cheque.version === c.before.version
    )
      throw Error('Wrong cheque transition');
  }
  return r;
}
export const chequeAdminBase = (ownerId: string, orderId: string) =>
  '/api/admin/credit/orders/' + owner.parse(ownerId) + '/' + id.parse(orderId) + '/cheques';
export function isChequeLedgerPath(path: string, method = 'GET') {
  return (
    method === 'GET' &&
    /^\/api\/credit\/orders\/[a-f0-9]{32}\/cheques$/.test(path) &&
    !/(?:^|\/)0{32}(?:\/|$)/.test(path)
  );
}
export function isChequeLedgerAdminPath(path: string, method = 'GET') {
  if (path.includes('#') || /(?:^|\/)0{32}(?:\/|$)/.test(path)) return false;
  const m = /^\/api\/admin\/credit\/orders\/[A-Za-z0-9_-]{1,64}\/[a-f0-9]{32}\/cheques(.*)$/.exec(
    path,
  );
  if (!m) return false;
  const tail = m[1];
  if (method === 'POST') return /^\/(?:receive|[a-f0-9]{32})\/commands\/[a-f0-9]{32}$/.test(tail);
  if (method !== 'GET') return false;
  return (
    tail === '' ||
    /^\/[a-f0-9]{32}$/.test(tail) ||
    /^\/commands\/[a-f0-9]{32}$/.test(tail) ||
    /^\/[a-f0-9]{32}\/history(?:\?beforeSequence=(?:[1-9][0-9]?|1[0-9]{2}|200))?$/.test(tail)
  );
}
