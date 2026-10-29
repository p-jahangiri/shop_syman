import type { MetadataRoute } from 'next';
import { getStorefront } from '@/lib/storefront-data';
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== 'fa' && locale !== 'en') return new Response(null, { status: 404 });
  const { site } = await getStorefront(locale);
  const icons: NonNullable<MetadataRoute.Manifest['icons']> = [
    ...[192, 512].map((size) => ({
      src: `/pwa/icons/${locale}/${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any' as const,
    })),
    {
      src: `/pwa/icons/${locale}/512.png`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ];
  const manifest: MetadataRoute.Manifest = {
    id: '/',
    name: site.name,
    short_name: site.name,
    description: site.tagline,
    lang: locale,
    dir: locale === 'fa' ? 'rtl' : 'ltr',
    start_url: `/${locale}`,
    scope: '/',
    display: 'standalone',
    background_color: '#f8f9f4',
    theme_color: site.palette?.primaryLight ?? '#425b36',
    categories: ['shopping'],
    icons,
  };
  return Response.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Robots-Tag': 'noindex',
    },
  });
}
