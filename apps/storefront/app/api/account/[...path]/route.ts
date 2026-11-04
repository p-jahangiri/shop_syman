import { proxyCustomerAccount } from '@/lib/account/customer-account-proxy';

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyCustomerAccount(request, (await params).path, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}

export const GET = proxy;
export const PUT = proxy;
export const POST = proxy;
