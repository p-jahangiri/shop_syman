import { z } from 'zod';
import {
  offerIdSchema as id,
  offerVersionSchema as version,
  offerFingerprintSchema as fingerprint,
} from '../../storefront/lib/offer-contract.ts';
import { imeiValid } from './serial-contract.ts';
export const supplyIdSchema = id;
const command = id;
const date = z.iso.datetime({ offset: true });
const utc = date.refine((value) => /(?:Z|\+00:00)$/.test(value));
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const eventId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const reference = z.string().regex(/^SR-[1-9][0-9]{0,18}$/);
const unique = (items: string[]) => new Set(items).size === items.length;
export const sameReceivingSku = (left: string, right: string) =>
  left.toUpperCase() === right.toUpperCase();
const text = (max: number, required = false) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').normalize('NFKC').trim())
    .pipe(
      z
        .string()
        .max(max)
        .refine(
          (value) => (!required || value.length > 0) && !/\p{Cc}/u.test(value.replaceAll('\n', '')),
        ),
    );
export const sourceKey = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim() && !/\p{Cc}/u.test(value));
const quantities = {
  requiredQuantity: z.number().int().min(1).max(1000000),
  receivedQuantity: z.number().int().min(0).max(1000000),
  remainingQuantity: z.number().int().min(0).max(1000000),
};
const counts = (value: {
  requiredQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
}) => value.requiredQuantity === value.receivedQuantity + value.remainingQuantity;
const state = z.enum([
  'PendingSupply',
  'SupplierRequested',
  'SupplierOrderRecorded',
  'Cancelled',
  'Failed',
]);
const progress = z.enum(['None', 'Partial', 'Complete']);
export const supplyNames: Record<string, string> = {
  PendingSupply: 'در انتظار پیگیری تأمین',
  SupplierRequested: 'استعلام از تأمین‌کننده ثبت شد',
  SupplierOrderRecorded: 'ثبت سفارش دستی نزد تأمین‌کننده',
  Cancelled: 'پیگیری لغوشده',
  Failed: 'تأمین ناموفق',
  PartiallyReceived: 'بخشی دریافت شده',
  Received: 'تمام اقلام دریافت شده',
};
export const supplySummarySchema = z
  .object({
    id,
    offerId: id,
    acceptanceId: id,
    state,
    receiptProgress: progress,
    effectiveState: z.enum([
      'PendingSupply',
      'SupplierRequested',
      'SupplierOrderRecorded',
      'Cancelled',
      'Failed',
      'PartiallyReceived',
      'Received',
    ]),
    version,
    lineCount: z.number().int().min(1).max(64),
    requiredQuantity: z.number().int().min(1).max(64000000),
    receivedQuantity: z.number().int().min(0).max(64000000),
    remainingQuantity: z.number().int().min(0).max(64000000),
    createdAt: date,
    changedAt: date,
    expectedAt: date.nullable(),
    purchaseUntil: date,
    isOpen: z.boolean(),
    requiresNewOffer: z.boolean(),
    isDemo: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      counts(value) &&
      Date.parse(value.changedAt) >= Date.parse(value.createdAt) &&
      value.isOpen ===
        ['PendingSupply', 'SupplierRequested', 'SupplierOrderRecorded'].includes(value.state) &&
      value.receiptProgress ===
        (value.remainingQuantity === 0
          ? 'Complete'
          : value.receivedQuantity > 0
            ? 'Partial'
            : 'None') &&
      value.effectiveState ===
        (!value.isOpen
          ? value.state
          : value.receiptProgress === 'Complete'
            ? 'Received'
            : value.receiptProgress === 'Partial'
              ? 'PartiallyReceived'
              : value.state),
  );
const lineFields = {
  offerLineId: id,
  variantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  sku: z.string().min(1).max(80),
  nameFa: z.string().max(4000),
  nameEn: z.string().max(4000),
  labelFa: z.string().max(2000),
  labelEn: z.string().max(2000),
  ...quantities,
};
const line = z.object(lineFields).strict().refine(counts);
const safety = {
  reservedForRequest: z.literal(false),
  canCheckout: z.literal(false),
  canPay: z.literal(false),
};
const detailBase = {
  schemaVersion: z.literal(1),
  requestId: id,
  requestReference: reference,
  requestVersion: version,
  task: supplySummarySchema,
  lines: z.array(line).min(1).max(64),
  publicMessageFa: z.string().max(500),
  publicMessageEn: z.string().max(500),
  ...safety,
};
const detailCounts = (value: {
  task: z.infer<typeof supplySummarySchema>;
  lines: {
    offerLineId: string;
    requiredQuantity: number;
    receivedQuantity: number;
    remainingQuantity: number;
  }[];
}) =>
  unique(value.lines.map((item) => item.offerLineId)) &&
  value.task.lineCount === value.lines.length &&
  value.task.requiredQuantity ===
    value.lines.reduce((sum, item) => sum + item.requiredQuantity, 0) &&
  value.task.receivedQuantity === value.lines.reduce((sum, item) => sum + item.receivedQuantity, 0);
export const supplyAdminDetailSchema = z
  .object({
    ...detailBase,
    sourceKind: z.enum(['manual', 'csv']).nullable(),
    sourceKey: sourceKey(120).nullable(),
    sourceNameFa: z.string().max(200).nullable(),
    sourceNameEn: z.string().max(200).nullable(),
    reference: sourceKey(200).nullable(),
    actionAt: date.nullable(),
    internalNote: z.string().max(2000),
    canRecordSource: z.boolean(),
    canProgress: z.boolean(),
    canCancel: z.boolean(),
    canFail: z.boolean(),
  })
  .strict()
  .refine(detailCounts);
export const supplyAdminPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: id,
    requestReference: reference,
    requestVersion: version,
    pageSize: z.literal(50),
    items: z.array(supplySummarySchema).max(50),
    nextCursor: cursor.nullable(),
    startCandidate: z
      .object({
        offerId: id,
        acceptanceId: id,
        offerVersion: version,
        termsHash: fingerprint,
        purchaseUntil: date,
      })
      .strict()
      .nullable(),
    ...safety,
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
const event = z
  .object({
    id: eventId,
    stateBefore: state.nullable(),
    stateAfter: state,
    receiptProgress: progress,
    actorKind: z.enum(['customer', 'staff', 'system']),
    reasonCode: z.string().regex(/^[a-z_]{1,100}$/),
    publicMessageFa: z.string().max(500),
    publicMessageEn: z.string().max(500),
    actionAt: date.nullable(),
    expectedAt: date.nullable(),
    at: date,
  })
  .strict();
export const supplyAdminEventsSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z
      .array(
        z
          .object({
            event,
            actorId: z.string().min(1).max(64),
            sourceKind: z.enum(['manual', 'csv']).nullable(),
            sourceKey: sourceKey(120).nullable(),
            sourceNameFa: z.string().max(200).nullable(),
            sourceNameEn: z.string().max(200).nullable(),
            reference: sourceKey(200).nullable(),
            internalNote: z.string().max(2000),
          })
          .strict(),
      )
      .max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.event.id)));
export const supplyMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    operation: z.enum(['start', 'requested', 'ordered', 'progress', 'cancel', 'fail']),
    state,
    receiptProgress: progress,
    version,
    requestVersion: version,
    eventId,
    at: date,
    replayed: z.boolean(),
    canCheckout: z.literal(false),
    canPay: z.literal(false),
  })
  .strict();
export const supplyStartSchema = z
  .object({
    requestId: command,
    requestVersion: version,
    offerVersion: version,
    termsHash: fingerprint,
  })
  .strict();
const taskAction = { requestId: command, requestVersion: version, taskVersion: version };
const messageFields = {
  publicMessageFa: text(500, true),
  publicMessageEn: text(500, true),
  internalNote: text(2000).nullable(),
};
export const supplySourceSchema = z
  .object({
    ...taskAction,
    sourceKind: z.enum(['manual', 'csv']),
    sourceKey: sourceKey(120),
    sourceNameFa: text(200, true),
    sourceNameEn: text(200, true),
    reference: sourceKey(200).nullable(),
    actionAt: utc,
    expectedAt: utc.nullable(),
    ...messageFields,
  })
  .strict();
export const supplyProgressSchema = z
  .object({ ...taskAction, actionAt: utc, expectedAt: utc.nullable(), ...messageFields })
  .strict();
export const supplyCloseSchema = z
  .object({ ...taskAction, reasonCode: z.string().regex(/^[a-z_]{1,64}$/), ...messageFields })
  .strict();
const inventoryLine = z
  .object({ ...lineFields, productId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
  .strict()
  .refine(counts);
export const inventorySupplyTaskSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: id,
    requestReference: reference,
    requestVersion: version,
    task: supplySummarySchema,
    lines: z.array(inventoryLine).min(1).max(64),
    canReceive: z.boolean(),
    requiresHistoricalAcknowledgement: z.boolean(),
    ...safety,
  })
  .strict()
  .refine(detailCounts);
const stock = z
  .object({
    variantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    trackingMode: z.enum(['none', 'serial', 'imei']),
    onHand: z.number().int().min(0).max(2147483647),
    reserved: z.number().int().min(0).max(2147483647),
    version: version.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.onHand >= value.reserved &&
      (value.version !== null ||
        (value.onHand === 0 && value.reserved === 0 && value.trackingMode === 'none')),
  );
export const inventorySupplyDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: inventorySupplyTaskSchema,
    stock: z.array(stock).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.stock.map((item) => item.variantId.toUpperCase())) &&
      value.stock.length ===
        new Set(value.task.lines.map((item) => item.variantId.toUpperCase())).size &&
      value.task.lines.every((line) =>
        value.stock.some((row) => sameReceivingSku(row.variantId, line.variantId)),
      ),
  );
export const inventorySupplyPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z
      .array(
        z
          .object({
            requestId: id,
            requestReference: reference,
            requestVersion: version,
            task: supplySummarySchema,
          })
          .strict(),
      )
      .max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.task.id)));
export function inventorySupplyPath(
  filters: { state: string; query: string },
  after: string | null,
) {
  const selected = z
      .enum([
        'all',
        'PendingSupply',
        'SupplierRequested',
        'SupplierOrderRecorded',
        'Cancelled',
        'Failed',
      ])
      .parse(filters.state),
    query = z
      .string()
      .max(120)
      .refine(
        (value) =>
          !/[\p{Cc}]/u.test(value) && value.trim().split(/\s+/).filter(Boolean).length <= 8,
      )
      .parse(filters.query);
  const params = new URLSearchParams();
  if (selected !== 'all') params.set('state', selected);
  if (query.trim()) params.set('query', query.trim());
  if (after) params.set('cursor', cursor.parse(after));
  return '/admin/inventory/sourcing-tasks/v2' + (params.size ? '?' + params : '');
}
const allocationLine = z
  .object({
    offerLineId: id,
    variantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    quantity: z.number().int().min(1).max(1000000),
  })
  .strict();
export const supplyAllocationSchema = z
  .object({
    id,
    state: z.literal('Active'),
    effectiveState: z.enum(['Active', 'Expired']),
    version,
    expiresAt: date,
    isDemo: z.boolean(),
    quantity: z.number().int().min(1).max(64000000),
    lines: z.array(allocationLine).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((line) => line.offerLineId)) &&
      value.quantity === value.lines.reduce((sum, line) => sum + line.quantity, 0),
  );
export const supplySummaryV2Schema = supplySummarySchema
  .safeExtend({ allocation: supplyAllocationSchema.nullable(), reservedForRequest: z.boolean() })
  .refine(
    (value) =>
      value.reservedForRequest === (value.allocation?.effectiveState === 'Active') &&
      (value.allocation === null ||
        (value.allocation.quantity === value.requiredQuantity &&
          value.allocation.lines.length === value.lineCount &&
          Date.parse(value.allocation.expiresAt) <= Date.parse(value.purchaseUntil) &&
          (!value.allocation.isDemo || value.isDemo))),
  );
const allocationMatches = (value: {
  reservedForRequest: boolean;
  task: z.infer<typeof supplySummaryV2Schema>;
  lines: { offerLineId: string; variantId: string; requiredQuantity: number }[];
}) =>
  value.reservedForRequest === value.task.reservedForRequest &&
  (value.task.allocation === null ||
    value.task.allocation.lines.every((held) =>
      value.lines.some(
        (line) =>
          line.offerLineId === held.offerLineId &&
          sameReceivingSku(line.variantId, held.variantId) &&
          line.requiredQuantity === held.quantity,
      ),
    ));
export const supplyAdminDetailV2Schema = z
  .object({
    ...supplyAdminDetailSchema.shape,
    schemaVersion: z.literal(2),
    task: supplySummaryV2Schema,
    reservedForRequest: z.boolean(),
  })
  .strict()
  .refine(detailCounts)
  .refine(allocationMatches);
export const supplyAdminPageV2Schema = z
  .object({
    ...supplyAdminPageSchema.shape,
    schemaVersion: z.literal(2),
    items: z.array(supplySummaryV2Schema).max(50),
    reservedForRequest: z.boolean(),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)))
  .refine(
    (value) => value.reservedForRequest === value.items.some((item) => item.reservedForRequest),
  );
export const inventorySupplyTaskV2Schema = z
  .object({
    ...inventorySupplyTaskSchema.shape,
    schemaVersion: z.literal(2),
    task: supplySummaryV2Schema,
    reservedForRequest: z.boolean(),
  })
  .strict()
  .refine(detailCounts)
  .refine(allocationMatches);
export const inventorySupplyDetailV2Schema = z
  .object({
    ...inventorySupplyDetailSchema.shape,
    schemaVersion: z.literal(2),
    task: inventorySupplyTaskV2Schema,
  })
  .strict()
  .refine(
    (value) =>
      unique(value.stock.map((item) => item.variantId.toUpperCase())) &&
      value.stock.length ===
        new Set(value.task.lines.map((item) => item.variantId.toUpperCase())).size &&
      value.task.lines.every((line) =>
        value.stock.some((row) => sameReceivingSku(row.variantId, line.variantId)),
      ),
  );
export const inventorySupplyPageV2Schema = z
  .object({
    ...inventorySupplyPageSchema.shape,
    schemaVersion: z.literal(2),
    items: z
      .array(
        z
          .object({
            requestId: id,
            requestReference: reference,
            requestVersion: version,
            task: supplySummaryV2Schema,
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.task.id)));
export const mappingSchema = z
  .object({
    id,
    originSystem: sourceKey(64),
    companyKey: sourceKey(64),
    warehouseKey: sourceKey(64),
    sourceUnitKey: sourceKey(120),
    variantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    numerator: z.number().int().min(1).max(1000000),
    denominator: z.number().int().min(1).max(1000000),
    nameFa: z.string().min(1).max(200),
    nameEn: z.string().min(1).max(200),
    isActive: z.boolean(),
    version,
  })
  .strict();
export const mappingPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(mappingSchema).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
export const mappingInputSchema = mappingSchema
  .omit({ id: true, version: true })
  .extend({
    requestId: command,
    version: version.nullable(),
    nameFa: text(200, true),
    nameEn: text(200, true),
  })
  .strict();
export const mappingMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version,
    commandId: command,
    at: date,
    replayed: z.boolean(),
  })
  .strict();
export const sourceQuantitySchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{0,7}[1-9])?$/)
  .refine((value) => value !== '0' && value.replace('.', '').length <= 28);
export function receivingQuantity(source: string, numerator: number, denominator: number) {
  const value = sourceQuantitySchema.parse(source),
    [whole, fraction = ''] = value.split('.'),
    scale = 10n ** BigInt(fraction.length),
    raw = BigInt(whole + fraction) * BigInt(numerator),
    divisor = BigInt(denominator) * scale;
  if (
    !Number.isSafeInteger(numerator) ||
    numerator < 1 ||
    numerator > 1000000 ||
    !Number.isSafeInteger(denominator) ||
    denominator < 1 ||
    denominator > 1000000 ||
    raw % divisor !== 0n ||
    raw / divisor < 1n ||
    raw / divisor > 1000000n
  )
    throw new Error(
      'مقدار و نسبت نگاشت باید دقیقاً تعداد صحیح واحد فروش بسازند؛ گردکردن مجاز نیست.',
    );
  return Number(raw / divisor);
}
const serial = z.string().regex(/^[A-Z0-9._/-]{1,100}$/),
  imei = z.string().refine(imeiValid);
const unit = z
  .object({ serial: serial.nullable(), imei1: imei.nullable(), imei2: imei.nullable() })
  .strict()
  .refine(
    (value) =>
      (value.serial !== null || value.imei1 !== null) &&
      (value.imei2 === null || (value.imei1 !== null && value.imei2 !== value.imei1)),
  );
const receiptLine = z
  .object({
    offerLineId: id,
    sourceReceiptLineKey: sourceKey(120),
    mappingId: id,
    mappingVersion: version,
    sourceQuantity: sourceQuantitySchema,
    trackingMode: z.enum(['none', 'serial', 'imei']),
    stockVersion: version.nullable(),
    units: z.array(unit).max(100),
  })
  .strict()
  .refine((value) =>
    value.trackingMode === 'none'
      ? value.units.length === 0
      : value.units.length > 0 &&
        value.units.every((row) =>
          value.trackingMode === 'serial' ? row.serial !== null : row.imei1 !== null,
        ),
  );
export const receivingInputSchema = z
  .object({
    ...taskAction,
    channel: z.enum(['manual', 'csv']),
    originSystem: sourceKey(64),
    companyKey: sourceKey(64),
    warehouseKey: sourceKey(64),
    sourceReceiptKey: sourceKey(120),
    receivedAt: utc,
    reason: text(500, true),
    acknowledgeHistorical: z.boolean(),
    lines: z.array(receiptLine).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((item) => item.sourceReceiptLineKey)) &&
      value.lines.reduce((sum, item) => sum + item.units.length, 0) <= 100 &&
      unique(
        value.lines.flatMap((line) =>
          line.units.flatMap((item) =>
            [
              item.serial === null ? null : 'S:' + item.serial,
              item.imei1 === null ? null : 'I:' + item.imei1,
              item.imei2 === null ? null : 'I:' + item.imei2,
            ].filter((key): key is string => key !== null),
          ),
        ),
      ),
  );
const resultLine = z
  .object({
    id,
    offerLineId: id,
    variantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    quantity: z.number().int().min(1).max(1000000),
    movementId: eventId,
    unitIds: z.array(id).max(100),
  })
  .strict();
export const receivingMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    requiresNewOffer: z.boolean(),
    receivedAt: date,
    recordedAt: date,
    replayed: z.boolean(),
    lines: z.array(resultLine).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((item) => item.id)) &&
      unique(value.lines.flatMap((item) => item.unitIds)) &&
      value.lines.reduce((sum, item) => sum + item.unitIds.length, 0) <= 100,
  );
const receiptDataLine = resultLine
  .omit({ unitIds: true })
  .extend({
    sourceReceiptLineKey: sourceKey(120),
    mappingId: id,
    mappingVersion: version,
    sourceUnitKey: sourceKey(120),
    unitNameFa: z.string().max(200),
    unitNameEn: z.string().max(200),
    numerator: z.number().int().min(1).max(1000000),
    denominator: z.number().int().min(1).max(1000000),
    sourceQuantity: sourceQuantitySchema,
    trackingMode: z.enum(['none', 'serial', 'imei']),
    unitIds: z.array(id).max(100),
  })
  .strict()
  .refine((value) => {
    try {
      return (
        receivingQuantity(value.sourceQuantity, value.numerator, value.denominator) ===
          value.quantity &&
        (value.trackingMode === 'none'
          ? value.unitIds.length === 0
          : value.unitIds.length === value.quantity)
      );
    } catch {
      return false;
    }
  });
export const receivingDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    channel: z.enum(['manual', 'csv']),
    originSystem: sourceKey(64),
    companyKey: sourceKey(64),
    warehouseKey: sourceKey(64),
    sourceReceiptKey: sourceKey(120),
    receivedAt: date,
    recordedAt: date,
    actorId: z.string().min(1).max(64),
    reason: z.string().max(500),
    acknowledgeHistorical: z.boolean(),
    requiresNewOffer: z.boolean(),
    lines: z.array(receiptDataLine).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((item) => item.id)) &&
      unique(value.lines.map((item) => item.sourceReceiptLineKey)) &&
      unique(value.lines.flatMap((item) => item.unitIds)),
  );
type Phase = {
  id: string;
  reference: string;
  phase: 'pending' | 'unknown' | 'failed' | 'refresh';
  uncertain?: boolean;
  message?: string;
};
export type SupplyAdminCommand = Phase &
  (
    | {
        kind: 'supply-start';
        requestId: string;
        offerId: string;
        taskId: string;
        body: z.infer<typeof supplyStartSchema>;
      }
    | {
        kind: 'supply-requested' | 'supply-ordered';
        requestId: string;
        taskId: string;
        body: z.infer<typeof supplySourceSchema>;
      }
    | {
        kind: 'supply-progress';
        requestId: string;
        taskId: string;
        body: z.infer<typeof supplyProgressSchema>;
      }
    | {
        kind: 'supply-cancel' | 'supply-fail';
        requestId: string;
        taskId: string;
        body: z.infer<typeof supplyCloseSchema>;
      }
    | { kind: 'mapping-save'; resourceId: string; body: z.infer<typeof mappingInputSchema> }
    | {
        kind: 'receive';
        resourceId: string;
        requestId: string;
        taskId: string;
        body: z.infer<typeof receivingInputSchema>;
      }
  );
export type SupplyAdminDetail = z.infer<typeof supplyAdminDetailV2Schema>;
export type InventorySupplyDetail = z.infer<typeof inventorySupplyDetailV2Schema>;
export type ReceivingMapping = z.infer<typeof mappingSchema>;
