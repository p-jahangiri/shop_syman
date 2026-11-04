export function isCustomerPaymentPath(path: string, method = 'GET') {
  if (method !== 'GET') return false;
  return /^\/api\/payments\/(?:attempts\/[a-f0-9]{32}|orders\/[a-f0-9]{32}(?:\?cursor=[A-Za-z0-9_-]{1,512})?)$/.test(
    path,
  );
}
