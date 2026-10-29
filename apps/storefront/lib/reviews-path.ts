export function isCustomerReviewsPath(path: string, method: string) {
  return (
    (method === 'GET' && /^\/api\/reviews\/products\/[A-Za-z0-9_-]{1,64}\/mine$/.test(path)) ||
    (method === 'PUT' &&
      /^\/api\/reviews\/products\/[A-Za-z0-9_-]{1,64}\/commands\/[a-f0-9]{32}$/.test(path)) ||
    (method === 'POST' && /^\/api\/reviews\/[a-f0-9]{32}\/reports\/[a-f0-9]{32}$/.test(path))
  );
}
