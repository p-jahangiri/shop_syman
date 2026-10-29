import { proxySourcingRequests } from '@/lib/sourcing-proxy';
async function handler(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return proxySourcingRequests(request, (await params).path ?? [], {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
export const GET = handler;
export const POST = handler;
