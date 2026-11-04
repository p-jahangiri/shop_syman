import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const image = z
  .string()
  .max(1000)
  .refine(
    (v) =>
      /^\/media\/catalog\/[a-f0-9]{32}\/thumb\.webp$/.test(v) ||
      /^\/products\/[a-zA-Z0-9/_-]+\.svg$/.test(v),
  );
// A separate strict contract: a full storefront/product DTO cannot enter cache.
export const offlineCatalogSchema = z
  .object({
    version: z.literal(1),
    locale: z.enum(['fa', 'en']),
    generatedAt: z.iso.datetime({ offset: true }),
    isPreview: z.boolean(),
    site: z
      .object({
        name: z.string().min(1).max(250),
        tagline: z.string().max(800),
        primary: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .strict(),
    categories: z
      .array(
        z
          .object({ key: id, name: z.string().min(1).max(250), description: z.string().max(800) })
          .strict(),
      )
      .max(500),
    products: z
      .array(
        z
          .object({
            id,
            slug: z
              .string()
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .max(150),
            name: z.string().min(1).max(250),
            brand: z.string().max(250),
            category: id,
            description: z.string().max(800),
            image: image.optional(),
          })
          .strict(),
      )
      .max(500),
    truncated: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.categories.map((c) => c.key)).size === value.categories.length &&
      new Set(value.products.map((p) => p.id)).size === value.products.length &&
      new Set(value.products.map((p) => p.slug)).size === value.products.length &&
      value.products.every((p) => value.categories.some((c) => c.key === p.category)),
  );
export type OfflineCatalog = z.infer<typeof offlineCatalogSchema>;
