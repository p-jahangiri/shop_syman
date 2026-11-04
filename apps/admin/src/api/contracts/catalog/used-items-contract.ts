import { z } from 'zod';
import { usedConditionSchema } from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';
import { shipmentTicks } from '@sayman/web-shared/lib/orders/order-shipment-contract.ts';
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
            productNameFa: z.string().nullish(),
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
function canonicalInspection(inspection: z.infer<typeof usedConditionSchema>) {
  const { photos, ...facts } = inspection;
  return {
    ...facts,
    inspectedAt: shipmentTicks(facts.inspectedAt).toString(),
    ...(photos?.length ? { photos } : {}),
  };
}
export function readUsedInspectionResult(
  raw: unknown,
  variantId: string,
  input: z.infer<typeof usedInput>,
) {
  const result = usedResult.parse(raw);
  if (
    result.detail.variantId.toUpperCase() !== variantId.toUpperCase() ||
    !result.detail.inspection ||
    JSON.stringify(canonicalInspection(result.detail.inspection)) !==
      JSON.stringify(canonicalInspection(input.inspection))
  )
    throw Error('پاسخ با گزارش و تصاویر ثبت‌شده هم‌خوان نیست.');
  return result;
}
