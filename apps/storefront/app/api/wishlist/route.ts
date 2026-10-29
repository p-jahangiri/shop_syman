import { proxyWishlist } from '@/lib/wishlist-proxy';
const handler = (request: Request) =>
  proxyWishlist(request, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
export const GET = handler;
export const PUT = handler;
export const POST = handler;
export const DELETE = handler;
export const PATCH = handler;
