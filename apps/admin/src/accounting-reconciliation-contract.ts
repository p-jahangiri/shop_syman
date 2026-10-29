import { z } from 'zod';
import { accountingImportMatchSchema } from './accounting-import-contract.ts';
import { mappingSchema } from './supply-contract.ts';
const id = z.string().regex(/^[a-f0-9]{32}$/),
  hash = z.string().regex(/^[A-F0-9]{64}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const key = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
    .refine((x) => x.trim() === x && !/[\u0000-\u001f\u007f]/.test(x));
const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/)
  .refine((x) => Number.isFinite(Date.parse(x)));
export const warehouseSchema = z
  .object({
    id,
    companyKey: key(64),
    externalWarehouseKey: key(64),
    nameFa: key(200),
    nameEn: key(200),
    isActive: z.boolean(),
    scope: z.literal('whole_store_physical'),
    version,
  })
  .strict();
export const warehouseInputSchema = z
  .object({
    commandId: id,
    companyKey: key(64),
    externalWarehouseKey: key(64),
    nameFa: key(200),
    nameEn: key(200),
    isActive: z.boolean(),
    acknowledgeWholeStorePhysical: z.boolean(),
    version: version.nullable(),
  })
  .strict()
  .refine((x) => !x.isActive || x.acknowledgeWholeStorePhysical, {
    message: 'برای فعال‌سازی، محدودهٔ کل ماندهٔ فیزیکی فروشگاه را تأیید کنید.',
  });
export const warehousePageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(20),
    items: z.array(warehouseSchema).max(20),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((r) => r.id)).size === x.items.length &&
      x.items.filter((r) => r.isActive).length <= 1,
  );
export const warehouseSavedSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: id,
    targetId: id,
    payloadHash: hash,
    warehouse: warehouseSchema,
    replayed: z.boolean(),
  })
  .strict()
  .refine((x) => x.targetId === x.warehouse.id);
export interface WarehouseCommand {
  targetId: string;
  input: z.infer<typeof warehouseInputSchema>;
}
export type Warehouse = z.infer<typeof warehouseSchema>;
export type WarehouseResult = z.infer<typeof warehouseSavedSchema>;
export function readWarehouseResult(raw: unknown, command: WarehouseCommand) {
  const r = warehouseSavedSchema.parse(raw),
    v = command.input,
    w = r.warehouse;
  if (
    r.commandId !== v.commandId ||
    r.targetId !== command.targetId ||
    w.companyKey !== v.companyKey ||
    w.externalWarehouseKey !== v.externalWarehouseKey ||
    w.nameFa !== v.nameFa.trim() ||
    w.nameEn !== v.nameEn.trim() ||
    w.isActive !== v.isActive ||
    w.version === v.version
  )
    throw Error('رسید به همین فرمان و محتوای نگاشت انبار تعلق ندارد.');
  return r;
}
export function convertAccountingQuantity(raw: string, numerator: number, denominator: number) {
  if (
    !/^[0-9]{1,20}(\.[0-9]{1,8})?$/.test(raw) ||
    raw.length > 29 ||
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    numerator < 1 ||
    numerator > 1000000 ||
    denominator < 1 ||
    denominator > 1000000
  )
    throw Error('مقدار و نسبت قابل تبدیل نیست.');
  const parts = raw.split('.'),
    divisor = 10n ** BigInt(parts[1]?.length ?? 0) * BigInt(denominator),
    whole = BigInt(parts.join('')) * BigInt(numerator);
  if (whole % divisor !== 0n || whole / divisor > 1000000n)
    throw Error('تبدیل باید دقیقاً عدد صحیح صفر تا یک میلیون باشد.');
  return Number(whole / divisor);
}
export const reconciliationIssues = [
  'warehouse_mapping_required',
  'warehouse_mapping_inactive',
  'available_quantity_requires_reconciliation',
  'quantity_meaning_unknown',
  'item_mapping_required',
  'mapped_sku_not_eligible',
  'unit_mapping_required',
  'accounting_quantity_invalid',
  'accounting_quantity_conversion',
  'tracked_stock_requires_serial_receipt',
  'single_unit_requires_inspection_flow',
  'stock_moved_since_observation',
  'stock_below_commitments',
  'quantity_missing',
] as const;
const stock = z
  .object({
    onHand: z.number().int().min(0).max(2147483647),
    reserved: z.number().int().min(0).max(2147483647),
    sourcingReserved: z.number().int().min(0).max(2147483647),
    available: z.number().int().min(0).max(2147483647),
    isSingleUnit: z.boolean(),
    trackingMode: z.enum(['none', 'serial', 'imei']),
    version,
    lastMovementAt: utc.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      x.available === x.onHand - x.reserved - x.sourcingReserved &&
      (!x.isSingleUnit || x.onHand <= 1),
  );
const row = z
  .object({
    rowNumber: z.number().int().min(1).max(200),
    externalItemId: key(120),
    externalUnitKey: key(64),
    sourceQuantity: key(64).nullable(),
    match: accountingImportMatchSchema.nullable(),
    unitMapping: mappingSchema.nullable(),
    stock: stock.nullable(),
    targetOnHand: z.number().int().min(0).max(1000000).nullable(),
    delta: z.number().int().min(-2147483647).max(1000000).nullable(),
    issues: z.array(z.enum(reconciliationIssues)).max(14),
  })
  .strict();
export const reconciliationSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: id,
    batchPayloadHash: hash,
    companyKey: key(64),
    externalWarehouseKey: key(64),
    observedAt: utc,
    isDemo: z.boolean(),
    warehouse: warehouseSchema.nullable(),
    rows: z.array(row).min(1).max(200),
    fingerprint: hash,
    canApplyManual: z.literal(false),
    canSyncLive: z.literal(false),
  })
  .strict()
  .superRefine((x, c) => {
    const bad = () =>
      c.addIssue({
        code: 'custom',
        message: 'پاسخ تطبیق به محدوده و ماندهٔ همین ورودی متصل نیست.',
      });
    if (
      x.warehouse &&
      (x.warehouse.companyKey !== x.companyKey ||
        x.warehouse.externalWarehouseKey !== x.externalWarehouseKey)
    )
      bad();
    if (new Set(x.rows.map((r) => r.externalItemId)).size !== x.rows.length) bad();
    for (const [i, r] of x.rows.entries()) {
      if (r.rowNumber !== i + 1 || new Set(r.issues).size !== r.issues.length) bad();
      if (!r.match && (r.stock || r.unitMapping || r.targetOnHand !== null || r.delta !== null))
        bad();
      if (
        r.unitMapping &&
        (r.unitMapping.originSystem !== 'holoo' ||
          r.unitMapping.companyKey !== x.companyKey ||
          r.unitMapping.warehouseKey !== x.externalWarehouseKey ||
          r.unitMapping.sourceUnitKey !== r.externalUnitKey ||
          r.unitMapping.variantId.toLowerCase() !== r.match?.variantId.toLowerCase() ||
          !r.unitMapping.isActive)
      )
        bad();
      if (r.targetOnHand !== null) {
        try {
          if (
            !r.unitMapping ||
            r.sourceQuantity === null ||
            convertAccountingQuantity(
              r.sourceQuantity,
              r.unitMapping.numerator,
              r.unitMapping.denominator,
            ) !== r.targetOnHand
          )
            bad();
        } catch {
          bad();
        }
        if (r.delta !== r.targetOnHand - (r.stock?.onHand ?? 0)) bad();
      } else if (r.delta !== null) bad();
    }
  });
export function readReconciliation(raw: unknown, batchId: string) {
  const v = reconciliationSchema.parse(raw);
  if (v.batchId !== batchId) throw Error('پاسخ به فایل انتخاب‌شده تعلق ندارد.');
  return v;
}
