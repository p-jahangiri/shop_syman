import type { NextRequest } from 'next/server';
import { proxyCreditOrders } from '@/lib/credit-order-proxy';
async function handle(request: NextRequest) {
  return proxyCreditOrders(request, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
export { handle as GET, handle as POST };
