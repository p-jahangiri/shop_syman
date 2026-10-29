import { z } from 'zod';
import { usedConditionSchema } from '../../storefront/lib/used-condition-contract.ts';
const id = z.string().min(1).max(64);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
export const usedDetail = z
  .object({
    schemaVersion: z.literal(1),
    variantId: id,
    productId: id,
    sku: z.string().max(80),
    variantVersion: version,
    inspection: usedConditionSchema.nullable(),
  })
  .strict();
export const usedChoices = z
  .object({
    schemaVersion: z.literal(1),
    items: z
      .array(
        z
          .object({
            variantId: id,
            productId: id,
            sku: z.string().max(80),
            labelFa: z.string(),
            labelEn: z.string(),
            used: z.boolean(),
          })
          .strict(),
      )
      .max(50),
    hasMore: z.boolean(),
  })
  .strict()
  .refine((v) => new Set(v.items.map((i) => i.variantId.toUpperCase())).size === v.items.length);
export const usedInput = z
  .object({ variantVersion: version, inspection: usedConditionSchema })
  .strict();
export const usedResult = z
  .object({ schemaVersion: z.literal(1), replayed: z.boolean(), detail: usedDetail })
  .strict();
export type UsedDetail = z.infer<typeof usedDetail>;
