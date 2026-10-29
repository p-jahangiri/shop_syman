import { z } from './schema-runtime.ts';
import { marketIdSchema } from './market-contract.ts';
import { phoneId } from './phone-discovery-contract.ts';
import { notificationCursor, notificationTicks } from './notification-contract.ts';
const at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  sequence = z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n);
export const phoneInboxItemSchema = z
  .object({
    id: phoneId,
    sequence,
    kind: z.enum(['phone_available', 'sourcing_offer_published']),
    listingId: marketIdSchema,
    configurationId: phoneId,
    requestId: phoneId.nullable(),
    offerId: phoneId.nullable(),
    storeSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
      .nullable(),
    variantId: marketIdSchema.nullable(),
    at,
    readAt: at.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      (v.readAt === null || notificationTicks(v.readAt) >= notificationTicks(v.at)) &&
      (v.storeSlug === null) === (v.variantId === null) &&
      (v.kind === 'phone_available'
        ? v.requestId === null && v.offerId === null && v.storeSlug !== null
        : v.requestId !== null && v.offerId !== null),
  );
export const phoneInboxPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    unreadOnly: z.boolean(),
    items: z.array(phoneInboxItemSchema).max(50),
    nextCursor: z
      .string()
      .refine((v) => {
        try {
          notificationCursor(v);
          return true;
        } catch {
          return false;
        }
      })
      .nullable(),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.items.map((i) => i.id)).size === v.items.length &&
      v.items.every(
        (i, n) =>
          (!v.unreadOnly || i.readAt === null) &&
          (n === 0 || BigInt(i.sequence) < BigInt(v.items[n - 1].sequence)),
      ) &&
      (v.nextCursor === null ||
        (v.items.length === 50 &&
          notificationCursor(v.nextCursor).before === v.items.at(-1)!.sequence)),
  );
export type PhoneInboxPage = z.infer<typeof phoneInboxPageSchema>;
export function readPhoneInbox(raw: unknown, unreadOnly: boolean, cursor: string | null = null) {
  const p = phoneInboxPageSchema.parse(raw);
  if (p.unreadOnly !== unreadOnly) throw Error('phone_inbox_filter');
  if (cursor) {
    const before = notificationCursor(cursor);
    if (
      p.items.some((i) => BigInt(i.sequence) >= BigInt(before.before)) ||
      (p.nextCursor && notificationCursor(p.nextCursor).scope !== before.scope)
    )
      throw Error('phone_inbox_cursor');
  }
  return p;
}
export function readPhoneInboxAcknowledgement(raw: unknown, id: string) {
  const r = z
    .object({ schemaVersion: z.literal(1), notification: phoneInboxItemSchema })
    .strict()
    .parse(raw);
  if (r.notification.id !== id || r.notification.readAt === null)
    throw Error('phone_inbox_acknowledgement');
  return r;
}
