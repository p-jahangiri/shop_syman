import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import { creditScheduleDateSchema } from '@sayman/web-shared/lib/credit/credit-schedule-contract.ts';
import {
  notificationCursor,
  notificationTicks,
} from '@sayman/web-shared/lib/notifications/notification-contract.ts';
import { chequeReportToday } from '@sayman/web-shared/lib/credit/cheque-report-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((v) => !/^0+$/.test(v)),
  number = z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  day = creditScheduleDateSchema.refine((v) => v >= '2000-01-01'),
  cursor = z
    .string()
    .refine((v) => {
      try {
        notificationCursor(v);
        return true;
      } catch {
        return false;
      }
    })
    .nullable();
export const creditInboxItemSchema = z
  .object({
    id,
    sequence: number,
    orderId: id,
    chequeId: id,
    dueDate: day,
    amountRial: number,
    civilDay: day,
    at,
    readAt: at.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      x.civilDay === chequeReportToday(x.at) &&
      (x.readAt === null || notificationTicks(x.readAt) >= notificationTicks(x.at)),
  );
export const creditInboxPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    unreadOnly: z.boolean(),
    items: z.array(creditInboxItemSchema).max(50),
    nextCursor: cursor,
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      x.items.every(
        (n, i) =>
          (!x.unreadOnly || n.readAt === null) &&
          (i === 0 || BigInt(n.sequence) < BigInt(x.items[i - 1].sequence)),
      ) &&
      (x.nextCursor === null ||
        (x.items.length === 50 &&
          notificationCursor(x.nextCursor).before === x.items.at(-1)!.sequence)),
  );
export const creditInboxReadSchema = z
  .object({ schemaVersion: z.literal(1), notification: creditInboxItemSchema })
  .strict()
  .refine((x) => x.notification.readAt !== null);
export type CreditInboxPage = z.infer<typeof creditInboxPageSchema>;
export function readCreditInbox(raw: unknown, unreadOnly: boolean, after: string | null = null) {
  const page = creditInboxPageSchema.parse(raw);
  if (page.unreadOnly !== unreadOnly) throw Error('Wrong credit inbox filter');
  if (after) {
    const before = notificationCursor(after);
    if (
      page.items.some((n) => BigInt(n.sequence) >= BigInt(before.before)) ||
      (page.nextCursor && notificationCursor(page.nextCursor).scope !== before.scope)
    )
      throw Error('Credit inbox page scope changed');
  }
  return page;
}
export function readCreditInboxAcknowledgement(raw: unknown, id: string) {
  const r = creditInboxReadSchema.parse(raw);
  if (r.notification.id !== id) throw Error('Wrong credit notification acknowledgement');
  return r;
}
