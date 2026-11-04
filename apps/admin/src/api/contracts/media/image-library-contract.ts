import { z } from 'zod';
import { readUploadedImage } from './media-contract.ts';

const assetId = z.string().regex(/^[a-f0-9]{32}$/);
const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/);
const utc = z.iso
  .datetime()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/)
  .refine((v) => !v.startsWith('0000'));
const wireUtc = utc.refine((v) => /\.\d{7}Z$/.test(v));
function timeKey(value: string) {
  const [seconds, fraction = ''] = value.slice(0, -1).split('.');
  return seconds + '.' + fraction.padEnd(7, '0');
}
export const imageLibraryFiltersSchema = z
  .object({
    q: z
      .string()
      .regex(/^[a-f0-9]{4,32}$/)
      .nullable(),
    fromAt: utc.nullable(),
    toAt: utc.nullable(),
  })
  .strict()
  .refine((f) => !f.fromAt || !f.toAt || timeKey(f.fromAt) <= timeKey(f.toAt));
export type ImageLibraryFilters = z.infer<typeof imageLibraryFiltersSchema>;
export const emptyImageLibraryFilters: ImageLibraryFilters = { q: null, fromAt: null, toAt: null };
const variant = z
  .object({
    name: z.enum(['thumb', 'card', 'zoom']),
    url: z.string(),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    bytes: z.number().int().min(1).max(8388608),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const imageLibraryItemSchema = z
  .object({
    id: assetId,
    url: z.string(),
    createdAt: wireUtc,
    variants: z.array(variant).length(3),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      readUploadedImage({ id: value.id, url: value.url, variants: value.variants });
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid issued image metadata' });
    }
  });
export type ImageLibraryItem = z.infer<typeof imageLibraryItemSchema>;
export const imageLibraryPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    asOfAt: wireUtc,
    pageSize: z.literal(24),
    items: z.array(imageLibraryItemSchema).max(24),
    nextCursor: cursorSchema.nullable(),
  })
  .strict()
  .refine(
    (page) =>
      (!page.nextCursor || page.items.length === 24) &&
      new Set(page.items.map((item) => item.id)).size === page.items.length &&
      page.items.every(
        (item, i) =>
          timeKey(item.createdAt) <= timeKey(page.asOfAt) &&
          (i === 0 ||
            timeKey(item.createdAt) < timeKey(page.items[i - 1].createdAt) ||
            (timeKey(item.createdAt) === timeKey(page.items[i - 1].createdAt) &&
              item.id < page.items[i - 1].id)),
      ),
  );
export type ImageLibraryPage = z.infer<typeof imageLibraryPageSchema>;
export function imageLibraryPath(filters: ImageLibraryFilters, cursor: string | null) {
  const value = imageLibraryFiltersSchema.parse(filters),
    query = new URLSearchParams();
  if (value.q) query.set('q', value.q);
  if (value.fromAt) query.set('fromAt', value.fromAt);
  if (value.toAt) query.set('toAt', value.toAt);
  if (cursor) query.set('cursor', cursorSchema.parse(cursor));
  return '/admin/media/images' + (query.size ? '?' + query.toString() : '');
}
export function readImageLibraryPage(raw: unknown, filters: ImageLibraryFilters): ImageLibraryPage {
  const parsed = imageLibraryPageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.items.some(
      (item) =>
        (filters.q && !item.id.startsWith(filters.q)) ||
        (filters.fromAt && timeKey(item.createdAt) < timeKey(filters.fromAt)) ||
        (filters.toAt && timeKey(item.createdAt) >= timeKey(filters.toAt)),
    )
  )
    throw new Error('پاسخ کتابخانهٔ تصاویر معتبر نیست؛ دوباره دریافت کنید.');
  return parsed.data;
}
export function localImageLibraryTime(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('زمان انتخاب‌شده معتبر نیست.');
  const at = new Date(value),
    parts = value.split(/[-T:]/).map(Number);
  if (
    !Number.isFinite(at.getTime()) ||
    at.getFullYear() !== parts[0] ||
    at.getMonth() + 1 !== parts[1] ||
    at.getDate() !== parts[2] ||
    at.getHours() !== parts[3] ||
    at.getMinutes() !== parts[4]
  )
    throw new Error('زمان انتخاب‌شده در منطقهٔ دستگاه معتبر نیست.');
  return at.toISOString();
}
export function imageLibraryAssetId(url: string): string | null {
  return /^\/media\/catalog\/([a-f0-9]{32})\/(?:thumb|card|zoom)\.webp$/.exec(url)?.[1] ?? null;
}
export function appendLibraryImage(current: readonly string[], raw: unknown, max: number) {
  const item = imageLibraryItemSchema.safeParse(raw);
  if (!item.success) throw new Error('تصویر انتخاب‌شده معتبر نیست؛ دوباره دریافت کنید.');
  if (current.some((url) => imageLibraryAssetId(url) === item.data.id))
    return { reason: 'duplicate' as const, value: [...current] };
  if (current.length >= max) return { reason: 'full' as const, value: [...current] };
  return { reason: 'added' as const, value: [...current, item.data.url] };
}
