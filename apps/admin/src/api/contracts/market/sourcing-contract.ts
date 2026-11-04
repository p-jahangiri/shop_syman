import { z } from 'zod';
import {
  sourcingSummarySchema,
  sourcingRequestLineSchema,
  sourcingEventSchema,
  sourcingMutationSchema,
  sourcingAttributeText,
} from '@sayman/web-shared/lib/market/sourcing-contract.ts';
export { sourcingMutationSchema, sourcingAttributeText };
export const sourcingAdminSummarySchema = sourcingSummarySchema.safeExtend({
  ownerId: z.string().min(1).max(64),
});
export const sourcingAdminPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(sourcingAdminSummarySchema).max(50),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict()
  .refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length);
export const sourcingAdminDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: sourcingAdminSummarySchema,
    note: z.string().max(500),
    lines: z.array(sourcingRequestLineSchema).min(1).max(24),
    canCancel: z.literal(false),
    canReview: z.boolean(),
    canMarkUnavailable: z.boolean(),
    requestOnly: z.literal(true),
    canPay: z.literal(false),
  })
  .strict()
  .refine(
    (value) =>
      value.lines.length === value.summary.lineCount &&
      value.lines.reduce((count, line) => count + line.quantity, 0) === value.summary.itemCount &&
      new Set(value.lines.map((line) => line.listingId)).size === value.lines.length &&
      value.canReview === (value.summary.state === 'Submitted') &&
      value.canMarkUnavailable === ['Submitted', 'Reviewing'].includes(value.summary.state),
  );
export const sourcingAdminEventsSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(sourcingEventSchema).max(50),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict()
  .refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length);
export type SourcingAdminDetail = z.infer<typeof sourcingAdminDetailSchema>;
export const sourcingStateNames = {
  Submitted: 'ثبت‌شده',
  Reviewing: 'در حال بررسی',
  Unavailable: 'عدم امکان تأمین',
  Cancelled: 'لغوشده',
} as const;
export type SourcingCommand = {
  id: string;
  kind: 'review' | 'unavailable';
  targetId: string;
  reference: string;
  body: { requestId: string; version: string; reasonCode?: string; publicMessage?: string };
  phase: 'pending' | 'unknown' | 'failed' | 'refresh';
  uncertain?: boolean;
  message?: string;
};
export function sourcingCommandMatches(
  command: SourcingCommand,
  result: z.infer<typeof sourcingMutationSchema>,
) {
  return (
    result.id === command.targetId &&
    result.reference === command.reference &&
    result.state === (command.kind === 'review' ? 'Reviewing' : 'Unavailable')
  );
}
export function sourcingListPath(state: string, query: string, cursor: string | null) {
  const params = new URLSearchParams();
  if (state !== 'all') params.set('state', state);
  if (query.trim()) params.set('query', query.trim());
  if (cursor) params.set('cursor', cursor);
  return '/admin/sourcing/requests' + (params.size ? '?' + params.toString() : '');
}

export function sourcingFailureIsUnknown(previouslyUncertain: boolean, status: number | null) {
  return previouslyUncertain || status === null || status === 0 || status >= 500;
}
