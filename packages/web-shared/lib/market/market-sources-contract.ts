import { z } from '../config/schema-runtime.ts';
import { marketIdSchema } from './market-contract.ts';
export const marketSequenceSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const date = z.iso.datetime({ offset: true });
const url = z
  .string()
  .max(1500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        !/[\\\s]/.test(v)
      );
    } catch {
      return false;
    }
  });
export const marketSourceSchema = z
  .object({
    id: marketIdSchema,
    isPrimary: z.boolean(),
    sourceName: z.string().min(1).max(200),
    sourceUrl: url.nullish().transform((v) => v ?? null),
    availability: z.enum(['unknown', 'available', 'unavailable', 'stale']),
    observedAt: date.nullish().transform((v) => v ?? null),
    validUntil: date.nullish().transform((v) => v ?? null),
    referencePriceRial: z
      .string()
      .regex(/^[0-9]{1,19}$/)
      .refine((v) => BigInt(v) > 0n && BigInt(v) <= 9223372036854775807n)
      .nullable(),
    referencePriceCurrent: z.boolean(),
    isDemo: z.boolean(),
  })
  .strict()
  .refine((v) => {
    const dated = v.observedAt !== null && v.validUntil !== null;
    return (
      (v.observedAt === null) === (v.validUntil === null) &&
      (!dated || Date.parse(v.observedAt!) < Date.parse(v.validUntil!)) &&
      (v.availability === 'unknown' || dated) &&
      (v.referencePriceRial === null || dated) &&
      (!v.referencePriceCurrent ||
        (dated && v.referencePriceRial !== null && v.availability !== 'stale'))
    );
  });
export const marketSourcesSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    listingId: marketIdSchema,
    sources: z.array(marketSourceSchema).min(1).max(16),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.sources.map((s) => s.id)).size === v.sources.length &&
      v.sources.filter((s) => s.isPrimary).length === 1 &&
      v.sources.every((s) => s.isPrimary === (s.id === v.listingId)),
  );
export const marketHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    listingId: marketIdSchema,
    sourceId: marketIdSchema,
    items: z
      .array(
        z
          .object({
            sequence: marketSequenceSchema,
            origin: z.enum(['recorded', 'migrationBaseline']),
            recordedAt: date,
            source: marketSourceSchema,
          })
          .strict(),
      )
      .max(20),
    nextBefore: marketSequenceSchema.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.items.every(
        (x, i) =>
          x.source.id === v.sourceId &&
          x.source.isPrimary === (v.sourceId === v.listingId) &&
          (x.source.observedAt === null ||
            Date.parse(x.source.observedAt) <= Date.parse(x.recordedAt)) &&
          (i === 0 || BigInt(v.items[i - 1].sequence) > BigInt(x.sequence)),
      ) &&
      (v.nextBefore === null ||
        (v.items.length === 20 && v.nextBefore === v.items.at(-1)!.sequence)),
  );
export type MarketSource = z.infer<typeof marketSourceSchema>;
export type MarketSources = z.infer<typeof marketSourcesSchema>;
export type MarketHistory = z.infer<typeof marketHistorySchema>;
