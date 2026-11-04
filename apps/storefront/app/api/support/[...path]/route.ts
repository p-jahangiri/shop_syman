import type { NextRequest } from 'next/server';
import { proxyTicket } from '@/lib/support/ticket-proxy';
async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyTicket(request, (await params).path, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
export { handle as GET, handle as POST, handle as PUT };
