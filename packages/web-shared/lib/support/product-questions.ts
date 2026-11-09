import { z } from '../config/schema-runtime.ts';

export const publicQuestionName = z
  .string()
  .trim()
  .max(60)
  .refine((name) => !/[\p{Nd}@\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name));

export const communityReplyInput = z.strictObject({
  body: z.string().trim().min(1).max(1200),
  displayName: publicQuestionName.optional(),
});

export const productQuestionReply = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  body: z.string().min(1).max(1200),
  displayName: z.string().max(60).nullish(),
  byStore: z.boolean(),
  at: z.iso.datetime({ offset: true }),
});

export const publishedProductQuestion = z.object({
  id: productQuestionReply.shape.id.optional(),
  question: z.string().max(240),
  answer: z.string().max(1200),
  displayName: z.string().max(60).nullish(),
  publishedAt: z.iso.datetime({ offset: true }),
  replies: z.array(productQuestionReply).max(40).nullish(),
});

export const staffProductQuestion = z.object({
  displayName: z.string().max(60).nullish(),
  thread: z
    .object({
      question: publishedProductQuestion,
      replies: z
        .array(
          z.object({
            reply: productQuestionReply,
            state: z.enum(['Pending', 'Published', 'Rejected']),
          }),
        )
        .max(40),
    })
    // The API omits null properties. A new question has no public thread yet.
    .nullish()
    .transform((thread) => thread ?? null),
});

export type ProductQuestionReply = z.infer<typeof productQuestionReply>;

export function readProductQuestion(body: string) {
  const separator = '\n\n';
  const boundary = body.indexOf(separator);
  if (boundary < 0) return null;
  const slug = body.slice(0, boundary);
  if (slug.length > 140 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const question = body.slice(boundary + separator.length);
  const marker = '[public-name] ';
  const nameEnd = question.indexOf(separator);
  if (!question.startsWith(marker) || nameEnd < 0) return { slug, question, displayName: null };
  const parsed = publicQuestionName.safeParse(question.slice(marker.length, nameEnd));
  return {
    slug,
    question: question.slice(nameEnd + separator.length),
    displayName: parsed.success ? parsed.data || null : null,
  };
}
