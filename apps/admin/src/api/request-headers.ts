export function adminRequestHeaders(
  body: BodyInit | null | undefined,
  token: string,
  provided?: HeadersInit,
) {
  const headers = new Headers();
  if (!(typeof FormData !== 'undefined' && body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  headers.set('X-Sayman-Client', 'admin');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  new Headers(provided).forEach((value, name) => headers.set(name, value));
  return headers;
}
