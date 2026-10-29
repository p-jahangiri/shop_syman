import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const iconFiles = new Map([
  ['180.png', 'sayman-olive-v1-180.png'],
  ['192.png', 'sayman-olive-v1-192.png'],
  ['512.png', 'sayman-olive-v1-512.png'],
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; size: string }> },
) {
  const { locale, size } = await params;
  const filename = iconFiles.get(size);
  if ((locale !== 'fa' && locale !== 'en') || !filename) return new Response(null, { status: 404 });
  try {
    // Next's standalone entry sets cwd to the app directory, where public is copied.
    const image = await readFile(path.join(process.cwd(), 'public/pwa/icons', filename));
    return new Response(new Uint8Array(image), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(image.length),
        'Cache-Control': 'public, max-age=300',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }
}
