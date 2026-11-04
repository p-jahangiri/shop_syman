import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const money = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);
export const cartInputSchema = z
  .object({
    lines: z
      .array(z.object({ variantId: id, quantity: z.number().int().min(1).max(1000000) }).strict())
      .max(64),
    version: nullable(z.string().regex(/^[A-Za-z0-9+/]{11}=$/)),
  })
  .strict()
  .refine((v) => new Set(v.lines.map((l) => l.variantId.toLowerCase())).size === v.lines.length);
export type CartInput = z.infer<typeof cartInputSchema>;
const lineSchema = z
  .object({
    variantId: id,
    quantity: z.number().int().min(1).max(1000000),
    productId: nullable(id),
    slug: nullable(
      z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(150),
    ),
    name: nullable(z.string().max(1000)),
    label: nullable(z.string().max(1000)),
    unitPriceRial: nullable(money),
    available: z.number().int().min(0).max(2147483647),
    lineTotalRial: nullable(money),
    issue: nullable(z.enum(['unavailable', 'insufficient_stock', 'amount_limit'])),
  })
  .strict();
export const cartSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    version: nullable(z.string().regex(/^[A-Za-z0-9+/]{11}=$/)),
    lines: z.array(lineSchema).max(64),
    subtotalRial: nullable(money),
    hasIssues: z.boolean(),
  })
  .strict()
  .refine((v) => {
    if (
      new Set(v.lines.map((l) => l.variantId.toLowerCase())).size !== v.lines.length ||
      v.hasIssues !== v.lines.some((l) => l.issue !== null)
    )
      return false;
    for (const line of v.lines) {
      if (line.issue === 'unavailable') {
        if (line.unitPriceRial !== null || line.lineTotalRial !== null || line.productId !== null)
          return false;
        continue;
      }
      if (line.unitPriceRial === null || line.productId === null) return false;
      const amount = BigInt(line.unitPriceRial) * BigInt(line.quantity);
      if (line.lineTotalRial !== null && BigInt(line.lineTotalRial) !== amount) return false;
      if (line.issue === null && line.available < line.quantity) return false;
    }
    if (v.subtotalRial !== null) {
      if (v.lines.some((l) => l.lineTotalRial === null)) return false;
      return (
        BigInt(v.subtotalRial) === v.lines.reduce((sum, l) => sum + BigInt(l.lineTotalRial!), 0n)
      );
    }
    return v.hasIssues;
  });
export type ServerCart = z.infer<typeof cartSnapshotSchema>;
