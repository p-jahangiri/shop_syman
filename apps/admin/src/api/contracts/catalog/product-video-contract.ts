import { z } from 'zod';
export function validProductVideoUrl(value: string) {
  if (!value || value.length > 1500 || /[\s\\]/u.test(value)) return false;
  if (/^\/media\/videos\/[a-f0-9]{32}\/clip\.(mp4|webm)$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      /\.(mp4|webm)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export const productVideoSchema = z
  .object({
    url: z.string().refine(validProductVideoUrl),
    variantId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict();
export type ProductVideo = z.infer<typeof productVideoSchema>;
export const videoCapabilitiesSchema = z
  .object({
    configured: z.boolean(),
    maxBytes: z.literal(33554432),
    maxDurationSeconds: z.literal(600),
    contentTypes: z.array(z.enum(['video/mp4', 'video/webm'])).length(2),
  })
  .strict();
export const uploadedVideoSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{32}$/),
    url: z.string(),
    contentType: z.enum(['video/mp4', 'video/webm']),
    bytes: z.number().int().min(12).max(41943040),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    durationMilliseconds: z.number().int().min(1).max(600000),
  })
  .strict()
  .refine(
    (v) =>
      v.url ===
      '/media/videos/' + v.id + '/clip.' + (v.contentType === 'video/mp4' ? 'mp4' : 'webm'),
  );
export function adminVideoUrl(url: string) {
  return /^\/media\/videos\//.test(url) ? '/api' + url : url;
}
