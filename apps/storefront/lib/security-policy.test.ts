import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { storefrontSecurityPolicy, browserPermissionsPolicy } from './security-policy.ts';
import { refreshCookieName, readRefreshCookie, safeRefreshCookie } from './auth-cookie.ts';
import { publicOrigin } from './seo.ts';

test('production CSP requires a nonce for scripts and disallows eval, framing and insecure upgrades on local HTTP', () => {
  const nonce = 'c2VjdXJpdHktbm9uY2UtdGVzdC1vbmx5';
  const policy = storefrontSecurityPolicy(nonce, { development: false, https: true });
  const script = policy.split('; ').find((p) => p.startsWith('script-src'))!;
  assert.match(script, new RegExp(`'nonce-${nonce}'`));
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval|https:/);
  for (const directive of [
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ])
    assert.ok(policy.includes(directive));
  assert.doesNotMatch(
    storefrontSecurityPolicy(nonce, { development: false, https: false }),
    /upgrade-insecure-requests|unsafe-eval/,
  );
  assert.throws(() =>
    storefrontSecurityPolicy("bad'; unsafe-inline", { development: false, https: true }),
  );
  assert.match(browserPermissionsPolicy, /camera=\(\).*microphone=\(\)/);
});
test('refresh cookies have separate HTTPS names, canonical attributes and bounded lifetime', () => {
  const value = 'a'.repeat(64);
  assert.equal(refreshCookieName(true), '__Host-sayman_refresh');
  assert.equal(
    safeRefreshCookie(`__Host-sayman_refresh=${value}; Path=/; Secure; Max-Age=604790`, true),
    `__Host-sayman_refresh=${value}; Path=/; Max-Age=604790; HttpOnly; SameSite=Strict; Secure`,
  );
  assert.equal(
    safeRefreshCookie(`sayman_refresh=${value}; Max-Age=300`, false),
    `sayman_refresh=${value}; Path=/api/auth; Max-Age=300; HttpOnly; SameSite=Strict`,
  );
  assert.match(
    safeRefreshCookie('sayman_refresh=; expires=Thu, 01 Jan 1970 00:00:00 GMT', true)!,
    /Max-Age=0.*Secure/,
  );
  for (const header of [
    `sayman_admin_refresh=${value}; Max-Age=100`,
    `__Host-sayman_refresh=${value}; Max-Age=100`,
    `__Host-sayman_refresh=${value}; Secure; Max-Age=604801`,
    `__Host-sayman_refresh=${value}; Secure; Max-Age=-1`,
    `__Host-sayman_refresh=${value}; Secure; Max-Age=100; Domain=example.test`,
    '__Host-sayman_refresh=invalid; Secure; Max-Age=100',
    `sayman_refresh=${value}; Secure; Max-Age=100`,
  ])
    assert.equal(safeRefreshCookie(header, true), undefined);
});
test('refresh parsing rejects duplicate and malformed cookies and ignores unrelated private values', () => {
  const value = 'b'.repeat(64),
    name = refreshCookieName(false);
  assert.equal(
    readRefreshCookie(
      `cart=private; ${name}=${value}; sayman_admin_refresh=${'c'.repeat(64)}`,
      name,
    ),
    value,
  );
  assert.equal(readRefreshCookie(null, name), undefined);
  assert.throws(() => readRefreshCookie(`${name}=${value}; ${name}=${value}`, name));
  assert.throws(() => readRefreshCookie(`${name}=short`, name));
});
test('public origin permits plain HTTP only on loopback names', () => {
  for (const origin of [
    'http://192.168.1.8',
    'http://10.1.1.8',
    'http://shop.local',
    'http://shop.example',
    'http://0.0.0.0',
  ])
    assert.equal(publicOrigin({ SHOP_PUBLIC_URL: origin }), undefined);
  for (const origin of [
    'https://shop.example',
    'http://127.0.0.1:3000',
    'http://fixture.localhost:3000',
    'http://[::1]:3000',
  ])
    assert.equal(publicOrigin({ SHOP_PUBLIC_URL: origin }), origin);
});
test('all storefront schema validation works without an eval capability or probe', () => {
  const script = `
    let calls = 0;
    globalThis.Function = new Proxy(globalThis.Function, { construct(){ calls++; throw Error('CSP'); }, apply(){ calls++; throw Error('CSP'); } });
    const {z} = await import(${JSON.stringify(new URL('./schema-runtime.ts', import.meta.url).href)});
    const result = z.object({amount: z.string().regex(/^\\d+$/)}).strict().safeParse({amount:'9007199254740993'});
    if (!result.success || calls !== 0) throw Error('Schema attempted eval or rejected valid data');
  `;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { cwd: new URL('../../..', import.meta.url), encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
