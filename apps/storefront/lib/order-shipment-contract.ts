import { z } from './schema-runtime.ts';
const id = z.string().regex(/^[a-f0-9]{32}$/),
  key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  hash = z.string().regex(/^[A-F0-9]{64}$/);
const utc = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
export function shipmentTicks(value: string) {
  utc.parse(value);
  const seconds = Date.parse(value.replace(/\.\d+(?=Z|\+00:00$)/, ''));
  return BigInt(seconds) * 10000n + BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(7, '0'));
}
const text = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
export const shipmentLineSchema = z
  .object({
    lineKey: key,
    variantId: key,
    productId: key,
    sku: text(80, 1),
    name: text(250, 1),
    label: z.string().max(10000),
    warranty: z.string().max(10000),
    quantity: z.number().int().min(1).max(1000000),
    trackingMode: z.enum(['none', 'serial', 'imei']),
  })
  .strict();
export const shipmentUnitSchema = z
  .object({
    unitId: id,
    lineKey: key,
    variantId: key,
    serial: text(100, 1).nullable(),
    imei1: z
      .string()
      .regex(/^\d{15}$/)
      .nullable(),
    imei2: z
      .string()
      .regex(/^\d{15}$/)
      .nullable(),
    warrantyUntil: utc.nullable(),
  })
  .strict()
  .refine((x) => x.serial !== null || x.imei1 !== null);
const lines = z.array(shipmentLineSchema).min(1).max(64),
  units = z.array(shipmentUnitSchema).max(100);
export const shipmentSchema = z
  .object({
    id,
    orderId: id,
    state: z.enum(['packed', 'dispatched', 'delivered']),
    version,
    packingRevision: z.number().int().min(1).max(1000000),
    packedAt: utc,
    dispatchedAt: utc.nullable(),
    deliveredAt: utc.nullable(),
    carrierNameFa: text(120, 1).nullable(),
    carrierNameEn: text(120, 1).nullable(),
    trackingNumber: text(120, 1).nullable(),
    containsDemo: z.boolean(),
    unitDetailsVisible: z.boolean(),
    lines,
    units,
  })
  .strict()
  .superRefine((x, c) => {
    const bad = () => c.addIssue({ code: 'custom', message: 'Shipment history is inconsistent.' });
    if (
      new Set(x.lines.map((l) => l.lineKey)).size !== x.lines.length ||
      new Set(x.units.map((u) => u.unitId)).size !== x.units.length
    )
      bad();
    if (
      x.units.some(
        (u) =>
          !x.lines.some(
            (l) =>
              l.lineKey === u.lineKey &&
              l.variantId.toLowerCase() === u.variantId.toLowerCase() &&
              l.trackingMode !== 'none',
          ),
      )
    )
      bad();
    if (x.unitDetailsVisible) {
      if (
        x.lines.some(
          (l) =>
            x.units.filter((u) => u.lineKey === l.lineKey).length !==
            (l.trackingMode === 'none' ? 0 : l.quantity),
        )
      )
        bad();
    } else if (x.state !== 'packed' || x.units.length !== 0) bad();
    if (x.state === 'packed') {
      if (
        x.dispatchedAt !== null ||
        x.deliveredAt !== null ||
        x.carrierNameFa !== null ||
        x.carrierNameEn !== null ||
        x.trackingNumber !== null
      )
        bad();
    } else if (
      x.dispatchedAt === null ||
      shipmentTicks(x.dispatchedAt) < shipmentTicks(x.packedAt) ||
      x.carrierNameFa === null ||
      x.carrierNameEn === null ||
      (x.state === 'dispatched'
        ? x.deliveredAt !== null
        : x.deliveredAt === null || shipmentTicks(x.deliveredAt) < shipmentTicks(x.dispatchedAt))
    )
      bad();
  });
export const customerShipmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: id,
    shipment: shipmentSchema.nullable(),
    manualCarrierReport: z.boolean(),
  })
  .strict()
  .refine(
    (x) =>
      (x.shipment === null ||
        (x.shipment.orderId === x.orderId &&
          x.shipment.unitDetailsVisible === (x.shipment.state !== 'packed'))) &&
      x.manualCarrierReport ===
        (x.shipment?.state === 'dispatched' || x.shipment?.state === 'delivered'),
  );
export type Shipment = z.infer<typeof shipmentSchema>;
export type CustomerShipment = z.infer<typeof customerShipmentSchema>;
export function readCustomerShipment(value: unknown, orderId: string) {
  const data = customerShipmentSchema.parse(value);
  if (data.orderId !== id.parse(orderId)) throw Error('Shipment does not belong to this order.');
  return data;
}
export const adminShipmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: id,
    ownerId: key,
    orderState: z.enum([
      'AwaitingPayment',
      'Paid',
      'Cancelled',
      'Expired',
      'Fulfilled',
      'CreditApproved',
    ]),
    orderVersion: version,
    containsDemo: z.boolean(),
    shipment: shipmentSchema.nullable(),
    packingLines: lines,
    packingUnits: units,
    canPack: z.boolean(),
    canRepack: z.boolean(),
    canDispatch: z.boolean(),
    canDeliver: z.boolean(),
    blockers: z.array(z.string().regex(/^[a-z_]{1,100}$/)).max(20),
    inventoryFingerprint: hash,
    liveCarrierConfigured: z.literal(false),
  })
  .strict()
  .superRefine((x, c) => {
    const bad = () =>
      c.addIssue({ code: 'custom', message: 'Shipment readiness does not match its order.' });
    if (
      x.shipment &&
      (x.shipment.orderId !== x.orderId ||
        x.shipment.containsDemo !== x.containsDemo ||
        !x.shipment.unitDetailsVisible)
    )
      bad();
    if (
      x.canPack !== (x.blockers.length === 0 && x.shipment === null) ||
      x.canRepack !==
        (x.shipment?.state === 'packed' &&
          x.blockers.includes('packed_inventory_changed') &&
          x.blockers.every((b) => b === 'packed_inventory_changed')) ||
      x.canDispatch !== (x.blockers.length === 0 && x.shipment?.state === 'packed') ||
      x.canDeliver !== (x.blockers.length === 0 && x.shipment?.state === 'dispatched')
    )
      bad();
    if (
      (x.canPack || x.canRepack || x.canDispatch || x.canDeliver) &&
      !['Paid', 'CreditApproved'].includes(x.orderState)
    )
      bad();
    if (
      (x.canPack || x.canRepack || x.canDispatch) &&
      x.packingLines.some(
        (l) =>
          x.packingUnits.filter((u) => u.lineKey === l.lineKey).length !==
          (l.trackingMode === 'none' ? 0 : l.quantity),
      )
    )
      bad();
    if (
      new Set(x.packingLines.map((l) => l.lineKey)).size !== x.packingLines.length ||
      new Set(x.packingUnits.map((u) => u.unitId)).size !== x.packingUnits.length ||
      x.packingUnits.some(
        (u) =>
          !x.packingLines.some(
            (l) =>
              l.lineKey === u.lineKey &&
              l.variantId.toLowerCase() === u.variantId.toLowerCase() &&
              l.trackingMode !== 'none',
          ),
      )
    )
      bad();
  });
export const shipmentInputSchema = z
  .object({
    ownerId: key,
    commandId: id,
    action: z.enum(['pack', 'repack', 'dispatch', 'deliver']),
    orderVersion: version,
    shipmentVersion: version.nullable(),
    inventoryFingerprint: hash,
    reason: text(400, 1)
      .transform((s) => s.trim())
      .refine((s) => s.length > 0),
    acknowledge: z.literal(true),
    carrierNameFa: z.string().trim().min(1).max(120).nullable(),
    carrierNameEn: z.string().trim().min(1).max(120).nullable(),
    trackingNumber: z.string().trim().min(1).max(120).nullable(),
    occurredAt: utc.nullable(),
  })
  .strict()
  .superRefine((x, c) => {
    if (x.action === 'pack' || x.action === 'repack') {
      if (
        (x.action === 'pack' ? x.shipmentVersion !== null : x.shipmentVersion === null) ||
        x.carrierNameFa !== null ||
        x.carrierNameEn !== null ||
        x.trackingNumber !== null ||
        x.occurredAt !== null
      )
        c.addIssue({
          code: 'custom',
          message: 'Confirm only the facts for this packing revision.',
        });
    } else if (
      x.shipmentVersion === null ||
      x.occurredAt === null ||
      (x.action === 'dispatch'
        ? x.carrierNameFa === null || x.carrierNameEn === null
        : x.carrierNameFa !== null || x.carrierNameEn !== null || x.trackingNumber !== null)
    )
      c.addIssue({ code: 'custom', message: 'Confirm only the facts for this shipment stage.' });
  });
export const shipmentResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: id,
    payloadHash: hash,
    orderId: id,
    action: z.enum(['pack', 'repack', 'dispatch', 'deliver']),
    inventoryFingerprint: hash,
    reason: text(400, 1),
    recordedAt: utc,
    orderVersion: version,
    shipment: shipmentSchema,
    replayed: z.boolean(),
  })
  .strict()
  .superRefine((x, c) => {
    if (
      x.shipment.orderId !== x.orderId ||
      !x.shipment.unitDetailsVisible ||
      x.shipment.state !==
        (
          {
            pack: 'packed',
            repack: 'packed',
            dispatch: 'dispatched',
            deliver: 'delivered',
          } as const
        )[x.action] ||
      shipmentTicks(x.recordedAt) < shipmentTicks(x.shipment.packedAt) ||
      (x.shipment.dispatchedAt !== null &&
        shipmentTicks(x.recordedAt) < shipmentTicks(x.shipment.dispatchedAt)) ||
      (x.shipment.deliveredAt !== null &&
        shipmentTicks(x.recordedAt) < shipmentTicks(x.shipment.deliveredAt))
    )
      c.addIssue({ code: 'custom', message: 'Shipment receipt has another stage or time.' });
  });
export type AdminShipment = z.infer<typeof adminShipmentSchema>;
export type ShipmentInput = z.infer<typeof shipmentInputSchema>;
export type ShipmentResult = z.infer<typeof shipmentResultSchema>;
export interface ShipmentCommand {
  orderId: string;
  input: ShipmentInput;
  before: AdminShipment;
}
export function readAdminShipment(value: unknown, owner: string, orderId: string) {
  const data = adminShipmentSchema.parse(value);
  if (data.orderId !== id.parse(orderId) || data.ownerId !== key.parse(owner))
    throw Error('پاسخ ارسال به همین سفارش و مشتری تعلق ندارد.');
  return data;
}
export function readShipmentResult(value: unknown, command: ShipmentCommand) {
  const x = shipmentResultSchema.parse(value),
    input = command.input,
    before = command.before,
    s = x.shipment,
    previous = before.shipment;
  if (
    command.orderId !== before.orderId ||
    input.ownerId !== before.ownerId ||
    x.orderId !== command.orderId ||
    s.containsDemo !== before.containsDemo ||
    x.commandId !== input.commandId ||
    x.action !== input.action ||
    x.reason !== input.reason ||
    x.inventoryFingerprint !== input.inventoryFingerprint ||
    input.inventoryFingerprint !== before.inventoryFingerprint ||
    input.orderVersion !== before.orderVersion ||
    input.shipmentVersion !== (previous?.version ?? null)
  )
    throw Error('رسید به همان فرمان و بازبینی ارسال تعلق ندارد.');
  if (
    JSON.stringify(s.lines) !==
      JSON.stringify(
        input.action === 'pack' || input.action === 'repack'
          ? before.packingLines
          : previous?.lines,
      ) ||
    JSON.stringify(s.units) !==
      JSON.stringify(
        input.action === 'pack' || input.action === 'repack'
          ? before.packingUnits
          : previous?.units,
      )
  )
    throw Error('اقلام یا دستگاه‌های رسید با بستهٔ بازبینی‌شده یکسان نیستند.');
  if (
    !(
      {
        pack: before.canPack,
        repack: before.canRepack,
        dispatch: before.canDispatch,
        deliver: before.canDeliver,
      } as const
    )[input.action]
  )
    throw Error('این مرحله در بازبینی ثبت‌شده مجاز نبود.');
  if (input.action === 'pack' || input.action === 'repack') {
    if (
      shipmentTicks(s.packedAt) !== shipmentTicks(x.recordedAt) ||
      (input.action === 'pack'
        ? s.packingRevision !== 1
        : !previous ||
          s.id !== previous.id ||
          s.version === previous.version ||
          s.packingRevision !== previous.packingRevision + 1)
    )
      throw Error('نسخه یا زمان آماده‌سازی معتبر نیست.');
  } else if (
    !previous ||
    s.id !== previous.id ||
    s.version === previous.version ||
    s.packingRevision !== previous.packingRevision ||
    shipmentTicks(s.packedAt) !== shipmentTicks(previous.packedAt) ||
    shipmentTicks((input.action === 'dispatch' ? s.dispatchedAt : s.deliveredAt)!) !==
      shipmentTicks(input.occurredAt!)
  )
    throw Error('رسید، همان بسته و زمان تأییدشده را حفظ نکرده است.');
  if (
    input.action === 'dispatch'
      ? s.carrierNameFa !== input.carrierNameFa ||
        s.carrierNameEn !== input.carrierNameEn ||
        s.trackingNumber !== input.trackingNumber
      : input.action === 'deliver' &&
        (s.carrierNameFa !== previous?.carrierNameFa ||
          s.carrierNameEn !== previous?.carrierNameEn ||
          s.trackingNumber !== previous?.trackingNumber ||
          shipmentTicks(s.dispatchedAt!) !== shipmentTicks(previous!.dispatchedAt!))
  )
    throw Error('اطلاعات گزارش دستی حمل در رسید تغییر کرده است.');
  return x;
}
