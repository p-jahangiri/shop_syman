import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const unitId = z
  .string()
  .regex(/^[0-9a-f]{32}$/i)
  .refine((v) => !/^0+$/.test(v));
const version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
const position = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const timestamp = z.iso.datetime({ offset: true });
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
export const serialModeSchema = z.enum(['none', 'serial', 'imei']);
export const serialStateSchema = z.enum(['available', 'assigned', 'delivered', 'retired']);
export type SerialMode = z.infer<typeof serialModeSchema>;
export type SerialState = z.infer<typeof serialStateSchema>;
export const modeLabels: Record<SerialMode, string> = {
  none: 'بدون رهگیری',
  serial: 'سریال',
  imei: 'IMEI',
};
export const stateLabels: Record<SerialState, string> = {
  available: 'موجود',
  assigned: 'تخصیص‌یافته',
  delivered: 'تحویل‌شده',
  retired: 'خارج‌شده',
};
const canonical = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    );
// eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
const controls = /[\u0000-\u001f\u007f-\u009f]/;
export function imeiValid(value: string) {
  if (!/^\d{15}$/.test(value) || /^0+$/.test(value)) return false;
  return (
    [...value].reduce((sum, c, i) => {
      let n = Number(c);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      return sum + n;
    }, 0) %
      10 ===
    0
  );
}
const serial = z.string().regex(/^[A-Z0-9._/-]{1,100}$/);
const imei = z.string().refine(imeiValid);
const unitInputSchema = z
  .object({ serial: serial.nullable(), imei1: imei.nullable(), imei2: imei.nullable() })
  .strict()
  .refine(
    (u) =>
      (u.serial !== null || u.imei1 !== null) &&
      (u.imei2 === null || (u.imei1 !== null && u.imei2 !== u.imei1)),
  );
type UnitInput = z.infer<typeof unitInputSchema>;
function aliases(u: UnitInput) {
  return [
    u.serial === null ? null : 'S:' + u.serial,
    u.imei1 === null ? null : 'I:' + u.imei1,
    u.imei2 === null ? null : 'I:' + u.imei2,
  ].filter((v): v is string => v !== null);
}
function uniqueAliases(units: UnitInput[]) {
  const values = units.flatMap(aliases);
  return new Set(values).size === values.length;
}
export const serialStockSchema = z
  .object({
    variantId: identifier,
    mode: serialModeSchema,
    onHand: z.number().int().min(0).max(2147483647),
    reserved: z.number().int().min(0).max(2147483647),
    version: version.nullable(),
  })
  .strict()
  .refine(
    (s) =>
      s.reserved <= s.onHand &&
      (s.version !== null || (s.mode === 'none' && s.onHand === 0 && s.reserved === 0)),
  );
export const serialUnitSchema = z
  .object({
    id: unitId,
    variantId: identifier,
    serial: serial.nullable(),
    imei1: imei.nullable(),
    imei2: imei.nullable(),
    state: serialStateSchema,
    orderId: unitId.nullable(),
    reservationId: unitId.nullable(),
    warrantyUntil: timestamp.nullable(),
    createdAt: timestamp,
    changedAt: timestamp,
    version,
  })
  .strict()
  .refine(
    (u) =>
      unitInputSchema.safeParse({ serial: u.serial, imei1: u.imei1, imei2: u.imei2 }).success &&
      Date.parse(u.changedAt) >= Date.parse(u.createdAt) &&
      (u.state === 'available' || u.state === 'retired'
        ? u.orderId === null && u.reservationId === null && u.warrantyUntil === null
        : u.orderId !== null && u.reservationId !== null),
  );
export type SerialUnit = z.infer<typeof serialUnitSchema>;
export type SerialStock = z.infer<typeof serialStockSchema>;
const related = (units: SerialUnit[], stock: SerialStock) =>
  (stock.version !== null || units.length === 0) &&
  units.every(
    (u) =>
      u.variantId.toLowerCase() === stock.variantId.toLowerCase() &&
      (!(u.state === 'available' || u.state === 'assigned') ||
        (stock.mode === 'serial' && u.serial !== null) ||
        (stock.mode === 'imei' && u.imei1 !== null)),
  ) &&
  new Set(units.map((u) => u.id.toLowerCase())).size === units.length &&
  uniqueAliases(units) &&
  units.filter((u) => u.state === 'available' || u.state === 'assigned').length <= stock.onHand &&
  units.filter((u) => u.state === 'assigned').length <= stock.reserved;
export const serialPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    stock: serialStockSchema,
    items: z.array(serialUnitSchema).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (p) =>
      (p.nextCursor === null || p.items.length === 50) &&
      related(p.items, p.stock) &&
      p.items.every((u, i) => i === 0 || p.items[i - 1].id.toLowerCase() < u.id.toLowerCase()),
  );
export const serialCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    stock: serialStockSchema,
    units: z.array(serialUnitSchema).max(100),
  })
  .strict()
  .refine((p) => p.stock.version !== null && related(p.units, p.stock));
export const serialFiltersSchema = z
  .object({
    state: z.enum(['all', 'available', 'assigned', 'delivered', 'retired']),
    query: z
      .string()
      .max(200)
      .refine((v) => !controls.test(v))
      .transform(canonical)
      .pipe(z.string().regex(/^[A-Z0-9._/-]{0,100}$/)),
  })
  .strict();
export type SerialFilters = z.infer<typeof serialFiltersSchema>;
export const emptySerialFilters: SerialFilters = { state: 'all', query: '' };
const base = (id: string) =>
  '/admin/inventory/variants/' + encodeURIComponent(identifier.parse(id));
export function serialPath(id: string, filters: SerialFilters, after: string | null) {
  const checked = serialFiltersSchema.parse(filters);
  const q = new URLSearchParams(checked);
  if (after !== null) q.set('cursor', cursor.parse(after));
  return base(id) + '/serials?' + q;
}
export function readSerialPage(
  raw: unknown,
  id: string,
  filters: SerialFilters,
  after: string | null = null,
) {
  const p = serialPageSchema.parse(raw);
  const f = serialFiltersSchema.parse(filters);
  if (
    p.stock.variantId.toLowerCase() !== id.toLowerCase() ||
    (after !== null && p.nextCursor === after) ||
    p.items.some(
      (u) =>
        (f.state !== 'all' && u.state !== f.state) ||
        (f.query !== '' && ![u.serial, u.imei1, u.imei2].some((v) => v?.startsWith(f.query))),
    )
  )
    throw new Error('پاسخ سریال با تنوع و فیلتر انتخاب‌شده یکسان نیست.');
  return p;
}
const historyEntry = z
  .object({
    id: position,
    unitId,
    state: serialStateSchema,
    actorId: identifier,
    reason: z.string().max(500),
    orderId: unitId.nullable(),
    at: timestamp,
  })
  .strict();
export const serialHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(historyEntry).max(50),
    nextBefore: position.nullable(),
  })
  .strict()
  .refine(
    (p) =>
      (p.nextBefore === null || (p.items.length === 50 && p.nextBefore === p.items.at(-1)!.id)) &&
      p.items.every((e, i) => i === 0 || BigInt(p.items[i - 1].id) > BigInt(e.id)),
  );
export function serialHistoryPath(variant: string, id: string, before: string | null) {
  return (
    base(variant) +
    '/serials/' +
    unitId.parse(id) +
    '/history' +
    (before === null ? '' : '?before=' + position.parse(before))
  );
}
export function readSerialHistory(raw: unknown, id: string, before: string | null) {
  const p = serialHistorySchema.parse(raw);
  if (
    p.items.some(
      (e) =>
        e.unitId.toLowerCase() !== id.toLowerCase() ||
        (before !== null && BigInt(e.id) >= BigInt(position.parse(before))),
    )
  )
    throw new Error('تاریخچهٔ واحد دریافت‌شده معتبر نیست.');
  return p;
}
const reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) => !controls.test(v));
const requestId = z.uuid();
const modeInput = z
  .object({ mode: serialModeSchema, version: version.nullable(), requestId })
  .strict();
const receiptInput = z
  .object({
    units: z.array(unitInputSchema).min(1).max(100).refine(uniqueAliases),
    reason,
    version,
    requestId,
  })
  .strict();
const retireInput = z.object({ unitVersion: version, reason, version, requestId }).strict();
export type SerialAttempt =
  | {
      kind: 'mode';
      path: string;
      method: 'PUT';
      body: z.infer<typeof modeInput>;
      stock: SerialStock;
    }
  | {
      kind: 'receipt';
      path: string;
      method: 'POST';
      body: z.infer<typeof receiptInput>;
      stock: SerialStock;
    }
  | {
      kind: 'retire';
      path: string;
      method: 'POST';
      body: z.infer<typeof retireInput>;
      stock: SerialStock;
      unit: SerialUnit;
    };
export function parseReceipt(text: string, mode: SerialMode): UnitInput[] {
  if (text.length > 50000 || mode === 'none')
    throw new Error('برای دریافت واحد، ابتدا روش رهگیری را انتخاب کنید.');
  const lines = text.split(/\r?\n/).filter((v) => v.trim() !== '');
  if (lines.length < 1 || lines.length > 100)
    throw new Error('هر خط یک دستگاه است؛ بین ۱ تا ۱۰۰ دستگاه وارد کنید.');
  const rows = lines.map((line) => {
    const parts = mode === 'serial' ? [line] : line.split(',');
    if (parts.length > 3 || controls.test(line)) throw new Error('قالب هر خط را بررسی کنید.');
    const optional = (v: string | undefined) => (v?.trim() ? canonical(v) : null);
    return unitInputSchema.parse(
      mode === 'serial'
        ? { serial: optional(line), imei1: null, imei2: null }
        : { serial: optional(parts[2]), imei1: optional(parts[0]), imei2: optional(parts[1]) },
    );
  });
  if (!uniqueAliases(rows)) throw new Error('شناسهٔ تکراری در دستگاه‌های این دریافت وجود دارد.');
  return rows;
}
function snapshot(stock: SerialStock) {
  return serialStockSchema.parse(stock);
}
export function modeAttempt(stock: SerialStock, mode: SerialMode, id: string): SerialAttempt {
  const s = snapshot(stock);
  if (s.onHand !== 0 || s.reserved !== 0 || s.mode === mode)
    throw new Error('تغییر روش به ماندهٔ خالی، بدون رزرو و انتخاب روش تازه نیاز دارد.');
  return {
    kind: 'mode',
    path: base(s.variantId) + '/serial-mode',
    method: 'PUT',
    body: modeInput.parse({ mode, version: s.version, requestId: id }),
    stock: s,
  };
}
export function receiptAttempt(
  stock: SerialStock,
  text: string,
  why: string,
  id: string,
): SerialAttempt {
  const s = snapshot(stock);
  const units = parseReceipt(text, s.mode);
  return {
    kind: 'receipt',
    path: base(s.variantId) + '/serials',
    method: 'POST',
    body: receiptInput.parse({ units, reason: why, version: s.version, requestId: id }),
    stock: s,
  };
}
export function retireAttempt(
  stock: SerialStock,
  unit: SerialUnit,
  why: string,
  id: string,
): SerialAttempt {
  const s = snapshot(stock);
  const u = serialUnitSchema.parse(unit);
  if (
    s.mode === 'none' ||
    u.state !== 'available' ||
    u.variantId.toLowerCase() !== s.variantId.toLowerCase() ||
    s.onHand - s.reserved < 1
  )
    throw new Error('خروج فقط برای واحد موجود با ماندهٔ آزاد مجاز است.');
  return {
    kind: 'retire',
    path: base(s.variantId) + '/serials/' + u.id + '/retire',
    method: 'POST',
    body: retireInput.parse({
      unitVersion: u.version,
      reason: why,
      version: s.version,
      requestId: id,
    }),
    stock: s,
    unit: u,
  };
}
export function readSerialCommand(raw: unknown, attempt: SerialAttempt) {
  const value = serialCommandSchema.parse(raw);
  const stock = attempt.stock;
  let valid =
    value.stock.variantId.toLowerCase() === stock.variantId.toLowerCase() &&
    value.stock.reserved === stock.reserved &&
    value.stock.version !== stock.version;
  if (attempt.kind === 'mode')
    valid &&=
      value.units.length === 0 &&
      value.stock.mode === attempt.body.mode &&
      value.stock.onHand === stock.onHand;
  else if (attempt.kind === 'receipt') {
    const key = (u: UnitInput) => JSON.stringify([u.serial, u.imei1, u.imei2]);
    valid &&=
      value.stock.mode === stock.mode &&
      value.stock.onHand === stock.onHand + attempt.body.units.length &&
      value.units.length === attempt.body.units.length &&
      value.units.every((u) => u.state === 'available') &&
      JSON.stringify(value.units.map(key).sort()) ===
        JSON.stringify(attempt.body.units.map(key).sort());
  } else
    valid &&=
      value.stock.mode === stock.mode &&
      value.stock.onHand === stock.onHand - 1 &&
      value.units.length === 1 &&
      value.units[0].id.toLowerCase() === attempt.unit.id.toLowerCase() &&
      value.units[0].version !== attempt.unit.version &&
      value.units[0].state === 'retired' &&
      JSON.stringify(aliases(value.units[0])) === JSON.stringify(aliases(attempt.unit));
  if (!valid)
    throw new Error(
      'پاسخ ثبت با درخواست یکسان نیست؛ نتیجه را نامشخص در نظر بگیرید و فقط همان درخواست را دوباره ارسال کنید.',
    );
  return value;
}
