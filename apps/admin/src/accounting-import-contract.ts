import { z } from 'zod';
const key = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
    .refine((v) => v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v));
const optionalKey = (max: number) =>
  key(max)
    .nullish()
    .transform((v) => v ?? null);
const id = z.string().regex(/^[a-f0-9]{32}$/),
  hash = z.string().regex(/^[A-F0-9]{64}$/);
const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/)
  .refine((v) => Number.isFinite(Date.parse(v)));
const rial = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const delta = z
  .string()
  .regex(/^(0|-?[1-9][0-9]{0,18})$/)
  .refine((v) => BigInt(v) >= -9223372036854775807n && BigInt(v) <= 9223372036854775807n);
const quantity = z.number().int().min(0).max(1000000);
const optionalRaw = optionalKey(64);
export const accountingImportRowInputSchema = z
  .object({
    externalItemId: key(120),
    externalCode: optionalKey(120),
    externalName: optionalKey(300),
    externalUnitKey: key(64),
    quantityRaw: optionalRaw,
    priceRaw: optionalRaw,
  })
  .strict();
export const accountingImportInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    companyKey: key(64),
    externalWarehouseKey: key(64),
    quantityMeaning: z.enum(['physical', 'available', 'unknown']),
    priceCurrency: z.enum(['IRR', 'IRT', 'unknown']),
    observedAt: utc,
    isDemo: z.boolean(),
    rows: z.array(accountingImportRowInputSchema).min(1).max(200),
  })
  .strict()
  .refine((v) => new Set(v.rows.map((r) => r.externalItemId)).size === v.rows.length, {
    message: 'شناسهٔ ثابت کالا در هر ورودی نباید تکراری باشد.',
  });
const batch = z
  .object({
    id,
    companyKey: key(64),
    externalWarehouseKey: key(64),
    quantityMeaning: z.enum(['physical', 'available', 'unknown']),
    priceCurrency: z.enum(['IRR', 'IRT', 'unknown']),
    observedAt: utc,
    createdAt: utc,
    isDemo: z.boolean(),
    rowCount: z.number().int().min(1).max(200),
    payloadHash: hash,
  })
  .strict()
  .refine((v) => Date.parse(v.observedAt) <= Date.parse(v.createdAt));
export const accountingImportIssues = [
  'quantity_missing',
  'quantity_not_supported_integer',
  'available_quantity_requires_reconciliation',
  'quantity_meaning_unknown',
  'price_missing',
  'price_currency_unknown',
  'price_not_supported_integer',
  'unit_mapping_required',
  'warehouse_mapping_required',
  'apply_not_available',
  'item_mapping_required',
  'mapped_sku_not_eligible',
] as const;
export const accountingImportMatchSchema = z
  .object({
    linkId: id,
    linkVersion: z.string().regex(/^[A-Za-z0-9+/]{11}=$/),
    variantId: key(64),
    sku: key(80),
    nameFa: z.string().max(250),
    nameEn: z.string().max(250),
    priceRial: rial,
    isActive: z.boolean(),
    isDigital: z.boolean(),
    productStatus: z.enum(['Draft', 'Published', 'Hidden']),
  })
  .strict();
const match = accountingImportMatchSchema;
const row = z
  .object({
    ...accountingImportRowInputSchema.shape,
    rowNumber: z.number().int().min(1).max(200),
    quantity: quantity.nullish().transform((v) => v ?? null),
    priceRial: rial.nullish().transform((v) => v ?? null),
    currentMatch: match.nullish().transform((v) => v ?? null),
    priceDifferenceRial: delta.nullish().transform((v) => v ?? null),
    issues: z.array(z.enum(accountingImportIssues)).min(1).max(12),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.issues).size === v.issues.length &&
      v.issues.includes('apply_not_available') &&
      v.issues.includes('unit_mapping_required') &&
      v.issues.includes('warehouse_mapping_required') &&
      (v.currentMatch === null
        ? v.priceDifferenceRial === null
        : v.priceRial === null
          ? v.priceDifferenceRial === null
          : v.priceDifferenceRial !== null &&
            BigInt(v.priceDifferenceRial) ===
              BigInt(v.priceRial) - BigInt(v.currentMatch.priceRial)),
  );
export const accountingImportDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    batch,
    rows: z.array(row).min(1).max(200),
    canApply: z.literal(false),
    canSyncLive: z.literal(false),
  })
  .strict()
  .refine(
    (v) =>
      v.rows.length === v.batch.rowCount &&
      new Set(v.rows.map((x) => x.externalItemId)).size === v.rows.length &&
      v.rows.every((x, i) => x.rowNumber === i + 1),
  );
export const accountingImportPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(20),
    items: z.array(batch).max(20),
    nextCursor: z
      .string()
      .min(1)
      .max(512)
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict()
  .refine((v) => new Set(v.items.map((x) => x.id)).size === v.items.length);
export const accountingImportSavedSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    payloadHash: hash,
    replayed: z.boolean(),
    applied: z.literal(false),
  })
  .strict();
export type AccountingImportInput = z.infer<typeof accountingImportInputSchema>;
export type AccountingImportDetail = z.infer<typeof accountingImportDetailSchema>;
export function accountingImportRecoveryMatches(
  id: string,
  input: AccountingImportInput,
  current: AccountingImportDetail,
) {
  const b = current.batch;
  return (
    b.id === id &&
    b.companyKey === input.companyKey &&
    b.externalWarehouseKey === input.externalWarehouseKey &&
    b.quantityMeaning === input.quantityMeaning &&
    b.priceCurrency === input.priceCurrency &&
    b.isDemo === input.isDemo &&
    Date.parse(b.observedAt) === Date.parse(input.observedAt) &&
    current.rows.length === input.rows.length &&
    current.rows.every((row, i) =>
      Object.entries(input.rows[i]).every(
        ([k, v]) => row[k as keyof (typeof input.rows)[number]] === v,
      ),
    )
  );
}
export function parseAccountingCsv(source: string) {
  if (new TextEncoder().encode(source).length > 262144)
    throw Error('حجم CSV نباید بیشتر از ۲۵۶ کیلوبایت باشد.');
  const text = source.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [],
    field = '',
    quoted = false,
    closedQuote = false;
  function endField() {
    record.push(field);
    field = '';
    closedQuote = false;
    if (record.length > 6) throw Error('CSV باید دقیقاً شش ستون قالب سایمان را داشته باشد.');
  }
  function endRecord() {
    endField();
    records.push(record);
    record = [];
    if (records.length > 201) throw Error('حداکثر ۲۰۰ ردیف کالا مجاز است.');
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += c;
      continue;
    }
    if (c === ',' || c === '\r' || c === '\n') {
      if (c === ',') endField();
      else {
        if (c === '\r' && text[i + 1] === '\n') i++;
        endRecord();
      }
      continue;
    }
    if (closedQuote) throw Error('نویسهٔ اضافی پس از نقل‌قول CSV وجود دارد.');
    if (c === '"') {
      if (field) throw Error('نقل‌قول CSV باید از ابتدای فیلد شروع شود.');
      quoted = true;
    } else field += c;
  }
  if (quoted) throw Error('نقل‌قول CSV بسته نشده است.');
  if (field || record.length || closedQuote) endRecord();
  const headers = [
    'externalItemId',
    'externalCode',
    'externalName',
    'externalUnitKey',
    'quantityRaw',
    'priceRaw',
  ];
  if (JSON.stringify(records.shift()) !== JSON.stringify(headers) || !records.length)
    throw Error('سرستون‌های CSV باید دقیقاً مطابق قالب سایمان و شامل حداقل یک کالا باشند.');
  return records.map((values) => {
    if (values.length !== 6) throw Error('تعداد ستون‌های یک ردیف CSV صحیح نیست.');
    return accountingImportRowInputSchema.parse({
      externalItemId: values[0],
      externalCode: values[1] || null,
      externalName: values[2] || null,
      externalUnitKey: values[3],
      quantityRaw: values[4] || null,
      priceRaw: values[5] || null,
    });
  });
}
