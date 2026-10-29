import { proxyPhones } from '@/lib/phone-discovery-http';
async function handler(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyPhones(request, (await params).path, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
  });
}
export const GET = handler;
export const POST = handler;
export const PUT = handler;
