import type { HomeBlock } from '../shared/types.ts';
import { z } from '../config/schema-runtime.ts';
import { publicImageUrlSchema } from '../media/public-image-url.ts';

const internalPath = z
  .string()
  .startsWith('/')
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  .refine((v) => !v.startsWith('//') && !v.includes('\\') && !/[\x00-\x1f]/.test(v));
const imagePath = publicImageUrlSchema;
const promotionSchema = z.object({
  eyebrow: z.string().max(4000),
  purchaseMethodKind: z.enum(['online', 'cheque', 'installment']).optional(),
  title: z.string().max(4000),
  action: z.string().max(4000),
  href: internalPath,
  image: imagePath,
  watermark: z.string().optional(),
});
const blockShape = {
  id: z.string().min(1).max(64),
  kind: z.enum([
    'categories',
    'collection',
    'promotions',
    'products',
    'spotlight',
    'brands',
    'cheque',
  ]),
  enabled: z.boolean(),
  purchaseMethodKind: z.enum(['online', 'cheque', 'installment']).optional(),
  eyebrow: z.string().max(4000).optional(),
  title: z.string().max(4000).optional(),
  description: z.string().max(4000).optional(),
  action: z.string().max(4000).optional(),
  href: internalPath.optional(),
  categoryId: z.string().max(4000).optional(),
  limit: z.number().int().min(1).max(24).optional(),
  productIds: z.array(z.string().min(1).max(64)).max(24).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  items: z.array(promotionSchema).max(6).optional(),
};

const rules = (schema: z.ZodObject<typeof blockShape>) =>
  schema
    .refine((b) => new Set(b.productIds).size === (b.productIds?.length ?? 0))
    .refine((b) => !b.startsAt || !b.endsAt || Date.parse(b.startsAt) < Date.parse(b.endsAt))
    .refine(
      (b) =>
        b.kind !== 'spotlight' || !b.enabled || Boolean(b.title?.trim() && b.productIds?.length),
    );
export const homeBlockSchema = rules(z.object(blockShape));
export const portableHomeBlocksSchema = z
  .array(
    rules(
      z.strictObject({ ...blockShape, items: z.array(promotionSchema.strict()).max(6).optional() }),
    ),
  )
  .max(20)
  .refine((blocks) => new Set(blocks.map((block) => block.id)).size === blocks.length);

export function defaultHomeBlocks(categoryTitle: string): HomeBlock[] {
  return [
    { id: 'categories', kind: 'categories', enabled: true, title: categoryTitle },
    { id: 'collection', kind: 'collection', enabled: true },
  ];
}
