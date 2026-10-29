import { z } from './schema-runtime.ts';
export const reviewId = z.string().regex(/^[a-f0-9]{32}$/);
export const reviewProductId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const text = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(
      (v) =>
        v.trim().length >= min &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v),
    );
export const reviewContent = z
  .object({
    revisionId: reviewId,
    locale: z.enum(['fa', 'en']),
    rating: z.number().int().min(1).max(5),
    displayName: text(1, 60),
    title: text(1, 100),
    body: text(10, 2000),
    at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const publicReview = z
  .object({
    id: reviewId,
    productId: reviewProductId,
    content: reviewContent,
    verifiedBuyer: z.boolean(),
    reply: text(1, 2000).nullable(),
  })
  .strict();
export const privateReview = z
  .object({
    id: reviewId,
    productId: reviewProductId,
    state: z.enum(['Pending', 'Approved', 'Rejected', 'Hidden']),
    version,
    content: reviewContent,
    reply: text(1, 2000).nullable(),
    reportCount: z.number().int().nonnegative(),
  })
  .strict();
export const reviewCursor = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const reviewPage = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(publicReview).max(20),
    ratingCounts: z.array(z.number().int().nonnegative()).length(5),
    nextCursor: reviewCursor.nullable(),
  })
  .strict()
  .refine((v) => new Set(v.items.map((r) => r.id)).size === v.items.length);
export const ownReview = z
  .object({ schemaVersion: z.literal(1), review: privateReview.nullable() })
  .strict();
export const saveReviewInput = z
  .object({
    version: version.nullable(),
    locale: z.enum(['fa', 'en']),
    rating: z.number().int().min(1).max(5),
    displayName: text(1, 60),
    title: text(1, 100),
    body: text(10, 2000),
    publishConsent: z.literal(true),
  })
  .strict();
export const reportReviewInput = z
  .object({ revisionId: reviewId, reason: z.enum(['spam', 'abuse', 'personal_data', 'unrelated']) })
  .strict();
export const reviewResult = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    review: privateReview.nullable(),
    reported: z.boolean(),
  })
  .strict()
  .refine((v) => (v.reported ? v.review === null : v.review !== null));
export type PublicReview = z.infer<typeof publicReview>;
export type PrivateReview = z.infer<typeof privateReview>;
export type ReviewPage = z.infer<typeof reviewPage>;
export type SaveReviewInput = z.infer<typeof saveReviewInput>;
export type ReviewResult = z.infer<typeof reviewResult>;
