import { z } from 'zod';
import { isPublicImageUrl } from '../../storefront/lib/public-image-url.ts';

const maxBytes = 8 * 1024 * 1024;
const contentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const capabilities = z.object({
  configured: z.boolean(),
  maxBytes: z.number().int().positive().max(maxBytes),
  contentTypes: z
    .array(z.enum(contentTypes))
    .min(1)
    .max(3)
    .refine((items) => new Set(items).size === items.length),
  publicImagesOnly: z.literal(true),
});
const variant = z.object({
  name: z.enum(['thumb', 'card', 'zoom']),
  url: z.string(),
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  bytes: z.number().int().min(1).max(maxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const uploaded = z
  .object({
    id: z.string().regex(/^[a-f0-9]{32}$/),
    url: z.string(),
    variants: z.array(variant).length(3),
  })
  .superRefine((value, context) => {
    const edges = { thumb: 320, card: 960, zoom: 1920 };
    if (
      value.url !== `/media/catalog/${value.id}/card.webp` ||
      !isPublicImageUrl(value.url) ||
      new Set(value.variants.map((item) => item.name)).size !== 3 ||
      value.variants.some(
        (item) =>
          item.url !== `/media/catalog/${value.id}/${item.name}.webp` ||
          Math.max(item.width, item.height) > edges[item.name],
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid issued image variants' });
    }
  });
export type ImageCapabilities = z.infer<typeof capabilities>;
export function readImageCapabilities(value: unknown) {
  return capabilities.parse(value);
}
export function readUploadedImage(value: unknown) {
  return uploaded.parse(value);
}
export function validEditorImageUrl(value: string, allowExternal = true) {
  if (!isPublicImageUrl(value)) return false;
  return (
    allowExternal ||
    /^\/products\/[a-zA-Z0-9-]+\.(?:svg|png|jpg|webp)$/.test(value) ||
    value.startsWith('/media/catalog/')
  );
}
export function imagePreviewUrl(value: string) {
  if (!isPublicImageUrl(value)) return undefined;
  return value.startsWith('/media/catalog/')
    ? `/api${value.replace(/\/(thumb|card|zoom)\.webp$/, '/thumb.webp')}`
    : value;
}
