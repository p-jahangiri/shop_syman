import { z } from './schema-runtime.ts';
const id = z
    .string()
    .length(32)
    .regex(/^[a-f0-9]{32}$/)
    .refine((v) => !/^0+$/.test(v)),
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
  minutes = z.number().int().min(1).max(60);
export const reviewHoldVersionSchema = version;
export const reviewHoldBodySchema = z
  .strictObject({
    action: z.enum(['Enable', 'Disable']),
    version: version.nullable(),
    minutes: minutes.nullable(),
    confirmed: z.literal(true),
  })
  .refine((x) => (x.action === 'Enable' ? x.minutes !== null : x.minutes === null));
export const reviewHoldRevisionSchema = z
  .strictObject({
    id,
    revision: z.number().int().min(1).max(10000),
    enabled: z.boolean(),
    minutes: minutes.nullable(),
    createdAt: at,
  })
  .refine((x) => (x.enabled ? x.minutes !== null : x.minutes === null));
export const reviewHoldCurrentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: version.nullable(),
    current: reviewHoldRevisionSchema.nullable(),
    maximumMinutes: z.literal(60),
  })
  .refine((x) => (x.current === null) === (x.version === null));
export const reviewHoldResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: id,
    policy: reviewHoldCurrentSchema,
    replayed: z.boolean(),
  })
  .refine((x) => x.policy.current !== null);
export const reviewHoldHistorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    items: z.array(reviewHoldRevisionSchema).max(20),
    nextBefore: z.number().int().min(1).max(10000).nullable(),
  })
  .refine(
    (x) =>
      x.items.every((r, i) => i === 0 || r.revision === x.items[i - 1].revision - 1) &&
      new Set(x.items.map((r) => r.id)).size === x.items.length &&
      (x.nextBefore === null || (x.items.length === 20 && x.nextBefore === x.items[19].revision)),
  );
export const reviewHoldOptionSchema = z.strictObject({
  policyRevisionId: id,
  policyVersion: version,
  maximumMinutes: minutes,
  boundary: z.literal('ScopeAndExistingStockRights'),
});
export const reviewHoldDataSchema = z.strictObject({
  policyRevisionId: id,
  policyVersion: version,
  minutes,
  quoteExpiresAt: at,
  expiresAt: at,
});
export const reviewHoldCommandSchema = z.strictObject({ id, body: reviewHoldBodySchema });
export type ReviewHoldCommand = z.infer<typeof reviewHoldCommandSchema>;
export type ReviewHoldResult = z.infer<typeof reviewHoldResultSchema>;
export type ReviewHoldBody = z.infer<typeof reviewHoldBodySchema>;
export const reviewHoldCommandPath = (c: ReviewHoldCommand) =>
  '/admin/credit/review-hold-policy/commands/' + reviewHoldCommandSchema.parse(c).id;
export function readReviewHoldResult(raw: unknown, c: ReviewHoldCommand) {
  const r = reviewHoldResultSchema.parse(raw);
  if (
    r.commandId !== c.id ||
    r.policy.current?.enabled !== (c.body.action === 'Enable') ||
    r.policy.current?.minutes !== c.body.minutes ||
    r.policy.version === c.body.version
  )
    throw Error('Unrelated review-hold policy receipt');
  return r;
}
