import { z } from './schema-runtime.ts';

const staticImage =
  /^\/products\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:svg|png|jpe?g|webp|avif)$/;
const uploadedImage = /^\/media\/catalog\/[a-f0-9]{32}\/(?:thumb|card|zoom)\.webp$/;

export function isPublicImageUrl(value: string): boolean {
  if (
    value.length > 1500 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters at the public image boundary.
    /[\s\\\x00-\x1f\x7f-\x9f]/u.test(value)
  )
    return false;
  if (value.startsWith('/')) return staticImage.test(value) || uploadedImage.test(value);
  if (!value.startsWith('https://') || value.includes('#')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const publicImageUrlSchema = z.string().max(1500).refine(isPublicImageUrl);
