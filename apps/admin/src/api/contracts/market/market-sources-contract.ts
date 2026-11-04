import { z } from 'zod';
import { marketDetailsSchema } from './market-contract.ts';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  sourceId = z.string().regex(/^[a-f0-9]{32}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
export const sourceInputSchema = z
  .object({
    listingVersion: version,
    sourceVersion: version.nullable(),
    details: marketDetailsSchema,
  })
  .strict();
export const sourceResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    listingId: id,
    sourceId,
    listingVersion: version,
    sourceVersion: version,
    replayed: z.boolean(),
  })
  .strict()
  .refine((v) => v.listingId !== v.sourceId);
export const adminSourcesSchema = z
  .object({
    schemaVersion: z.literal(1),
    listingId: id,
    listingVersion: version,
    sources: z
      .array(
        z.object({ id, isPrimary: z.boolean(), details: marketDetailsSchema, version }).strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.sources.map((x) => x.id)).size === v.sources.length &&
      v.sources.filter((x) => x.isPrimary).length === 1 &&
      v.sources.every(
        (x) =>
          x.isPrimary === (x.id === v.listingId) &&
          (!x.isPrimary || x.version === v.listingVersion),
      ),
  );
export type AdminSources = z.infer<typeof adminSourcesSchema>;
export type SourceResult = z.infer<typeof sourceResultSchema>;
export interface SourceCommand {
  listingId: string;
  sourceId: string;
  requestId: string;
  input: z.infer<typeof sourceInputSchema>;
}
export function readSourceResult(
  raw: unknown,
  command: Pick<SourceCommand, 'listingId' | 'sourceId' | 'requestId'>,
) {
  const value = sourceResultSchema.parse(raw);
  if (
    value.listingId !== command.listingId ||
    value.sourceId !== command.sourceId ||
    value.requestId.toLowerCase() !== command.requestId.toLowerCase()
  )
    throw new Error('رسید با مدل، منبع یا شناسهٔ فرمان هم‌خوان نیست.');
  return value;
}
