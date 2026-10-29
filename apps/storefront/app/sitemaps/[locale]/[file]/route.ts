import { sitemapEnvironment, sitemapFileResponse } from '@/lib/sitemap-http';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; file: string }> },
) {
  const { locale, file } = await params;
  return sitemapFileResponse(request, locale, file, sitemapEnvironment());
}
