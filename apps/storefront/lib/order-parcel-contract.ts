import { z } from './schema-runtime.ts';
import {
  shipmentLineSchema,
  shipmentUnitSchema,
  customerShipmentSchema,
  shipmentTicks,
} from './order-shipment-contract.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((v) => !/^0+$/.test(v));
const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  hash = z.string().regex(/^[A-F0-9]{64}$/);
const utc = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
    .refine((s) => s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s));
const number = z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((s) => BigInt(s) <= 9223372036854775807n),
  qty = z.number().int().min(1).max(1000000),
  count = z.number().int().min(0).max(1000000);
const line = shipmentLineSchema.extend({
    label: z.string().max(524288),
    warranty: z.string().max(524288),
  }),
  refs = z
    .array(z.strictObject({ lineKey: key, quantity: qty }))
    .min(1)
    .max(64);
export const parcelSummarySchema = z
  .strictObject({
    id,
    number,
    reference: text(120),
    state: z.enum(['packed', 'void', 'dispatched', 'delivered']),
    version,
    packingRevision: z.number().int().min(1).max(1000000),
    packedAt: utc,
    dispatchedAt: utc.nullable(),
    deliveredAt: utc.nullable(),
    voidedAt: utc.nullable(),
    carrierNameFa: text(120).nullable(),
    carrierNameEn: text(120).nullable(),
    trackingNumber: text(120).nullable(),
    lines: refs,
  })
  .refine((p) => {
    if (new Set(p.lines.map((l) => l.lineKey)).size !== p.lines.length) return false;
    if (p.state === 'packed' || p.state === 'void')
      return (
        p.dispatchedAt === null &&
        p.deliveredAt === null &&
        p.carrierNameFa === null &&
        p.carrierNameEn === null &&
        p.trackingNumber === null &&
        (p.state === 'void'
          ? p.voidedAt !== null && shipmentTicks(p.voidedAt) >= shipmentTicks(p.packedAt)
          : p.voidedAt === null)
      );
    return (
      p.voidedAt === null &&
      p.dispatchedAt !== null &&
      shipmentTicks(p.dispatchedAt) >= shipmentTicks(p.packedAt) &&
      p.carrierNameFa !== null &&
      p.carrierNameEn !== null &&
      (p.state === 'delivered'
        ? p.deliveredAt !== null && shipmentTicks(p.deliveredAt) >= shipmentTicks(p.dispatchedAt)
        : p.deliveredAt === null)
    );
  });
export const parcelDetailSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    parcel: parcelSummarySchema,
    containsDemo: z.boolean(),
    unitDetailsVisible: z.boolean(),
    lines: z.array(line).min(1).max(64),
    units: z.array(shipmentUnitSchema).max(100),
  })
  .refine((d) => {
    if (
      new Set(d.lines.map((l) => l.lineKey)).size !== d.lines.length ||
      new Set(d.units.map((u) => u.unitId)).size !== d.units.length ||
      d.parcel.lines.length !== d.lines.length ||
      d.lines.some(
        (l) => !d.parcel.lines.some((r) => r.lineKey === l.lineKey && r.quantity === l.quantity),
      )
    )
      return false;
    if (!d.unitDetailsVisible)
      return ['packed', 'void'].includes(d.parcel.state) && d.units.length === 0;
    return (
      d.units.every((u) =>
        d.lines.some(
          (l) =>
            l.lineKey === u.lineKey &&
            l.variantId.toLowerCase() === u.variantId.toLowerCase() &&
            l.trackingMode !== 'none',
        ),
      ) &&
      d.lines.every(
        (l) =>
          d.units.filter((u) => u.lineKey === l.lineKey).length ===
          (l.trackingMode === 'none' ? 0 : l.quantity),
      )
    );
  });
const inventoryUnit = z
  .strictObject({
    id,
    lineKey: key,
    variantId: key,
    version,
    state: z.literal('assigned'),
    serial: z.string().min(1).max(100).nullable(),
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
  .refine((u) => u.serial !== null || u.imei1 !== null);
const balance = z
  .strictObject({
    lineKey: key,
    variantId: key,
    ordered: qty,
    packed: count,
    dispatched: count,
    delivered: count,
    remaining: count,
  })
  .refine(
    (l) =>
      l.remaining === l.ordered - l.dispatched &&
      l.delivered <= l.dispatched &&
      l.packed <= l.remaining,
  );
export const parcelPageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    ownerId: key,
    orderState: z.enum([
      'AwaitingPayment',
      'Paid',
      'CreditApproved',
      'Expired',
      'Cancelled',
      'Fulfilled',
    ]),
    orderVersion: version,
    mode: z.enum(['none', 'parcels']),
    containsDemo: z.boolean(),
    inventoryFingerprint: hash,
    dispatchCount: z.number().int().min(0).max(64),
    activeParcelCount: z.number().int().min(0).max(64),
    lines: z.array(balance).min(1).max(64),
    orderLines: z.array(line).min(1).max(64),
    availableUnits: z.array(inventoryUnit).max(100),
    packedUnits: z.array(z.strictObject({ parcelId: id, unit: inventoryUnit })).max(100),
    parcels: z.array(parcelSummarySchema).max(20),
    nextAfter: number.nullable(),
    canPack: z.boolean(),
    creditAuthorized: z.boolean(),
    blockers: z.array(z.string().regex(/^[a-z_]{1,100}$/)).max(20),
  })
  .refine((p) => {
    const all = [...p.availableUnits, ...p.packedUnits.map((x) => x.unit)];
    return (
      new Set(p.lines.map((x) => x.lineKey)).size === p.lines.length &&
      p.orderLines.length === p.lines.length &&
      p.orderLines.every((x) =>
        p.lines.some(
          (l) =>
            l.lineKey === x.lineKey &&
            l.variantId.toLowerCase() === x.variantId.toLowerCase() &&
            l.ordered === x.quantity,
        ),
      ) &&
      all.length <= 100 &&
      new Set(all.map((u) => u.id)).size === all.length &&
      all.every((u) =>
        p.orderLines.some(
          (l) =>
            l.lineKey === u.lineKey &&
            l.variantId.toLowerCase() === u.variantId.toLowerCase() &&
            l.trackingMode !== 'none',
        ),
      ) &&
      p.dispatchCount <= p.activeParcelCount &&
      p.dispatchCount <= p.lines.reduce((n, l) => n + l.dispatched, 0) &&
      (p.dispatchCount === 0) === p.lines.every((l) => l.dispatched === 0) &&
      p.activeParcelCount - p.dispatchCount <= p.lines.reduce((n, l) => n + l.packed, 0) &&
      (p.activeParcelCount === p.dispatchCount) === p.lines.every((l) => l.packed === 0) &&
      p.parcels.every(
        (x, i) =>
          x.lines.every((r) =>
            p.lines.some((l) => r.lineKey === l.lineKey && r.quantity <= l.ordered),
          ) &&
          (i === 0 || BigInt(x.number) > BigInt(p.parcels[i - 1].number)),
      ) &&
      new Set(p.parcels.map((x) => x.id)).size === p.parcels.length &&
      (p.mode === 'parcels' ||
        (p.parcels.length === 0 &&
          p.packedUnits.length === 0 &&
          p.activeParcelCount === 0 &&
          p.dispatchCount === 0)) &&
      (p.nextAfter === null || (p.parcels.length === 20 && p.nextAfter === p.parcels[19].number)) &&
      (!p.canPack ||
        (p.activeParcelCount < 64 &&
          p.blockers.length === 0 &&
          p.creditAuthorized &&
          p.lines.some((x) => x.remaining > x.packed)))
    );
  });
export const customerFulfillmentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    mode: z.enum(['none', 'single', 'parcels']),
    single: customerShipmentSchema.nullable(),
    parcels: z.array(parcelSummarySchema).max(20),
    nextAfter: number.nullable(),
    manualCarrierReport: z.boolean(),
  })
  .refine((p) =>
    p.mode === 'parcels'
      ? p.single === null &&
        p.parcels.every((x, i) => i === 0 || BigInt(x.number) > BigInt(p.parcels[i - 1].number)) &&
        new Set(p.parcels.map((x) => x.id)).size === p.parcels.length &&
        (p.nextAfter === null ||
          (p.parcels.length === 20 && p.nextAfter === p.parcels[19].number)) &&
        p.manualCarrierReport ===
          p.parcels.some((x) => ['dispatched', 'delivered'].includes(x.state))
      : p.single !== null &&
        p.single.orderId === p.orderId &&
        p.parcels.length === 0 &&
        p.nextAfter === null &&
        p.manualCarrierReport === p.single.manualCarrierReport &&
        (p.mode === 'none' ? p.single.shipment === null : p.single.shipment !== null),
  );
const selection = z.strictObject({ lineKey: key, quantity: qty, unitIds: z.array(id).max(100) });
export const parcelInputSchema = z
  .strictObject({
    ownerId: key,
    commandId: id,
    action: z.enum(['pack', 'repack', 'void', 'dispatch', 'deliver']),
    orderVersion: version,
    parcelId: id.nullable(),
    parcelVersion: version.nullable(),
    inventoryFingerprint: hash,
    reason: text(400),
    acknowledge: z.literal(true),
    reference: text(120).nullable(),
    lines: z.array(selection).max(64),
    carrierNameFa: text(120).nullable(),
    carrierNameEn: text(120).nullable(),
    trackingNumber: text(120).nullable(),
    occurredAt: utc.nullable(),
  })
  .refine((x) => {
    if (
      x.action === 'pack'
        ? x.parcelId !== null || x.parcelVersion !== null || x.reference === null
        : x.parcelId === null || x.parcelVersion === null || x.reference !== null
    )
      return false;
    const ids = x.lines.flatMap((l) => l.unitIds);
    if (
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      new Set(x.lines.map((l) => l.lineKey.toUpperCase())).size !== x.lines.length
    )
      return false;
    if (x.action === 'pack' || x.action === 'repack')
      return (
        x.lines.length > 0 &&
        x.carrierNameFa === null &&
        x.carrierNameEn === null &&
        x.trackingNumber === null &&
        x.occurredAt === null
      );
    if (x.lines.length !== 0) return false;
    if (x.action === 'void')
      return (
        x.carrierNameFa === null &&
        x.carrierNameEn === null &&
        x.trackingNumber === null &&
        x.occurredAt === null
      );
    return (
      x.occurredAt !== null &&
      (x.action === 'dispatch'
        ? x.carrierNameFa !== null && x.carrierNameEn !== null
        : x.carrierNameFa === null && x.carrierNameEn === null && x.trackingNumber === null)
    );
  })
  .transform((x) => ({
    ...x,
    lines: x.lines
      .map((l) => ({ ...l, unitIds: [...l.unitIds].sort() }))
      .sort((a, b) => (a.lineKey < b.lineKey ? -1 : a.lineKey > b.lineKey ? 1 : 0)),
  }));
export const parcelCommandSchema = z
  .strictObject({
    orderId: id,
    input: parcelInputSchema,
    before: parcelPageSchema,
    previous: parcelDetailSchema.nullable(),
  })
  .refine((c) => {
    const x = c.input,
      p = c.before,
      old = c.previous;
    if (
      c.orderId !== p.orderId ||
      x.ownerId !== p.ownerId ||
      x.orderVersion !== p.orderVersion ||
      x.inventoryFingerprint !== p.inventoryFingerprint ||
      !['Paid', 'CreditApproved'].includes(p.orderState)
    )
      return false;
    if (
      x.action === 'pack'
        ? !p.canPack || old !== null
        : old === null ||
          old.orderId !== p.orderId ||
          old.containsDemo !== p.containsDemo ||
          !old.unitDetailsVisible ||
          old.parcel.id !== x.parcelId ||
          old.parcel.version !== x.parcelVersion
    )
      return false;
    if (
      x.action !== 'pack' &&
      old?.parcel.state !== (x.action === 'deliver' ? 'dispatched' : 'packed')
    )
      return false;
    if (['pack', 'repack', 'dispatch'].includes(x.action) && !p.creditAuthorized) return false;
    if (x.action === 'pack' || x.action === 'repack') {
      const available = [
        ...p.availableUnits,
        ...p.packedUnits.filter((u) => u.parcelId === x.parcelId).map((u) => u.unit),
      ];
      if (
        p.dispatchCount === 63 &&
        p.lines.some(
          (l) =>
            l.remaining !==
            x.lines.filter((s) => s.lineKey === l.lineKey).reduce((n, s) => n + s.quantity, 0),
        )
      )
        return false;
      return x.lines.every((l) => {
        const src = p.orderLines.find((s) => s.lineKey === l.lineKey),
          b = p.lines.find((s) => s.lineKey === l.lineKey),
          own = old?.lines.find((s) => s.lineKey === l.lineKey)?.quantity ?? 0;
        return (
          src !== undefined &&
          b !== undefined &&
          l.quantity <= b.remaining - b.packed + own &&
          l.unitIds.length === (src.trackingMode === 'none' ? 0 : l.quantity) &&
          l.unitIds.every((u) => available.some((a) => a.id === u && a.lineKey === l.lineKey))
        );
      });
    }
    return true;
  });
export const parcelResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: id,
    payloadHash: hash,
    orderId: id,
    action: z.enum(['pack', 'repack', 'void', 'dispatch', 'deliver']),
    inventoryFingerprint: hash,
    reason: text(400),
    recordedAt: utc,
    orderVersion: version,
    detail: parcelDetailSchema,
    replayed: z.boolean(),
  })
  .refine(
    (r) =>
      r.detail.orderId === r.orderId &&
      r.detail.unitDetailsVisible &&
      r.detail.parcel.state ===
        (
          {
            pack: 'packed',
            repack: 'packed',
            void: 'void',
            dispatch: 'dispatched',
            deliver: 'delivered',
          } as const
        )[r.action] &&
      [
        r.detail.parcel.packedAt,
        r.detail.parcel.dispatchedAt,
        r.detail.parcel.deliveredAt,
        r.detail.parcel.voidedAt,
      ].every((t) => t === null || shipmentTicks(t) <= shipmentTicks(r.recordedAt)),
  );
export type ParcelPage = z.infer<typeof parcelPageSchema>;
export type ParcelDetail = z.infer<typeof parcelDetailSchema>;
export type ParcelSummary = z.infer<typeof parcelSummarySchema>;
export type ParcelInput = z.infer<typeof parcelInputSchema>;
export type ParcelCommand = z.infer<typeof parcelCommandSchema>;
export type ParcelResult = z.infer<typeof parcelResultSchema>;
export type CustomerFulfillment = z.infer<typeof customerFulfillmentSchema>;
export function parcelBase(ownerId: string, orderId: string) {
  return '/admin/orders/' + key.parse(ownerId) + '/' + id.parse(orderId) + '/fulfillment';
}
export function customerFulfillmentPath(orderId: string, parcelId?: string, after?: string) {
  if (parcelId && after) throw Error('Select a detail or a page');
  return (
    '/api/orders/v2/' +
    id.parse(orderId) +
    '/fulfillment' +
    (parcelId ? '/parcels/' + id.parse(parcelId) : after ? '?after=' + number.parse(after) : '')
  );
}
export function readParcelPage(raw: unknown, owner: string, order: string) {
  const p = parcelPageSchema.parse(raw);
  if (p.ownerId.toUpperCase() !== key.parse(owner).toUpperCase() || p.orderId !== id.parse(order))
    throw Error('Unrelated parcel page');
  return p;
}
export function readParcelDetail(raw: unknown, order: string, parcel: string, customer = false) {
  const d = parcelDetailSchema.parse(raw);
  if (
    d.orderId !== id.parse(order) ||
    d.parcel.id !== id.parse(parcel) ||
    (customer && d.unitDetailsVisible !== ['dispatched', 'delivered'].includes(d.parcel.state))
  )
    throw Error('Unrelated private parcel detail');
  return d;
}
export function readCustomerFulfillment(raw: unknown, order: string) {
  const p = customerFulfillmentSchema.parse(raw);
  if (p.orderId !== id.parse(order)) throw Error('Unrelated customer fulfillment');
  return p;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function readParcelResult(raw: unknown, command: ParcelCommand) {
  const c = parcelCommandSchema.parse(command),
    r = parcelResultSchema.parse(raw),
    x = c.input,
    p = c.before,
    d = r.detail,
    s = d.parcel,
    old = c.previous;
  if (
    r.commandId !== x.commandId ||
    r.orderId !== c.orderId ||
    r.action !== x.action ||
    r.inventoryFingerprint !== x.inventoryFingerprint ||
    r.reason !== x.reason ||
    d.containsDemo !== p.containsDemo ||
    r.orderVersion === p.orderVersion
  )
    throw Error('Unrelated parcel receipt');
  if (x.action === 'pack' || x.action === 'repack') {
    const expected = x.lines.map((l) => ({
      ...p.orderLines.find((s) => s.lineKey === l.lineKey)!,
      quantity: l.quantity,
    }));
    if (!same(d.lines, expected) || shipmentTicks(s.packedAt) !== shipmentTicks(r.recordedAt))
      throw Error('Different packed lines or time');
    const available = [
      ...p.availableUnits,
      ...p.packedUnits.filter((u) => u.parcelId === x.parcelId).map((u) => u.unit),
    ];
    const expectedUnits = x.lines
      .flatMap((l) => l.unitIds.map((id) => available.find((u) => u.id === id)!))
      .map((u) => ({
        unitId: u.id,
        lineKey: u.lineKey,
        variantId: u.variantId,
        serial: u.serial,
        imei1: u.imei1,
        imei2: u.imei2,
        warrantyUntil: u.warrantyUntil,
      }))
      .sort((a, b) => (a.unitId < b.unitId ? -1 : 1));
    if (
      !same(d.units, expectedUnits) ||
      (x.action === 'pack' && s.packingRevision !== 1) ||
      (x.action === 'repack' && (!old || s.packingRevision !== old.parcel.packingRevision + 1))
    )
      throw Error('Different packed devices or revision');
  } else if (
    !old ||
    !same(d.lines, old.lines) ||
    !same(d.units, old.units) ||
    s.packingRevision !== old.parcel.packingRevision ||
    s.packedAt !== old.parcel.packedAt
  )
    throw Error('Changed immutable packing snapshot');
  if (
    old &&
    (s.id !== old.parcel.id ||
      s.reference !== old.parcel.reference ||
      s.number !== old.parcel.number ||
      s.version === old.parcel.version)
  )
    throw Error('Changed parcel identity');
  if (x.action === 'pack' && s.reference !== x.reference) throw Error('Changed parcel reference');
  if (x.action === 'void' && s.voidedAt !== r.recordedAt) throw Error('Changed void time');
  if (
    x.action === 'dispatch' &&
    (shipmentTicks(s.dispatchedAt!) !== shipmentTicks(x.occurredAt!) ||
      s.carrierNameFa !== x.carrierNameFa ||
      s.carrierNameEn !== x.carrierNameEn ||
      s.trackingNumber !== x.trackingNumber)
  )
    throw Error('Changed hand-off facts');
  if (
    x.action === 'deliver' &&
    (shipmentTicks(s.deliveredAt!) !== shipmentTicks(x.occurredAt!) ||
      s.dispatchedAt !== old?.parcel.dispatchedAt ||
      s.carrierNameFa !== old?.parcel.carrierNameFa ||
      s.carrierNameEn !== old?.parcel.carrierNameEn ||
      s.trackingNumber !== old?.parcel.trackingNumber)
  )
    throw Error('Changed delivery facts');
  return r;
}
export function isCustomerFulfillmentPath(path: string, method = 'GET') {
  if (method !== 'GET' || /[\s%\\#]/.test(path)) return false;
  const match = path.match(
    /^\/api\/orders\/(?:v2\/)?([a-f0-9]{32})\/fulfillment(?:\/parcels\/([a-f0-9]{32})|\?after=([1-9][0-9]{0,18}))?$/,
  );
  return (
    !!match &&
    !/^0+$/.test(match[1]) &&
    (!match[2] || !/^0+$/.test(match[2])) &&
    (!match[3] || BigInt(match[3]) <= 9223372036854775807n)
  );
}
