import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';

export const warrantyTemplatesPath = '/admin/catalog/warranty-templates';
export const warrantyTemplatesQuery = ['admin', 'warranty-templates'] as const;
export const warrantyTemplateLimit = 32;
const categoryIds = z
  .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
  .max(32)
  .refine((ids) => new Set(ids).size === ids.length);
const name = z
  .string()
  .max(120)
  .refine((s) => s === s.trim() && !/\p{Cc}/u.test(s));
const details = z
  .string()
  .max(1600)
  .refine((s) => s === s.trim() && !/\p{Cc}/u.test(s.replaceAll('\n', '')));
const template = z
  .object({
    id: z.string().regex(/^(?!0{32}$)[a-f0-9]{32}$/),
    nameFa: name.refine(Boolean),
    nameEn: name,
    detailsFa: details,
    detailsEn: details,
    categoryIds: categoryIds.refine((ids) => ids.length > 0),
    defaultCategoryIds: categoryIds,
  })
  .strict()
  .refine((item) => item.defaultCategoryIds.every((id) => item.categoryIds.includes(id)));

export const warrantyLibrarySchema = z
  .object({
    version: z
      .string()
      .regex(/^[A-Za-z0-9+/]{11}=$/)
      .nullable(),
    items: z
      .array(template)
      .max(warrantyTemplateLimit)
      .refine((items) => {
        const defaults = items.flatMap((item) => item.defaultCategoryIds);
        return (
          new Set(defaults).size === defaults.length &&
          new Set(items.map((item) => item.id)).size === items.length
        );
      }),
  })
  .strict();

export type WarrantyTemplate = z.infer<typeof template>;

export function warrantyFields(item: WarrantyTemplate) {
  const warrantyFa = [item.nameFa, item.detailsFa].filter(Boolean).join('\n');
  const warrantyEn = [item.nameEn || item.nameFa, item.detailsEn || item.detailsFa]
    .filter(Boolean)
    .join('\n');
  return { warrantyFa, warrantyEn };
}

export function withDefaultWarranty<T extends { warrantyFa: string; warrantyEn: string }>(
  row: T,
  current?: WarrantyTemplate,
  previous?: WarrantyTemplate,
): T {
  const before = previous && warrantyFields(previous);
  const wasDefault =
    before && row.warrantyFa === before.warrantyFa && row.warrantyEn === before.warrantyEn;
  if (!wasDefault && (row.warrantyFa.trim() || row.warrantyEn.trim())) return row;
  return { ...row, ...(current ? warrantyFields(current) : { warrantyFa: '', warrantyEn: '' }) };
}
