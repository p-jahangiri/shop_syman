import { ImageResponse } from 'next/og';
import { getStorefront } from '@/lib/storefront-data';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; size: string }> },
) {
  const { locale, size } = await params;
  if ((locale !== 'fa' && locale !== 'en') || !['180.png', '192.png', '512.png'].includes(size))
    return new Response(null, { status: 404 });
  const pixels = Number.parseInt(size, 10);
  const { site } = await getStorefront(locale);
  // Render the repository's geometric brand mark directly from code; no remote image fetch.
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: site.palette?.primaryLight ?? '#425b36',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: pixels * 0.045,
          width: pixels * 0.48,
          transform: 'rotate(-12deg)',
        }}
      >
        {[1, 0.8, 0.6].map((width, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              width: pixels * 0.48 * width,
              height: pixels * 0.09,
              background: '#f4f6ed',
              borderRadius: pixels * 0.015,
              marginLeft: i * pixels * 0.04,
            }}
          />
        ))}
      </div>
    </div>,
    {
      width: pixels,
      height: pixels,
      headers: { 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' },
    },
  );
}
