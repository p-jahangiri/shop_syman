import { proxyMarket } from '@/lib/market/market-http';
async function handler(
  request: Request,
  { params }: { params: Promise<{ locale: string; path: string[] }> },
) {
  const { locale, path } = await params;
  return proxyMarket(request, locale, path, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
  });
}
export const GET = handler;
export const POST = handler;
