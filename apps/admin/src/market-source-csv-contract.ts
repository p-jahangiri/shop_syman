import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  sourceId = z.string().regex(/^[a-f0-9]{32}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/),
  hash = z.string().regex(/^[A-F0-9]{64}$/),
  rowNumber = z.number().int().min(2).max(51);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);
const rial = z
  .string()
  .regex(/^[0-9]{1,19}$/)
  .refine((v) => BigInt(v) > 0n && BigInt(v) <= 9223372036854775807n);
export const sourceCsvExpectedSchema = z
  .object({
    rowNumber,
    listingId: id,
    listingVersion: version,
    sourceId,
    sourceVersion: nullable(version),
    modelVersion: version,
    metadataFingerprint: hash,
  })
  .strict()
  .refine((v) => v.listingId !== v.sourceId);
export const sourceCsvPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    fileHash: hash,
    rows: z
      .array(
        z
          .object({
            rowNumber,
            listingId: z.string().max(64),
            sourceId: z.string().max(32),
            operation: z.enum(['create', 'update', 'invalid']),
            nameFa: z.string().max(250),
            nameEn: z.string().max(250),
            sourceNameFa: z.string().max(200),
            sourceNameEn: z.string().max(200),
            referencePriceRial: nullable(z.string().max(80)),
            expected: nullable(sourceCsvExpectedSchema),
            issues: z
              .array(
                z
                  .object({ code: z.string().min(1).max(100), message: z.string().max(2000) })
                  .strict(),
              )
              .max(8),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    validRows: z.number().int().min(0).max(50),
    invalidRows: z.number().int().min(0).max(50),
    canCommit: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.validRows + v.invalidRows === v.rows.length &&
      v.invalidRows === v.rows.filter((x) => x.issues.length > 0).length &&
      v.canCommit === (v.invalidRows === 0) &&
      new Set(v.rows.map((x) => x.rowNumber)).size === v.rows.length &&
      v.rows.every((x) =>
        x.issues.length > 0
          ? x.operation === 'invalid' && x.expected === null
          : x.expected !== null &&
            x.expected.rowNumber === x.rowNumber &&
            x.expected.listingId === x.listingId &&
            x.expected.sourceId === x.sourceId &&
            x.operation === (x.expected.sourceVersion === null ? 'create' : 'update') &&
            (x.referencePriceRial === null || rial.safeParse(x.referencePriceRial).success),
      ),
  );
export const sourceCsvResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    payloadHash: hash,
    fileHash: hash,
    created: z.number().int().min(0).max(50),
    updated: z.number().int().min(0).max(50),
    rows: z
      .array(
        z
          .object({
            rowNumber,
            listingId: id,
            sourceId,
            operation: z.enum(['create', 'update']),
            listingVersion: version,
            sourceVersion: version,
          })
          .strict(),
      )
      .min(1)
      .max(50),
    replayed: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.created + v.updated === v.rows.length &&
      v.created === v.rows.filter((x) => x.operation === 'create').length &&
      new Set(v.rows.map((x) => x.rowNumber)).size === v.rows.length &&
      new Set(v.rows.map((x) => x.sourceId)).size === v.rows.length &&
      v.rows.every((x) => x.listingId !== x.sourceId),
  );
export type SourceCsvPreview = z.infer<typeof sourceCsvPreviewSchema>;
export type SourceCsvResult = z.infer<typeof sourceCsvResultSchema>;
export interface SourceCsvCommand {
  csv: string;
  requestId: string;
  expected: z.infer<typeof sourceCsvExpectedSchema>[];
  fileHash: string;
}
export function readSourceCsvResult(
  raw: unknown,
  requestId: string,
  expected?: SourceCsvCommand['expected'],
  fileHash?: string,
) {
  const value = sourceCsvResultSchema.parse(raw);
  if (
    value.requestId.toLowerCase() !== requestId.toLowerCase() ||
    (fileHash !== undefined && value.fileHash !== fileHash) ||
    (expected &&
      (value.rows.length !== expected.length ||
        value.rows.some((row) => {
          const previous = expected.find((x) => x.rowNumber === row.rowNumber);
          return (
            !previous ||
            previous.listingId !== row.listingId ||
            previous.sourceId !== row.sourceId ||
            row.operation !== (previous.sourceVersion === null ? 'create' : 'update')
          );
        })))
  )
    throw Error('رسید فایل با شناسه، متن یا ردیف‌های بررسی‌شده هم‌خوان نیست.');
  return value;
}
export async function sourceCsvHash(csv: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv));
  return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
