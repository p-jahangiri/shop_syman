import { getOfflineCatalog } from '@/lib/offline/offline-data';
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const locale = file === 'fa.json' ? 'fa' : file === 'en.json' ? 'en' : null;
  if (!locale) return new Response(null, { status: 404 });
  try {
    const data = await getOfflineCatalog(locale, request.signal);
    return Response.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Shop-Public-Resource': 'offline-catalog-v1',
        'X-Shop-Catalog-Generated': data.generatedAt,
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch {
    return Response.json(
      { title: 'offline_catalog_unavailable' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
      },
    );
  }
}
