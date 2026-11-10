import { z } from '../config/schema-runtime.ts';
import { productQuestionReply } from '../support/product-questions.ts';
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
    likes: z.number().int().nonnegative().optional(),
    dislikes: z.number().int().nonnegative().optional(),
    reply: text(1, 2000).nullable(),
    hasPhoto: z.literal(true).optional(),
    photoCount: z.number().int().min(2).max(3).optional(),
    isDemo: z.literal(true).optional(),
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
    hasPhoto: z.literal(true).optional(),
    photoCount: z.number().int().min(2).max(3).optional(),
    isDemo: z.literal(true).optional(),
  })
  .strict();
export const reviewCursor = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const helpfulReviewCursor = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,9})\.[1-9][0-9]{0,18}$/)
  .refine((v) => {
    const [likes, sequence] = v.split('.');
    return Number(likes) <= 2147483647 && reviewCursor.safeParse(sequence).success;
  });
export const reviewPage = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(publicReview).max(20),
    ratingCounts: z.array(z.number().int().nonnegative()).length(5),
    nextCursor: z.union([reviewCursor, helpfulReviewCursor]).nullable(),
  })
  .strict()
  .refine((v) => new Set(v.items.map((r) => r.id)).size === v.items.length);
export const ownReview = z
  .object({ schemaVersion: z.literal(1), review: privateReview.nullable() })
  .strict();
export const reviewPhotoMaxBytes = 2 * 1024 * 1024;
export const reviewPhotoMaxCount = 3;
export const reviewPhotoRequestMaxBytes = 8_500_000;
export function reviewPhotoSlots(review: { hasPhoto?: true; photoCount?: number }) {
  return Array.from({ length: review.photoCount ?? (review.hasPhoto ? 1 : 0) }, (_, i) => i + 1);
}
export const reviewPhotoMime = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const replacementPhoto = z
  .object({
    action: z.literal('replace'),
    name: text(1, 120),
    contentType: reviewPhotoMime,
    data: z
      .string()
      .min(4)
      .max(Math.ceil(reviewPhotoMaxBytes / 3) * 4),
  })
  .strict();
const photoInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('remove') }).strict(),
  replacementPhoto,
]);
const albumPhoto = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('keep'), slot: z.number().int().min(1).max(reviewPhotoMaxCount) })
    .strict(),
  replacementPhoto,
]);
export type ReviewAlbumPhoto = z.infer<typeof albumPhoto>;
export const saveReviewInput = z
  .object({
    version: version.nullable(),
    locale: z.enum(['fa', 'en']),
    rating: z.number().int().min(1).max(5),
    displayName: text(1, 60),
    title: text(1, 100),
    body: text(10, 2000),
    publishConsent: z.literal(true),
    photo: photoInput.optional(),
    photos: z.array(albumPhoto).max(reviewPhotoMaxCount).optional(),
  })
  .strict()
  .refine((value) => !value.photo || !value.photos);
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

export const voteValue = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export const voteInput = z.strictObject({ revisionId: reviewId, value: voteValue });
export const voteResult = z.strictObject({
  value: voteValue,
  likes: z.number().int().nonnegative(),
  dislikes: z.number().int().nonnegative(),
  replayed: z.boolean(),
});
export const voteState = z.record(reviewId, voteValue);
export const voteRevisions = z
  .string()
  .regex(/^[a-f0-9]{32}(?:,[a-f0-9]{32}){0,19}$/)
  .refine((raw) => {
    const ids = raw.split(',');
    return new Set(ids).size === ids.length;
  });
export const withdrawInput = z.strictObject({ version });
export const withdrawResult = z.strictObject({ withdrawn: z.literal(true), replayed: z.boolean() });

const accountProduct = z.object({
  id: reviewProductId,
  slug: z
    .string()
    .max(150)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(300),
  image: z.string().max(2048),
});
export const contributionCursor = z
  .string()
  .max(180)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const accountPendingReviews = z.object({ items: z.array(accountProduct).max(64) });
export const accountReviews = z.object({
  items: z
    .array(
      z.object({
        review: privateReview,
        likes: z.number().int().nonnegative(),
        dislikes: z.number().int().nonnegative(),
        product: accountProduct.nullish(),
      }),
    )
    .max(12),
  nextCursor: reviewCursor.nullish(),
});
export const accountQuestions = z.object({
  items: z
    .array(
      z.object({
        id: reviewId,
        name: z.string().max(120),
        createdAt: z.iso.datetime({ offset: true }),
        state: z.enum(['Open', 'WaitingCustomer', 'Closed']),
        question: z.string().max(4000),
        product: accountProduct.nullish(),
        published: z.boolean(),
        replies: z.array(productQuestionReply).max(4),
        replyCount: z.number().int().min(0).max(40),
        privateReply: z.string().max(4000).nullish(),
      }),
    )
    .max(12),
  nextCursor: contributionCursor.nullish(),
});
export const contributionSchemas = {
  pending: accountPendingReviews,
  reviews: accountReviews,
  questions: accountQuestions,
};
export type ContributionSection = keyof typeof contributionSchemas;
export type ContributionPage<T extends ContributionSection> = ReturnType<
  (typeof contributionSchemas)[T]['parse']
>;
export type AccountProduct = z.infer<typeof accountProduct>;
export type VoteValue = z.infer<typeof voteValue>;
