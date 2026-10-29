import { z } from './schema-runtime.ts';
import { chequeSummarySchema, chequeStateSchema } from './cheque-ledger-contract.ts';
import {
  creditScheduleDateSchema,
  creditScheduleOrderSummarySchema,
} from './credit-schedule-contract.ts';
const date = creditScheduleDateSchema.refine((v) => v >= '2000-01-01'),
  count = z.number().int().min(0).max(20),
  aggregate = z
    .string()
    .regex(/^(?:0|[1-9][0-9]{0,20})$/)
    .refine((v) => BigInt(v) <= 20n * 9223372036854775807n),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  cursor = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/);
export const chequeReportFilterSchema = z
  .object({ from: date, through: date, state: z.enum(['All', ...chequeStateSchema.options]) })
  .strict()
  .refine(
    (x) => x.from <= x.through && Date.parse(x.through) - Date.parse(x.from) <= 365 * 86400000,
  );
const row = z
  .object({
    ownerId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    cheque: chequeSummarySchema,
    currentOrder: creditScheduleOrderSummarySchema,
  })
  .strict()
  .refine(
    (x) => x.ownerId === x.currentOrder.ownerId && x.cheque.orderId === x.currentOrder.orderId,
  );
const total = z
  .object({
    count,
    amountRial: aggregate,
    states: z
      .array(z.object({ state: chequeStateSchema, count, amountRial: aggregate }).strict())
      .length(6),
    overdueHeldCount: count,
    overdueHeldRial: aggregate,
    dueTodayHeldCount: count,
    dueTodayHeldRial: aggregate,
    futureHeldCount: count,
    futureHeldRial: aggregate,
  })
  .strict();
export function chequeReportHeld(state: string) {
  return ['Received', 'Deposited', 'BouncedReported', 'Withdrawn'].includes(state);
}
export function chequeReportToday(at: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  return ['year', 'month', 'day']
    .map((kind) => parts.find((p) => p.type === kind)!.value)
    .join('-');
}
export const chequeReportPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    filter: chequeReportFilterSchema,
    timeZone: z.literal('Asia/Tehran'),
    today: date,
    registrationCutoff: at,
    observedAt: at,
    cursorExpiresAt: at,
    items: z.array(row).max(20),
    pageTotals: total,
    nextCursor: cursor.nullable(),
    bankVerified: z.literal(false),
    canPay: z.literal(false),
    canFulfill: z.literal(false),
  })
  .strict()
  .refine((x) => {
    const cutoff = Date.parse(x.registrationCutoff),
      observed = Date.parse(x.observedAt),
      expires = Date.parse(x.cursorExpiresAt);
    if (
      observed < cutoff ||
      observed >= expires ||
      expires - cutoff !== 900000 ||
      x.today !== chequeReportToday(x.registrationCutoff) ||
      (x.nextCursor !== null && x.items.length !== 20) ||
      new Set(x.items.map((r) => r.cheque.id)).size !== x.items.length
    )
      return false;
    if (
      x.items.some(
        (r, i) =>
          r.cheque.dueDate < x.filter.from ||
          r.cheque.dueDate > x.filter.through ||
          (x.filter.state !== 'All' && r.cheque.state !== x.filter.state) ||
          Date.parse(r.cheque.recordedAt) > observed ||
          (i > 0 &&
            (r.cheque.dueDate < x.items[i - 1].cheque.dueDate ||
              (r.cheque.dueDate === x.items[i - 1].cheque.dueDate &&
                r.cheque.id <= x.items[i - 1].cheque.id))),
      )
    )
      return false;
    const t = x.pageTotals,
      sum = (items: typeof x.items) => items.reduce((s, r) => s + BigInt(r.cheque.amountRial), 0n),
      equal = (items: typeof x.items, n: number, rial: string) =>
        items.length === n && sum(items) === BigInt(rial);
    if (
      !equal(x.items, t.count, t.amountRial) ||
      t.states.some(
        (s, i) =>
          s.state !== chequeStateSchema.options[i] ||
          !equal(
            x.items.filter((r) => r.cheque.state === s.state),
            s.count,
            s.amountRial,
          ),
      )
    )
      return false;
    const held = x.items.filter((r) => chequeReportHeld(r.cheque.state));
    return (
      equal(
        held.filter((r) => r.cheque.dueDate < x.today),
        t.overdueHeldCount,
        t.overdueHeldRial,
      ) &&
      equal(
        held.filter((r) => r.cheque.dueDate === x.today),
        t.dueTodayHeldCount,
        t.dueTodayHeldRial,
      ) &&
      equal(
        held.filter((r) => r.cheque.dueDate > x.today),
        t.futureHeldCount,
        t.futureHeldRial,
      )
    );
  });
export type ChequeReportFilter = z.infer<typeof chequeReportFilterSchema>;
export type ChequeReportPage = z.infer<typeof chequeReportPageSchema>;
export function chequeReportPath(filter: ChequeReportFilter, token: string | null) {
  const f = chequeReportFilterSchema.parse(filter),
    query = new URLSearchParams(f);
  if (token !== null) query.set('cursor', cursor.parse(token));
  return '/admin/credit/cheque-report?' + query;
}
export function readChequeReport(raw: unknown, filter: ChequeReportFilter) {
  const p = chequeReportPageSchema.parse(raw);
  if (
    p.filter.from !== filter.from ||
    p.filter.through !== filter.through ||
    p.filter.state !== filter.state
  )
    throw Error('Report filter mismatch');
  return p;
}
