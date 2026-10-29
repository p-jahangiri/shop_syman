import { z } from 'zod';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const linkId = z.string().regex(/^[0-9a-f]{32}$/);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const key = z.string().min(1).max(120);
export const holooStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('holoo'),
    liveConfigured: z.literal(false),
    canReceive: z.literal(false),
    canWrite: z.literal(false),
    reason: z.literal('holoo_contract_required'),
    mappingAvailable: z.literal(true),
  })
  .strict();
export const accountingLinkSchema = z
  .object({
    id: linkId,
    companyKey: key.max(64),
    externalItemId: key,
    externalCode: key.nullish().transform((v) => v ?? null),
    variantId: id,
    sku: z.string().min(1).max(80),
    productId: id,
    nameFa: z.string().max(250),
    nameEn: z.string().max(250),
    isActive: z.boolean(),
    version,
  })
  .strict();
export const accountingPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(accountingLinkSchema).max(50),
    nextCursor: z
      .string()
      .min(1)
      .max(512)
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict();
export const accountingVariantsSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z
      .array(
        z
          .object({
            variantId: id,
            sku: z.string().min(1).max(80),
            productId: id,
            nameFa: z.string().max(250),
            nameEn: z.string().max(250),
            isActive: z.boolean(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const accountingSavedSchema = z.object({ id: linkId }).strict();
export type AccountingLink = z.infer<typeof accountingLinkSchema>;
export type AccountingLinkInput = {
  companyKey: string;
  externalItemId: string;
  externalCode: string | null;
  variantId: string;
  isActive: boolean;
  version: string | null;
};
// A GET proves the current state, not merely that a resource with this ID exists.
// An update must also have moved past its original rowversion to acknowledge it.
export function accountingRecoveryMatches(
  id: string,
  command: AccountingLinkInput,
  current: AccountingLink,
) {
  return (
    current.id === id &&
    current.companyKey === command.companyKey &&
    current.externalItemId === command.externalItemId &&
    current.externalCode === command.externalCode &&
    current.variantId === command.variantId &&
    current.isActive === command.isActive &&
    (command.version === null || current.version !== command.version)
  );
}
export function accountingListPath(
  company: string,
  query: string,
  enabled: string,
  cursor: string | null,
) {
  const parameters = new URLSearchParams();
  if (company) parameters.set('companyKey', company);
  if (query) parameters.set('query', query);
  if (enabled !== 'all') parameters.set('enabled', enabled);
  if (cursor) parameters.set('cursor', cursor);
  return '/admin/accounting/holoo/links' + (parameters.size ? '?' + parameters : '');
}
