import { z } from '../config/schema-runtime.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => !/^0+$/.test(x));
const number = (zero = false) =>
  z
    .string()
    .regex(zero ? /^(?:0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/)
    .refine((x) => /^[0-9]+$/.test(x) && BigInt(x) <= 9223372036854775807n);
const utc = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
export function notificationTicks(value: string) {
  utc.parse(value);
  const seconds = Date.parse(value.slice(0, 19) + 'Z'),
    fraction = value.match(/\.(\d{1,7})/)?.[1] ?? '';
  return BigInt(seconds) * 10000n + BigInt(fraction.padEnd(7, '0'));
}
export function notificationCursor(value: string) {
  if (value.length > 180 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw Error('Invalid notification cursor');
  const decoded = atob(value);
  if (btoa(decoded) !== value) throw Error('Invalid notification cursor');
  const match = /^1:([A-F0-9]{64}):([1-9][0-9]{0,18})$/.exec(decoded);
  if (!match) throw Error('Invalid notification cursor');
  return { scope: match[1], before: number().parse(match[2]) };
}
const cursor = z
  .string()
  .refine((x) => {
    try {
      notificationCursor(x);
      return true;
    } catch {
      return false;
    }
  })
  .nullable();
export const notificationSchema = z
  .object({
    id,
    sequence: number(),
    ticketId: id,
    kind: z.enum(['support_reply', 'support_closed', 'support_reopened']),
    at: utc,
    readAt: utc.nullable(),
  })
  .strict()
  .refine((x) => {
    try {
      return x.readAt === null || notificationTicks(x.readAt) >= notificationTicks(x.at);
    } catch {
      return false;
    }
  });
export const notificationPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    unreadOnly: z.boolean(),
    items: z.array(notificationSchema).max(50),
    nextCursor: cursor,
  })
  .strict()
  .refine((x) => {
    try {
      return (
        new Set(x.items.map((i) => i.id)).size === x.items.length &&
        x.items.every(
          (item, index) =>
            (!x.unreadOnly || item.readAt === null) &&
            (index === 0 || BigInt(x.items[index - 1].sequence) > BigInt(item.sequence)),
        ) &&
        (x.nextCursor === null ||
          (x.items.length === 50 &&
            notificationCursor(x.nextCursor).before === x.items.at(-1)!.sequence))
      );
    } catch {
      return false;
    }
  });
export const notificationCountSchema = z
  .object({ schemaVersion: z.literal(1), unreadCount: number(true) })
  .strict();
export const notificationReadInputSchema = z.object({}).strict();
export const notificationReadSchema = z
  .object({ schemaVersion: z.literal(1), notification: notificationSchema })
  .strict()
  .refine((x) => x.notification.readAt !== null);
export type PrivateNotification = z.infer<typeof notificationSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export function readNotifications(raw: unknown, unreadOnly: boolean, after: string | null = null) {
  const page = notificationPageSchema.parse(raw);
  if (page.unreadOnly !== unreadOnly) throw Error('Wrong notification filter');
  if (after) {
    const before = notificationCursor(after);
    if (
      page.items.some((x) => BigInt(x.sequence) >= BigInt(before.before)) ||
      (page.nextCursor && notificationCursor(page.nextCursor).scope !== before.scope)
    )
      throw Error('Notification page scope changed');
  }
  return page;
}
export function readNotificationResult(raw: unknown, expectedId: string) {
  const result = notificationReadSchema.parse(raw);
  if (result.notification.id !== id.parse(expectedId))
    throw Error('Wrong notification acknowledgement');
  return result;
}
