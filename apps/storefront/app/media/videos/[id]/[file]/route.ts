import { proxyPublicVideo } from '@/lib/media/public-video-proxy';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^[a-f0-9]{32}$/.test(id) || !/^clip\.(mp4|webm)$/.test(file))
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const base = process.env.SHOP_API_URL,
    mode = process.env.SHOP_DATA_MODE ?? (base ? 'api' : 'preview');
  if (mode !== 'api' || !base)
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return proxyPublicVideo(
    request,
    base.replace(/\/$/, '') + '/api/media/videos/' + id + '/' + file,
  );
}
