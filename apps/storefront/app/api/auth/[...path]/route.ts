import type { NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/seo/seo';
import { proxyAuth } from '@/lib/auth/auth-proxy';
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyAuth(request, (await params).path, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: publicOrigin() ?? undefined,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
export const GET = proxy;
export const POST = proxy;
