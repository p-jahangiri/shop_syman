import { z } from 'zod';
import { marketIdSchema } from '../../storefront/lib/market-contract.ts';
import {
  offerActionSchema,
  offerAdminDetailSchema,
  offerAdminEventsSchema,
  offerAdminPageSchema,
  offerIdSchema,
  offerMutationMatches,
  offerMutationSchema,
  offerPublishSchema,
  offerRialSchema,
  offerSaveSchema,
  offerSkuSchema,
  offerVersionSchema,
  type OfferAction,
  type OfferMutation,
  type OfferPublish,
  type OfferSave,
} from '../../storefront/lib/offer-contract.ts';
export {
  offerActionSchema,
  offerAdminDetailSchema,
  offerAdminEventsSchema,
  offerAdminPageSchema,
  offerMutationSchema,
  offerPublishSchema,
  offerSaveSchema,
  offerSkuSchema,
};
export const offerSkuChoiceSchema = z
  .object({
    variantId: marketIdSchema,
    productId: marketIdSchema,
    sku: z.string().min(1).max(80),
    labelFa: z.string().max(2000),
    labelEn: z.string().max(2000),
    color: z.string().max(2000),
    colorNameFa: z.string().max(2000),
    colorNameEn: z.string().max(2000),
    warrantyFa: z.string().max(2000),
    warrantyEn: z.string().max(2000),
    publicPriceRial: offerRialSchema,
    version: offerVersionSchema,
  })
  .strict();
export const offerSkuPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(20),
    items: z.array(offerSkuChoiceSchema).max(20),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .nullable(),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map((item) => item.variantId)).size === value.items.length,
  );
export type OfferAdminDetail = z.infer<typeof offerAdminDetailSchema>;
export type OfferAdminPage = z.infer<typeof offerAdminPageSchema>;
export type OfferSku = z.infer<typeof offerSkuSchema>;
export type OfferAdminCommand = (
  | { kind: 'save'; body: OfferSave }
  | { kind: 'publish'; body: OfferPublish }
  | { kind: 'withdraw'; body: OfferAction }
) & {
  id: string;
  requestId: string;
  offerId: string;
  phase: 'pending' | 'unknown' | 'failed' | 'refresh';
  uncertain?: boolean;
  message?: string;
};
export function offerAdminCommandMatches(command: OfferAdminCommand, result: OfferMutation) {
  return offerMutationMatches(result, command.requestId, command.offerId, command.kind);
}
export function offerSkuLookupPath(
  requestId: string,
  listingId: string,
  query: string,
  cursor: string | null,
) {
  if (
    !offerIdSchema.safeParse(requestId).success ||
    !offerIdSchema.safeParse(listingId).success ||
    query.length > 120 ||
    query.trim().split(/\s+/).filter(Boolean).length > 8 ||
    (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
  )
    throw new Error('شناسه یا جست‌وجوی SKU معتبر نیست.');
  const params = new URLSearchParams({ listingId });
  if (query.trim()) params.set('query', query.trim());
  if (cursor) params.set('cursor', cursor);
  return `/admin/sourcing/requests/${requestId}/offer-skus?${params}`;
}
export function offerSkuReadPath(requestId: string, listingId: string, variantId: string) {
  if (
    !offerIdSchema.safeParse(requestId).success ||
    !offerIdSchema.safeParse(listingId).success ||
    !marketIdSchema.safeParse(variantId).success
  )
    throw new Error('شناسهٔ SKU معتبر نیست.');
  return `/admin/sourcing/requests/${requestId}/offer-skus/${variantId}?listingId=${listingId}`;
}
