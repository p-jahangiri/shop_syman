import { z } from 'zod';
// Shared public/owner data contract; admin retains its separate permission boundary.
import { privateReview, reviewCursor, reviewId } from '../../storefront/lib/reviews-contract.ts';
export { privateReview };
export const adminReviewPage = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(privateReview).max(20),
    nextCursor: reviewCursor.nullable(),
  })
  .strict();
export const moderateReviewInput = z
  .object({
    version: z.string().regex(/^[A-Za-z0-9+/]{11}=$/),
    revisionId: reviewId,
    action: z.enum(['Approve', 'Reject', 'Hide', 'Reply']),
    reason: z.string().max(400),
    reply: z.string().min(1).max(2000).nullable(),
  })
  .strict();
export type AdminReview = z.infer<typeof privateReview>;
