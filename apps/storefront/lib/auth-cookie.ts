export function refreshCookieName(https: boolean): string {
  return (https ? '__Host-' : '') + 'sayman_refresh';
}

export function readRefreshCookie(header: string | null, name: string): string | undefined {
  const values = (header ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(name + '='))
    .map((p) => p.slice(name.length + 1));
  if (!values.length) return undefined;
  if (values.length !== 1 || !/^[a-f\d]{64}$/i.test(values[0]))
    throw new Error('Invalid or ambiguous refresh cookie');
  return values[0];
}

export function safeRefreshCookie(header: string, https: boolean): string | undefined {
  const parts = header.split(';').map((p) => p.trim());
  const match = parts[0].match(/^([^=]+)=(.*)$/);
  if (!match || parts.some((p) => /^domain\s*=/i.test(p))) return undefined;
  const [, name, value] = match;
  const expected = refreshCookieName(https);
  const age = parts.find((p) => /^max-age=/i.test(p))?.slice(8);
  const expires = parts.find((p) => /^expires=/i.test(p))?.slice(8);
  const deletion =
    value === '' && (age === '0' || (expires !== undefined && Date.parse(expires) < Date.now()));
  if (https && name === refreshCookieName(false) && deletion)
    return `${name}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
  if (
    name !== expected ||
    (!deletion &&
      (!/^[a-f\d]{64}$/i.test(value) ||
        !age ||
        !/^\d+$/.test(age) ||
        Number(age) < 1 ||
        Number(age) > 604800))
  )
    return undefined;
  if (https && !parts.some((p) => /^secure$/i.test(p))) return undefined;
  return `${name}=${value}; Path=${https ? '/' : '/api/auth'}; Max-Age=${deletion ? '0' : age}; HttpOnly; SameSite=Strict${https ? '; Secure' : ''}`;
}
