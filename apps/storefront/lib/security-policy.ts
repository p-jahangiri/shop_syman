export function storefrontSecurityPolicy(
  nonce: string,
  options: { development: boolean; https: boolean },
): string {
  if (!/^[A-Za-z0-9+/=_-]{24,128}$/.test(nonce)) throw new Error('Invalid CSP nonce');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ''}`,
    // Existing server-rendered brand variables and component styles need inline CSS.
    // Script execution remains nonce-only; no inline/eval script escape is enabled.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self'",
    `connect-src 'self'${options.development ? ' ws: wss:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(options.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export const browserPermissionsPolicy =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
