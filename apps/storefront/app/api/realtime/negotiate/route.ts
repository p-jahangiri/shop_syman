import { proxyPrivateRealtime } from '@/lib/realtime-proxy';
export async function POST(request: Request) {
  return proxyPrivateRealtime(request, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
