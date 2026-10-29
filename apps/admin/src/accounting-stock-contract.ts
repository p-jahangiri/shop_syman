import { z } from 'zod';
import {
  reconciliationSchema,
  reconciliationIssues,
  convertAccountingQuantity,
} from './accounting-reconciliation-contract.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => x !== '0'.repeat(32));
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/),
  hash = z.string().regex(/^[A-F0-9]{64}$/);
const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/)
  .refine((x) => Number.isFinite(Date.parse(x)));
const ticks = (x: string) => {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(?:Z|\+00:00)$/.exec(x)!;
  return BigInt(Date.parse(m[1] + 'Z')) * 10000n + BigInt((m[2] ?? '').padEnd(7, '0'));
};
const key = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
    .refine((x) => x.trim() === x && !/[\u0000-\u001f\u007f]/.test(x));
const reason = z
  .string()
  .trim()
  .min(1)
  .max(400)
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  .refine((x) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x));
const proof = z
  .object({
    variantId: identifier,
    productId: identifier,
    variantVersion: version,
    productVersion: version,
    isActive: z.boolean(),
    isDigital: z.boolean(),
    isUsed: z.boolean(),
  })
  .strict();
export const stockApplyIssues = [
  ...reconciliationIssues,
  'accounting_observation_future',
  'accounting_batch_row_applied',
  'accounting_catalog_conflict',
  'accounting_observation_not_newer',
  'accounting_duplicate_sku',
  'accounting_stock_delta_limit',
] as const;
const candidate = z
  .object({
    rowNumber: z.number().int().min(1).max(200),
    canApply: z.boolean(),
    issues: z.array(z.enum(stockApplyIssues)).max(20),
    priorApplicationId: id.nullable(),
    lastAppliedObservationAt: utc.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      x.canApply === (x.issues.length === 0) &&
      new Set(x.issues).size === x.issues.length &&
      (!x.priorApplicationId || x.issues.includes('accounting_batch_row_applied')),
  );
export const stockPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    reconciliation: reconciliationSchema,
    catalogProofs: z.array(proof).max(200),
    candidates: z.array(candidate).min(1).max(200),
    fingerprint: hash,
    canApplyManual: z.boolean(),
    canSyncLive: z.literal(false),
  })
  .strict()
  .superRefine((x, c) => {
    const bad = () =>
      c.addIssue({
        code: 'custom',
        message: 'پیش‌نمایش اعمال با ردیف‌ها، نگاشت و نسخهٔ کالا هم‌خوان نیست.',
      });
    if (
      x.candidates.length !== x.reconciliation.rows.length ||
      new Set(x.catalogProofs.map((p) => p.variantId.toLowerCase())).size !==
        x.catalogProofs.length ||
      x.canApplyManual !== x.candidates.some((r) => r.canApply)
    )
      bad();
    for (const [i, r] of x.reconciliation.rows.entries()) {
      const s = x.candidates[i];
      if (!s || s.rowNumber !== r.rowNumber || r.issues.some((issue) => !s.issues.includes(issue)))
        bad();
      else {
        const p = x.catalogProofs.find(
          (p) => p.variantId.toLowerCase() === r.match?.variantId.toLowerCase(),
        );
        if (
          s.canApply &&
          (!p ||
            p.isUsed ||
            p.isDigital ||
            !p.isActive ||
            !r.unitMapping ||
            r.targetOnHand === null ||
            r.delta === null ||
            Math.abs(r.delta) > 1000000)
        )
          bad();
        if (
          s.lastAppliedObservationAt &&
          ticks(s.lastAppliedObservationAt) >= ticks(x.reconciliation.observedAt) &&
          !s.issues.includes('accounting_observation_not_newer')
        )
          bad();
      }
    }
  });
export const stockApplyInputSchema = z
  .object({
    commandId: id,
    previewFingerprint: hash,
    rowNumbers: z.array(z.number().int().min(1).max(200)).min(1).max(200),
    reason,
    acknowledgeWholeStorePhysical: z.literal(true),
    acknowledgeUnpostedSalesReconciled: z.literal(true),
  })
  .strict()
  .refine((x) => new Set(x.rowNumbers).size === x.rowNumbers.length)
  .transform((x) => ({ ...x, rowNumbers: [...x.rowNumbers].sort((a, b) => a - b) }));
const count = z.number().int().min(0).max(2147483647),
  target = z.number().int().min(0).max(1000000),
  ratio = z.number().int().min(1).max(1000000);
const movementId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((x) => BigInt(x) <= 9223372036854775807n);
const line = z
  .object({
    rowNumber: z.number().int().min(1).max(200),
    externalItemId: key(120),
    externalUnitKey: key(64),
    sourceQuantity: z.string().min(1).max(29),
    numerator: ratio,
    denominator: ratio,
    linkId: id,
    linkVersion: version,
    mappingId: id,
    mappingVersion: version,
    variantId: identifier,
    productId: identifier,
    variantVersion: version,
    productVersion: version,
    sku: key(80),
    nameFa: z.string().max(250),
    nameEn: z.string().max(250),
    beforeOnHand: count,
    afterOnHand: target,
    reserved: count,
    sourcingReserved: count,
    delta: z.number().int().min(-1000000).max(1000000),
    beforeStockVersion: version.nullable(),
    afterStockVersion: version.nullable(),
    movementId: movementId.nullable(),
  })
  .strict()
  .superRefine((x, c) => {
    const bad = () =>
      c.addIssue({
        code: 'custom',
        message: 'رسید، تبدیل واحد و گردش/ماندهٔ صحیح را حفظ نکرده است.',
      });
    try {
      if (convertAccountingQuantity(x.sourceQuantity, x.numerator, x.denominator) !== x.afterOnHand)
        bad();
    } catch {
      bad();
    }
    if (
      x.delta !== x.afterOnHand - x.beforeOnHand ||
      x.reserved + x.sourcingReserved > x.beforeOnHand ||
      x.reserved + x.sourcingReserved > x.afterOnHand
    )
      bad();
    if (
      x.beforeStockVersion === null &&
      (x.beforeOnHand !== 0 || x.reserved !== 0 || x.sourcingReserved !== 0)
    )
      bad();
    if (
      x.delta === 0
        ? x.movementId !== null || x.afterStockVersion !== x.beforeStockVersion
        : x.movementId === null ||
          x.afterStockVersion === null ||
          x.afterStockVersion === x.beforeStockVersion
    )
      bad();
  });
export const stockApplicationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    batchId: id,
    commandId: id,
    payloadHash: hash,
    batchPayloadHash: hash,
    previewFingerprint: hash,
    companyKey: key(64),
    externalWarehouseKey: key(64),
    warehouseId: id,
    warehouseVersion: version,
    observedAt: utc,
    appliedAt: utc,
    reason,
    isDemo: z.boolean(),
    acknowledgeWholeStorePhysical: z.literal(true),
    acknowledgeUnpostedSalesReconciled: z.literal(true),
    lines: z.array(line).min(1).max(200),
    replayed: z.boolean(),
  })
  .strict()
  .refine(
    (x) =>
      ticks(x.appliedAt) >= ticks(x.observedAt) &&
      new Set(x.lines.map((l) => l.rowNumber)).size === x.lines.length &&
      new Set(x.lines.map((l) => l.variantId.toLowerCase())).size === x.lines.length &&
      x.lines.every((l, i) => i === 0 || l.rowNumber > x.lines[i - 1].rowNumber),
  );
export type StockPreview = z.infer<typeof stockPreviewSchema>;
export type StockApplication = z.infer<typeof stockApplicationSchema>;
export interface StockApplyCommand {
  batchId: string;
  input: z.infer<typeof stockApplyInputSchema>;
  preview: StockPreview;
}
export function readStockPreview(raw: unknown, batchId: string) {
  const x = stockPreviewSchema.parse(raw);
  if (x.reconciliation.batchId !== batchId) throw Error('پیش‌نمایش به فایل انتخاب‌شده تعلق ندارد.');
  return x;
}
export function readStockApplication(raw: unknown, command: StockApplyCommand) {
  const x = stockApplicationSchema.parse(raw),
    p = command.preview,
    r = p.reconciliation,
    w = r.warehouse,
    input = command.input;
  if (
    !w ||
    x.commandId !== input.commandId ||
    x.batchId !== command.batchId ||
    x.previewFingerprint !== input.previewFingerprint ||
    x.previewFingerprint !== p.fingerprint ||
    x.batchPayloadHash !== r.batchPayloadHash ||
    x.companyKey !== r.companyKey ||
    x.externalWarehouseKey !== r.externalWarehouseKey ||
    x.warehouseId !== w.id ||
    x.warehouseVersion !== w.version ||
    x.isDemo !== r.isDemo ||
    ticks(x.observedAt) !== ticks(r.observedAt) ||
    x.reason !== input.reason.trim() ||
    x.lines.length !== input.rowNumbers.length
  )
    throw Error('رسید به همین فرمان، فایل و پیش‌نمایش تأییدشده تعلق ندارد.');
  for (const [i, l] of x.lines.entries()) {
    const row = r.rows.find((row) => row.rowNumber === input.rowNumbers[i]),
      proof = p.catalogProofs.find(
        (v) => v.variantId.toLowerCase() === row?.match?.variantId.toLowerCase(),
      ),
      mapping = row?.unitMapping,
      match = row?.match;
    if (
      !row ||
      !proof ||
      !mapping ||
      !match ||
      l.rowNumber !== row.rowNumber ||
      l.externalItemId !== row.externalItemId ||
      l.externalUnitKey !== row.externalUnitKey ||
      l.sourceQuantity !== row.sourceQuantity ||
      l.numerator !== mapping.numerator ||
      l.denominator !== mapping.denominator ||
      l.linkId !== match.linkId ||
      l.linkVersion !== match.linkVersion ||
      l.mappingId !== mapping.id ||
      l.mappingVersion !== mapping.version ||
      l.variantId.toLowerCase() !== match.variantId.toLowerCase() ||
      l.productId !== proof.productId ||
      l.variantVersion !== proof.variantVersion ||
      l.productVersion !== proof.productVersion ||
      l.sku !== match.sku ||
      l.nameFa !== match.nameFa ||
      l.nameEn !== match.nameEn ||
      l.beforeOnHand !== (row.stock?.onHand ?? 0) ||
      l.afterOnHand !== row.targetOnHand ||
      l.reserved !== (row.stock?.reserved ?? 0) ||
      l.sourcingReserved !== (row.stock?.sourcingReserved ?? 0) ||
      l.delta !== row.delta ||
      l.beforeStockVersion !== (row.stock?.version ?? null)
    )
      throw Error('ردیف رسید با تعداد، SKU، نگاشت و snapshot همان پیش‌نمایش یکسان نیست.');
  }
  return x;
}
