import type { NextRequest } from 'next/server';
import { proxyAddresses } from '@/lib/address-proxy';
async function handler(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  return proxyAddresses(request, (await params).path ?? [], {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
export const GET = handler;
export const PUT = handler;
export const DELETE = handler;
