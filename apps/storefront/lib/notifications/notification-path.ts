import { notificationCursor } from '@sayman/web-shared/lib/notifications/notification-contract.ts';
export function isCustomerNotificationPath(value: string, method = 'GET') {
  if (!value.startsWith('/api/notifications')) return false;
  let url: URL;
  try {
    url = new URL(value, 'http://localhost');
  } catch {
    return false;
  }
  if (url.origin !== 'http://localhost' || url.hash || url.pathname !== value.split('?')[0])
    return false;
  const path = url.pathname;
  let allowed: string[] = [];
  if (method === 'GET') {
    if (
      path === '/api/notifications' ||
      path === '/api/notifications/credit-reminders' ||
      path === '/api/notifications/phones'
    )
      allowed = ['unreadOnly', 'cursor'];
    else if (
      path !== '/api/notifications/unread-count' &&
      path !== '/api/notifications/credit-reminders/unread-count' &&
      path !== '/api/notifications/phones/unread-count'
    )
      return false;
  } else if (
    method !== 'PUT' ||
    url.search ||
    !/^\/api\/notifications\/(?:(?:credit-reminders|phones)\/)?[a-f0-9]{32}\/read$/.test(path) ||
    path.includes('/' + '0'.repeat(32) + '/')
  )
    return false;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some((k) => !allowed.includes(k))) return false;
  for (const [key, item] of url.searchParams)
    if (key === 'unreadOnly') {
      if (!['true', 'false'].includes(item)) return false;
    } else
      try {
        notificationCursor(item);
      } catch {
        return false;
      }
  return true;
}
