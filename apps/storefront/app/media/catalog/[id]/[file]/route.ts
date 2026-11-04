import { createHash } from 'node:crypto';
import { isProcessedImage } from '@sayman/web-shared/lib/media/media-paths.ts';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  const path = `/media/catalog/${id}/${file}`;
  if (!isProcessedImage(path)) return new Response(null, { status: 404, headers: noStore });
  const base = process.env.SHOP_API_URL;
  const mode = process.env.SHOP_DATA_MODE ?? (base ? 'api' : 'preview');
  if (mode !== 'api' || !base) return new Response(null, { status: 404, headers: noStore });
  const limit = 8 * 1024 * 1024;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api${path}`, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    });
    if (response.status === 404) return new Response(null, { status: 404, headers: noStore });
    const tag = response.headers.get('etag') ?? '';
    const size = Number(response.headers.get('content-length'));
    if (
      !response.ok ||
      response.status !== 200 ||
      response.headers.get('content-type') !== 'image/webp' ||
      response.headers.get('x-shop-public-resource') !== 'catalog-image-v1' ||
      response.headers.has('set-cookie') ||
      /(?:^|,)\s*(?:cookie|authorization)\s*(?:,|$)/i.test(response.headers.get('vary') ?? '') ||
      /private|no-store/i.test(response.headers.get('cache-control') ?? '') ||
      !/^"[a-f0-9]{64}"$/.test(tag) ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > limit
    )
      throw new Error('unapproved_public_image');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing_image');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > size || total > limit) {
          await reader.cancel();
          throw new Error('image_too_large');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (total !== size) throw new Error('incomplete_image');
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    if (
      total < 12 ||
      new TextDecoder('ascii').decode(bytes.slice(0, 4)) !== 'RIFF' ||
      new TextDecoder('ascii').decode(bytes.slice(8, 12)) !== 'WEBP' ||
      createHash('sha256').update(bytes).digest('hex') !== tag.slice(1, -1)
    )
      throw new Error('invalid_image');
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(total),
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: tag,
        'X-Shop-Public-Resource': 'catalog-image-v1',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: noStore });
  }
}
