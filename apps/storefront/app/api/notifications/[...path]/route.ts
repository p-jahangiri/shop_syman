import { proxyNotifications } from '@/lib/notifications/notification-proxy';
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyNotifications(request, (await params).path, {
    SHOP_API_URL: process.env.SHOP_API_URL,
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  });
}
export { handle as GET, handle as PUT };
