import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import { marketIdSchema } from '@sayman/web-shared/lib/market/market-contract.ts';
import { offerIdSchema, offerVersionSchema } from '@sayman/web-shared/lib/market/offer-contract.ts';

const date = z.iso.datetime({ offset: true }).refine((value) => /(?:Z|\+00:00)$/.test(value));
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const reference = z.string().regex(/^SR-[1-9][0-9]{0,18}$/);
const quantity = z.number().int().min(0).max(64000000);
const positiveId = z
  .string()
  .refine((value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
const unique = (values: string[]) => new Set(values).size === values.length;
export const supplyStateSchema = z.enum([
  'PendingSupply',
  'SupplierRequested',
  'SupplierOrderRecorded',
  'Cancelled',
  'Failed',
]);
export const supplyProgressSchema = z.enum(['None', 'Partial', 'Complete']);
export const supplyEffectiveStateSchema = z.enum([
  'PendingSupply',
  'SupplierRequested',
  'SupplierOrderRecorded',
  'PartiallyReceived',
  'Received',
  'Cancelled',
  'Failed',
]);
export const supplySummarySchema = z
  .object({
    id: offerIdSchema,
    offerId: offerIdSchema,
    acceptanceId: offerIdSchema,
    state: supplyStateSchema,
    receiptProgress: supplyProgressSchema,
    effectiveState: supplyEffectiveStateSchema,
    version: offerVersionSchema,
    lineCount: z.number().int().min(1).max(64),
    requiredQuantity: quantity,
    receivedQuantity: quantity,
    remainingQuantity: quantity,
    createdAt: date,
    changedAt: date,
    expectedAt: date.nullable(),
    purchaseUntil: date,
    isOpen: z.boolean(),
    requiresNewOffer: z.boolean(),
    isDemo: z.boolean(),
  })
  .strict()
  .refine((value) => {
    const open = ['PendingSupply', 'SupplierRequested', 'SupplierOrderRecorded'].includes(
      value.state,
    );
    const progress =
      value.receivedQuantity === value.requiredQuantity
        ? 'Complete'
        : value.receivedQuantity > 0
          ? 'Partial'
          : 'None';
    const effective = !open
      ? value.state
      : progress === 'Complete'
        ? 'Received'
        : progress === 'Partial'
          ? 'PartiallyReceived'
          : value.state;
    return (
      value.requiredQuantity >= value.lineCount &&
      value.receivedQuantity <= value.requiredQuantity &&
      value.remainingQuantity === value.requiredQuantity - value.receivedQuantity &&
      value.isOpen === open &&
      value.receiptProgress === progress &&
      value.effectiveState === effective &&
      (open || value.requiresNewOffer) &&
      Date.parse(value.changedAt) >= Date.parse(value.createdAt) &&
      Date.parse(value.purchaseUntil) > Date.parse(value.createdAt)
    );
  });
export const supplyLineSchema = z
  .object({
    offerLineId: offerIdSchema,
    variantId: marketIdSchema,
    sku: z.string().min(1).max(80),
    nameFa: z.string().min(1).max(250),
    nameEn: z.string().min(1).max(250),
    labelFa: z.string().max(2000),
    labelEn: z.string().max(2000),
    requiredQuantity: z.number().int().min(1).max(1000000),
    receivedQuantity: z.number().int().min(0).max(1000000),
    remainingQuantity: z.number().int().min(0).max(1000000),
  })
  .strict()
  .refine(
    (value) =>
      value.receivedQuantity <= value.requiredQuantity &&
      value.remainingQuantity === value.requiredQuantity - value.receivedQuantity,
  );
const flags = {
  reservedForRequest: z.literal(false),
  canCheckout: z.literal(false),
  canPay: z.literal(false),
};
export const supplyDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: offerIdSchema,
    requestReference: reference,
    requestVersion: offerVersionSchema,
    task: supplySummarySchema,
    lines: z.array(supplyLineSchema).min(1).max(64),
    publicMessageFa: z.string().max(500),
    publicMessageEn: z.string().max(500),
    ...flags,
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((line) => line.offerLineId)) &&
      value.task.lineCount === value.lines.length &&
      value.task.requiredQuantity ===
        value.lines.reduce((sum, line) => sum + line.requiredQuantity, 0) &&
      value.task.receivedQuantity ===
        value.lines.reduce((sum, line) => sum + line.receivedQuantity, 0) &&
      value.task.remainingQuantity ===
        value.lines.reduce((sum, line) => sum + line.remainingQuantity, 0),
  );
// This customer boundary must reject an administrative start capability even
// when an otherwise valid staff page accidentally reaches the public BFF.
export const supplyPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: offerIdSchema,
    requestReference: reference,
    requestVersion: offerVersionSchema,
    pageSize: z.literal(20),
    items: z.array(supplySummarySchema).max(20),
    nextCursor: cursor.nullable(),
    startCandidate: z.null(),
    ...flags,
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
export const supplyEventSchema = z
  .object({
    id: positiveId,
    stateBefore: supplyStateSchema.nullable(),
    stateAfter: supplyStateSchema,
    receiptProgress: supplyProgressSchema,
    actorKind: z.enum(['staff', 'customer', 'system']),
    reasonCode: z.string().regex(/^[a-z_]{1,64}$/),
    publicMessageFa: z.string().max(500),
    publicMessageEn: z.string().max(500),
    actionAt: date.nullable(),
    expectedAt: date.nullable(),
    at: date,
  })
  .strict()
  .refine((value) => value.stateBefore !== null || value.stateAfter === 'PendingSupply');
export const supplyEventsSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(20),
    items: z.array(supplyEventSchema).max(20),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.items.map((item) => item.id)) &&
      value.items.every(
        (item, index) => index === 0 || BigInt(item.id) > BigInt(value.items[index - 1].id),
      ),
  );
const allocationLine = z
  .object({
    offerLineId: offerIdSchema,
    variantId: marketIdSchema,
    quantity: z.number().int().min(1).max(1000000),
  })
  .strict();
export const supplyAllocationSchema = z
  .object({
    id: offerIdSchema,
    state: z.literal('Active'),
    effectiveState: z.enum(['Active', 'Expired']),
    version: offerVersionSchema,
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
export const supplyDetailV2Schema = z
  .object({
    ...supplyDetailSchema.shape,
    schemaVersion: z.literal(2),
    task: supplySummaryV2Schema,
    reservedForRequest: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((line) => line.offerLineId)) &&
      value.task.lineCount === value.lines.length &&
      value.task.requiredQuantity ===
        value.lines.reduce((sum, line) => sum + line.requiredQuantity, 0) &&
      value.task.receivedQuantity ===
        value.lines.reduce((sum, line) => sum + line.receivedQuantity, 0) &&
      value.task.remainingQuantity ===
        value.lines.reduce((sum, line) => sum + line.remainingQuantity, 0),
  )
  .refine(
    (value) =>
      value.reservedForRequest === value.task.reservedForRequest &&
      (value.task.allocation === null ||
        value.task.allocation.lines.every((held) =>
          value.lines.some(
            (line) =>
              line.offerLineId === held.offerLineId &&
              line.variantId.toUpperCase() === held.variantId.toUpperCase() &&
              line.requiredQuantity === held.quantity,
          ),
        )),
  );
export const supplyPageV2Schema = z
  .object({
    ...supplyPageSchema.shape,
    schemaVersion: z.literal(2),
    items: z.array(supplySummaryV2Schema).max(20),
    reservedForRequest: z.boolean(),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)))
  .refine(
    (value) => value.reservedForRequest === value.items.some((item) => item.reservedForRequest),
  );
export type SupplySummary = z.infer<typeof supplySummaryV2Schema>;
export type SupplyDetail = z.infer<typeof supplyDetailV2Schema>;
export type SupplyPage = z.infer<typeof supplyPageV2Schema>;
export type SupplyEvents = z.infer<typeof supplyEventsSchema>;
