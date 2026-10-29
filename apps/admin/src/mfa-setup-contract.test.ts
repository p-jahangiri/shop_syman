import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticatorUri,
  mfaGrantDeadline,
  mfaRemainingSeconds,
  formatMfaRemaining,
  mfaSetupSchema,
} from './mfa-setup-contract.ts';

const setup = {
  secret: 'JBSWY3DPEHPK3PXP',
  accessToken: 'synthetic-setup-token',
  account: 'qa+scan@example.test',
  issuer: 'Sayman',
  algorithm: 'SHA1' as const,
  digits: 6 as const,
  period: 30 as const,
};
const token = (exp: unknown) =>
  `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
test('Authenticator URI preserves account, issuer and Base32 secret with the server TOTP parameters', () => {
  const uri = new URL(authenticatorUri(setup));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.host, 'totp');
  assert.equal(decodeURIComponent(uri.pathname), '/Sayman:qa+scan@example.test');
  assert.deepEqual(Object.fromEntries(uri.searchParams), {
    secret: setup.secret,
    issuer: 'Sayman',
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  const unicode = new URL(
    authenticatorUri({ ...setup, issuer: 'سایمان', account: 'qa & test@example.test' }),
  );
  assert.equal(decodeURIComponent(unicode.pathname), '/سایمان:qa & test@example.test');
  assert.equal(unicode.searchParams.get('issuer'), 'سایمان');
});
test('setup rejects unsupported algorithms, label ambiguity, malformed keys and unexpected private fields', () => {
  for (const input of [
    { ...setup, algorithm: 'SHA256' },
    { ...setup, digits: 8 },
    { ...setup, period: 60 },
    { ...setup, account: 'issuer:account' },
    { ...setup, issuer: 'Sayman\n' },
    { ...setup, secret: setup.secret + '=' },
    { ...setup, secret: 'key' },
    { ...setup, refreshToken: 'unexpected' },
  ])
    assert.equal(mfaSetupSchema.safeParse(input).success, false);
});
test('UI deadline respects JWT expiry and the five-minute cap, including shorter recovery grants', () => {
  const now = 1_800_000_000_000;
  assert.equal(mfaGrantDeadline(token(now / 1000 + 300), 300, now), now + 300_000);
  assert.equal(mfaGrantDeadline(token(now / 1000 + 25), 300, now), now + 25_000);
  assert.equal(mfaGrantDeadline(token(now / 1000 + 900), 900, now), now + 300_000);
  assert.equal(mfaGrantDeadline(token(now / 1000 - 1), 300, now), now - 1000);
  for (const value of ['bad', 'a.%.c', token('1800000000'), token(1e20), 'a'.repeat(8193)])
    assert.equal(mfaGrantDeadline(value, 300, now), now);
  assert.equal(mfaGrantDeadline(token(now / 1000 + 300), NaN, now), now);
});
test('countdown crosses expiration without allowing another second and formats Persian digits', () => {
  assert.equal(mfaRemainingSeconds(1001, 1000), 1);
  assert.equal(mfaRemainingSeconds(1001, 1001), 0);
  assert.equal(mfaRemainingSeconds(1001, 5000), 0);
  assert.equal(formatMfaRemaining(300), '۵:۰۰');
  assert.equal(formatMfaRemaining(69), '۱:۰۹');
  assert.equal(formatMfaRemaining(0), '۰:۰۰');
});
