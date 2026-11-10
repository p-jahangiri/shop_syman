import { z } from '../config/schema-runtime.ts';

export const categoryReturnGuidanceLimit = 32;
export const categoryReturnTextLimit = 1000;

export const categoryReturnGuidanceSchema = z
  .array(
    z
      .object({
        categoryId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        text: z
          .string()
          .min(1)
          .max(categoryReturnTextLimit)
          .refine((text) => text === text.trim() && !/\p{Cc}/u.test(text.replaceAll('\n', ''))),
      })
      .strict(),
  )
  .max(categoryReturnGuidanceLimit)
  .refine(
    (items) =>
      new Set(items.map(({ categoryId }) => categoryId.toLowerCase())).size === items.length,
  );

export const categoryReturnDocumentSchema = z
  .object({ items: categoryReturnGuidanceSchema })
  .strict();
export type CategoryReturnGuidance = z.infer<typeof categoryReturnGuidanceSchema>;
