import { proxyNotifications } from '@/lib/notifications/notification-proxy';
export async function GET(request: Request) {
  return proxyNotifications(request, [], {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
