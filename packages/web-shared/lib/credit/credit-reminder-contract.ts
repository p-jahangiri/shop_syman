import { z } from '../config/schema-runtime.ts';
import { chequeSummarySchema } from './cheque-ledger-contract.ts';
import { creditScheduleDateSchema } from './credit-schedule-contract.ts';
import { chequeReportToday, chequeReportHeld } from './cheque-report-contract.ts';
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
  hash = z.string().regex(/^[A-F0-9]{64}$/),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  amount = z
    .string()
    .max(19)
    .refine((v) => /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n),
  day = creditScheduleDateSchema.refine((v) => v >= '2000-01-01'),
  sequence = z.number().int().min(1).max(3650),
  state = z.enum([
    'AwaitingPayment',
    'CreditApproved',
    'Paid',
    'Cancelled',
    'Expired',
    'Fulfilled',
  ]),
  held = z.enum(['Received', 'Deposited', 'BouncedReported', 'Withdrawn']),
  note = z
    .string()
    .max(500)
    .refine(
      // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
      (v) => v === v.trim() && v.length > 0 && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/.test(v),
    );
export const creditReminderInputSchema = z
  .object({
    orderVersion: version,
    ledgerVersion: version,
    previewFingerprint: hash,
    note,
    confirmed: z.literal(true),
  })
  .strict();
export const creditReminderSummarySchema = z
  .object({
    id,
    orderId: id,
    chequeId: id,
    sequence,
    civilDay: day,
    dueDate: day,
    amountRial: amount,
    ledgerState: held,
    ledgerVersion: version,
    orderVersion: version,
    previewFingerprint: hash,
    at,
  })
  .strict()
  .refine((x) => x.civilDay === chequeReportToday(x.at));
export const creditReminderPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: id,
    orderVersion: version,
    orderState: state,
    cheque: chequeSummarySchema,
    today: day,
    previewFingerprint: hash,
    nextSequence: sequence.nullable(),
    canSend: z.boolean(),
    sentToday: creditReminderSummarySchema.nullable(),
    bankVerified: z.literal(false),
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      x.cheque.orderId === x.orderId &&
      (!x.sentToday ||
        (x.sentToday.orderId === x.orderId &&
          x.sentToday.chequeId === x.cheque.id &&
          x.sentToday.civilDay === x.today &&
          x.sentToday.amountRial === x.cheque.amountRial &&
          x.sentToday.dueDate === x.cheque.dueDate)) &&
      (x.sentToday === null || !x.canSend) &&
      (!x.canSend ||
        (x.nextSequence !== null &&
          ['CreditApproved', 'Fulfilled'].includes(x.orderState) &&
          chequeReportHeld(x.cheque.state))),
  );
export const creditReminderEventSchema = z
  .object({ summary: creditReminderSummarySchema, note })
  .strict();
export const creditReminderHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: id,
    chequeId: id,
    items: z.array(creditReminderEventSchema).max(20),
    nextBefore: sequence.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      x.items.every(
        (e, i) =>
          e.summary.orderId === x.orderId &&
          e.summary.chequeId === x.chequeId &&
          (i === 0 ||
            (e.summary.sequence === x.items[i - 1].summary.sequence - 1 &&
              e.summary.civilDay < x.items[i - 1].summary.civilDay)),
      ) &&
      new Set(x.items.map((e) => e.summary.id)).size === x.items.length &&
      (x.nextBefore === null ||
        (x.items.length === 20 && x.nextBefore === x.items.at(-1)!.summary.sequence)),
  );
export const creditReminderResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    event: creditReminderEventSchema,
    bankVerified: z.literal(false),
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict();
export const creditReminderCommandSchema = z
  .object({
    id,
    ownerId: owner,
    orderId: id,
    chequeId: id,
    body: creditReminderInputSchema,
    previewSnapshot: creditReminderPageSchema,
  })
  .strict()
  .refine(
    (c) =>
      c.previewSnapshot.canSend &&
      c.previewSnapshot.orderId === c.orderId &&
      c.previewSnapshot.cheque.id === c.chequeId &&
      c.body.orderVersion === c.previewSnapshot.orderVersion &&
      c.body.ledgerVersion === c.previewSnapshot.cheque.version &&
      c.body.previewFingerprint === c.previewSnapshot.previewFingerprint,
  );
export type CreditReminderPage = z.infer<typeof creditReminderPageSchema>;
export type CreditReminderResult = z.infer<typeof creditReminderResultSchema>;
export type CreditReminderCommand = z.infer<typeof creditReminderCommandSchema>;
export function readCreditReminderResult(raw: unknown, command: CreditReminderCommand) {
  const c = creditReminderCommandSchema.parse(command),
    r = creditReminderResultSchema.parse(raw),
    e = r.event.summary,
    p = c.previewSnapshot.cheque;
  if (
    r.commandId !== c.id ||
    r.event.note !== c.body.note ||
    e.orderId !== c.orderId ||
    e.chequeId !== c.chequeId ||
    e.sequence !== c.previewSnapshot.nextSequence ||
    e.civilDay !== c.previewSnapshot.today ||
    e.amountRial !== p.amountRial ||
    e.dueDate !== p.dueDate ||
    e.ledgerState !== p.state ||
    e.ledgerVersion !== c.body.ledgerVersion ||
    e.orderVersion !== c.body.orderVersion ||
    e.previewFingerprint !== c.body.previewFingerprint
  )
    throw Error('Wrong reminder receipt');
  return r;
}
export const creditReminderAdminBase = (ownerId: string, orderId: string, chequeId: string) =>
  '/api/admin/credit/orders/' +
  owner.parse(ownerId) +
  '/' +
  id.parse(orderId) +
  '/cheques/' +
  id.parse(chequeId) +
  '/reminders';
