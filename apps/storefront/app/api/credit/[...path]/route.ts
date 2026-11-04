import type { NextRequest } from 'next/server';
import { proxyCreditApplications } from '@/lib/credit/credit-application-proxy';
async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyCreditApplications(request, (await params).path, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
export { handle as GET, handle as POST, handle as PUT };
