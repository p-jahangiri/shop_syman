import { z } from 'zod';
import {
  offerIdSchema as id,
  offerVersionSchema as version,
  offerFingerprintSchema as fingerprint,
} from '@sayman/web-shared/lib/market/offer-contract.ts';
import { serialUnitSchema, type SerialUnit } from '../inventory/serial-contract.ts';
const date = z.iso.datetime({ offset: true }).refine((value) => /(?:Z|\+00:00)$/.test(value));
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const unique = (values: string[]) => new Set(values).size === values.length;
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();
const quantity = z.number().int().min(1).max(1000000),
  counter = z.number().int().min(0).max(2147483647);
const state = z.enum(['Active', 'Released', 'Expired', 'Transferred']);
const effective = (value: { state: string; effectiveState: string }) =>
  value.state === 'Active'
    ? ['Active', 'Expired'].includes(value.effectiveState)
    : value.state === value.effectiveState;
const line = z.object({ offerLineId: id, variantId: identifier, quantity }).strict();
const summary = z
  .object({
    schemaVersion: z.literal(1),
    id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    state: z.literal('Active'),
    effectiveState: z.enum(['Active', 'Expired']),
    version,
    expiresAt: date,
    isDemo: z.boolean(),
    quantity: z.number().int().min(1).max(64000000),
    lines: z.array(line).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((row) => row.offerLineId)) &&
      value.quantity === value.lines.reduce((sum, row) => sum + row.quantity, 0),
  );
export const allocationCandidateStockSchema = z
  .object({
    variantId: identifier,
    trackingMode: z.enum(['none', 'serial', 'imei']),
    onHand: counter,
    reserved: counter,
    sourcingReserved: counter,
    available: counter,
    version: version.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      BigInt(value.onHand) - BigInt(value.reserved) - BigInt(value.sourcingReserved) ===
        BigInt(value.available) &&
      (value.version !== null ||
        (value.trackingMode === 'none' &&
          value.onHand === 0 &&
          value.reserved === 0 &&
          value.sourcingReserved === 0)),
  );
export const allocationCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: id,
    requestReference: z.string().regex(/^SR-[1-9][0-9]{0,18}$/),
    requestVersion: version,
    taskId: id,
    taskVersion: version,
    offerId: id,
    offerVersion: version,
    acceptanceId: id,
    termsHash: fingerprint,
    purchaseUntil: date,
    isDemo: z.boolean(),
    canAttemptAllocation: z.boolean(),
    lines: z
      .array(
        line
          .extend({
            sku: z.string().min(1).max(80),
            nameFa: z.string().max(250),
            nameEn: z.string().max(250),
            labelFa: z.string().max(2000),
            labelEn: z.string().max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    stock: z.array(allocationCandidateStockSchema).min(1).max(64),
    allocation: summary.nullable(),
    canCheckout: z.literal(false),
    canPay: z.literal(false),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((row) => row.offerLineId)) &&
      unique(value.stock.map((row) => row.variantId.toUpperCase())) &&
      value.stock.length === new Set(value.lines.map((row) => row.variantId.toUpperCase())).size &&
      value.lines.every((row) =>
        value.stock.some((stock) => same(stock.variantId, row.variantId)),
      ) &&
      (!value.allocation ||
        (value.allocation.requestId === value.requestId &&
          value.allocation.taskId === value.taskId &&
          value.allocation.offerId === value.offerId &&
          value.allocation.acceptanceId === value.acceptanceId &&
          !value.canAttemptAllocation &&
          Date.parse(value.allocation.expiresAt) <= Date.parse(value.purchaseUntil) &&
          value.allocation.lines.length === value.lines.length &&
          value.allocation.lines.every((held) =>
            value.lines.some(
              (row) =>
                row.offerLineId === held.offerLineId &&
                same(row.variantId, held.variantId) &&
                row.quantity === held.quantity,
            ),
          ))),
  );
export const allocationDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    state,
    effectiveState: state,
    version,
    createdAt: date,
    changedAt: date,
    expiresAt: date,
    isDemo: z.boolean(),
    lines: z
      .array(
        line
          .extend({ unitIds: z.array(id).max(100) })
          .strict()
          .refine((value) => value.unitIds.length === 0 || value.unitIds.length === value.quantity),
      )
      .min(1)
      .max(64),
  })
  .strict()
  .refine(
    (value) =>
      effective(value) &&
      Date.parse(value.changedAt) >= Date.parse(value.createdAt) &&
      Date.parse(value.expiresAt) > Date.parse(value.createdAt) &&
      unique(value.lines.map((row) => row.offerLineId)) &&
      value.lines.reduce((sum, row) => sum + row.unitIds.length, 0) <= 100 &&
      unique(value.lines.flatMap((row) => row.unitIds)),
  );
const reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/\p{Cc}/u.test(value));
const unit = z.object({ unitId: id, version }).strict();
export const allocationInputSchema = z
  .object({
    requestId: id,
    requestVersion: version,
    taskVersion: version,
    offerVersion: version,
    acceptanceId: id,
    termsHash: fingerprint,
    expiresAt: date,
    reason,
    lines: z
      .array(
        z
          .object({
            offerLineId: id,
            stockVersion: version.nullable(),
            trackingMode: z.enum(['none', 'serial', 'imei']),
            units: z.array(unit).max(100),
          })
          .strict()
          .refine((value) =>
            value.trackingMode === 'none' ? value.units.length === 0 : value.units.length > 0,
          ),
      )
      .min(1)
      .max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((row) => row.offerLineId)) &&
      value.lines.reduce((sum, row) => sum + row.units.length, 0) <= 100 &&
      unique(value.lines.flatMap((row) => row.units.map((unit) => unit.unitId))),
  );
export const allocationReleaseSchema = z
  .object({ requestId: id, acceptanceId: id, version, reason })
  .strict();
export const allocationMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    allocationId: id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    operation: z.enum(['allocate', 'release']),
    state,
    version,
    commandId: id,
    at: date,
    expiresAt: date,
    replayed: z.boolean(),
  })
  .strict()
  .refine((value) =>
    value.operation === 'allocate'
      ? value.state === 'Active'
      : value.state === 'Released' || value.state === 'Expired',
  );
const eventId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
export const allocationEventsSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z
      .array(z.object({ id: eventId, state, reason: z.string().max(500), at: date }).strict())
      .max(50),
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
export type AllocationCandidate = z.infer<typeof allocationCandidateSchema>;
export type AllocationData = z.infer<typeof allocationDataSchema>;
export type AllocationPickedUnit = {
  unit: SerialUnit;
  stockVersion: string;
  hasActiveClaim: boolean;
};
export type AllocationPicks = Record<string, AllocationPickedUnit[]>;
export type AllocationAdminCommand = {
  id: string;
  reference: string;
  requestId: string;
  taskId: string;
  offerId: string;
  resourceId: string;
  phase: 'pending' | 'unknown' | 'failed' | 'refresh';
  uncertain?: boolean;
  message?: string;
} & (
  | { kind: 'allocation-allocate'; body: z.infer<typeof allocationInputSchema> }
  | { kind: 'allocation-release'; body: z.infer<typeof allocationReleaseSchema> }
);
export function allocationBody(
  candidate: AllocationCandidate,
  commandId: string,
  expiresAt: string,
  why: string,
  picks: AllocationPicks,
  now: number,
) {
  const value = allocationCandidateSchema.parse(candidate);
  if (
    !value.canAttemptAllocation ||
    value.allocation ||
    !Number.isFinite(now) ||
    Date.parse(expiresAt) <= now ||
    Date.parse(expiresAt) > Date.parse(value.purchaseUntil)
  )
    throw new Error(
      'مهلت نگه‌داری را صریح، آینده و حداکثر تا پایان اعتبار همین پذیرش وارد کنید؛ وضعیت تازه و بدون تخصیص فعال لازم است.',
    );
  if (Object.keys(picks).some((key) => value.lines.every((line) => line.offerLineId !== key)))
    throw new Error('انتخاب دستگاه باید به همان خطوط پذیرش تعلق داشته باشد.');
  const totals = new Map<string, number>();
  for (const row of value.lines)
    totals.set(
      row.variantId.toUpperCase(),
      (totals.get(row.variantId.toUpperCase()) ?? 0) + row.quantity,
    );
  for (const stock of value.stock)
    if (
      stock.version === null ||
      (totals.get(stock.variantId.toUpperCase()) ?? 0) > stock.available
    )
      throw new Error(
        'موجودی واقعی آزاد برای تمام خطوط همین SKU کافی نیست؛ وضعیت انبار را بازخوانی کنید.',
      );
  const body = allocationInputSchema.parse({
    requestId: commandId,
    requestVersion: value.requestVersion,
    taskVersion: value.taskVersion,
    offerVersion: value.offerVersion,
    acceptanceId: value.acceptanceId,
    termsHash: value.termsHash,
    expiresAt,
    reason: why,
    lines: value.lines
      .map((row) => {
        const stock = value.stock.find((stock) => same(stock.variantId, row.variantId))!,
          selected = picks[row.offerLineId] ?? [];
        if (
          (stock.trackingMode === 'none' && selected.length) ||
          (stock.trackingMode !== 'none' && selected.length !== row.quantity)
        )
          throw new Error(
            'برای هر خط رهگیری‌شده تمام دستگاه‌ها را دقیقاً انتخاب کنید؛ تعداد پذیرش قابل تغییر نیست.',
          );
        const units = selected
          .map((item) => {
            const unit = serialUnitSchema.parse(item.unit);
            if (
              item.hasActiveClaim !== false ||
              item.stockVersion !== stock.version ||
              !same(unit.variantId, row.variantId) ||
              unit.state !== 'available' ||
              unit.orderId !== null ||
              unit.reservationId !== null ||
              (stock.trackingMode === 'serial' && unit.serial === null) ||
              (stock.trackingMode === 'imei' && unit.imei1 === null)
            )
              throw new Error(
                'نسخهٔ موجودی یا وضعیت دستگاه انتخابی عوض شده است؛ انتخاب را از فهرست تازه بازبینی کنید.',
              );
            return { unitId: unit.id.toLowerCase(), version: unit.version };
          })
          .sort((a, b) => a.unitId.localeCompare(b.unitId));
        return {
          offerLineId: row.offerLineId,
          stockVersion: stock.version,
          trackingMode: stock.trackingMode,
          units,
        };
      })
      .sort((a, b) => a.offerLineId.localeCompare(b.offerLineId)),
  });
  if (new TextEncoder().encode(JSON.stringify(body)).length > 65536)
    throw new Error('فرمان تخصیص از حد ۶۴ کیلوبایت بیشتر است؛ تخصیص کامل را خودکار تقسیم نکنید.');
  return body;
}
export function allocationCurrentMatches(data: AllocationData, candidate: AllocationCandidate) {
  // Active includes an elapsed hold awaiting the expiry worker. It still has
  // to be the candidate's current resource/version. Terminal resources remain
  // valid history beside no hold or a newer hold of the same acceptance. A
  // terminal ID cannot simultaneously be the candidate's active allocation.
  return (
    (data.state === 'Active'
      ? candidate.allocation?.id === data.id && candidate.allocation.version === data.version
      : candidate.allocation?.id !== data.id) &&
    data.requestId === candidate.requestId &&
    data.taskId === candidate.taskId &&
    data.offerId === candidate.offerId &&
    data.acceptanceId === candidate.acceptanceId &&
    data.lines.length === candidate.lines.length &&
    data.lines.every((line) =>
      candidate.lines.some(
        (row) =>
          row.offerLineId === line.offerLineId &&
          same(row.variantId, line.variantId) &&
          row.quantity === line.quantity,
      ),
    )
  );
}
