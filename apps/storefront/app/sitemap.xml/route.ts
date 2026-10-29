import { sitemapEnvironment, sitemapIndexResponse } from '@/lib/sitemap-http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return sitemapIndexResponse(request, sitemapEnvironment());
}
