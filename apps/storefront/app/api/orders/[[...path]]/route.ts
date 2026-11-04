import { proxyOrderDigital } from '@/lib/orders/order-digital-proxy';
import { proxyOrderParcels } from '@/lib/orders/order-parcel-proxy';
import type { NextRequest } from 'next/server';
import { proxyOrders } from '@/lib/orders/order-proxy';
import { proxyOrdersV2 } from '@/lib/orders/order-v2-proxy';
import { proxyOrderReturns } from '@/lib/orders/rma-proxy';
async function handler(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const path = (await params).path ?? [],
    environment = {
      SHOP_API_URL: process.env.SHOP_API_URL,
      SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
      SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    };
  return path[1] === 'returns'
    ? proxyOrderReturns(request, path, environment)
    : path.includes('fulfillment') && path.includes('digital')
      ? proxyOrderDigital(request, path, environment)
      : path.includes('fulfillment')
        ? proxyOrderParcels(request, path, environment)
        : path[0] === 'v2'
          ? proxyOrdersV2(request, path.slice(1), environment)
          : proxyOrders(request, path, environment);
}
export const GET = handler;
export const POST = handler;
export const PUT = handler;
