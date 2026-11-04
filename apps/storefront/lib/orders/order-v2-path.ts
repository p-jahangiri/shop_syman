export function isCustomerOrderV2Path(path: string, method = 'GET') {
  if (/^\/api\/orders\/v2(?:\?cursor=[A-Za-z0-9_-]{1,200})?$/.test(path))
    return method === 'GET' || (path === '/api/orders/v2' && method === 'POST');
  if (/^\/api\/orders\/v2\/[a-f0-9]{32}(?:\/shipment)?$/.test(path)) return method === 'GET';
  return method === 'POST' && /^\/api\/orders\/v2\/[a-f0-9]{32}\/cancel$/.test(path);
}
