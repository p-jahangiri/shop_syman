import type { MetadataRoute } from 'next';
import { publicOrigin } from '@/lib/seo';
import { sitemapManifests } from '@/lib/sitemap-projection';
import { sitemapEnvironment } from '@/lib/sitemap-http';
export const dynamic = 'force-dynamic';
export default async function robots(): Promise<MetadataRoute.Robots> {
  const snapshots = await sitemapManifests(sitemapEnvironment());
  if (!snapshots.length) return { rules: { userAgent: '*', disallow: '/' } };
  const privatePaths = [
    'account',
    'cart',
    'checkout',
    'payment',
    'payments',
    'orders',
    'credit',
    'admin',
    'compare',
    'wishlist',
    'install',
  ];
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/pwa/',
        '/sw.js',
        ...(['fa', 'en'] as const).flatMap((locale) =>
          snapshots.some((s) => s.locale === locale)
            ? privatePaths.map((path) => `/${locale}/${path}`)
            : [`/${locale}/`],
        ),
      ],
    },
    sitemap: `${publicOrigin()}/sitemap.xml`,
  };
}
