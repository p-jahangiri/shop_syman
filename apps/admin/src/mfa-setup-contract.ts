import { z } from 'zod';

const label = z
  .string()
  .min(1)
  .max(256)
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  .refine((value) => value.trim() === value && !/[:\u0000-\u001f\u007f]/u.test(value));
export const mfaSetupSchema = z
  .object({
    secret: z.string().regex(/^[A-Z2-7]{16,128}$/),
    accessToken: z.string().min(16).max(8192),
    account: label,
    issuer: label,
    algorithm: z.literal('SHA1'),
    digits: z.literal(6),
    period: z.literal(30),
  })
  .strict();
export type MfaSetup = z.infer<typeof mfaSetupSchema>;

export function authenticatorUri(setup: MfaSetup): string {
  const value = mfaSetupSchema.parse(setup);
  const params = new URLSearchParams({
    secret: value.secret,
    issuer: value.issuer,
    algorithm: value.algorithm,
    digits: String(value.digits),
    period: String(value.period),
  });
  return `otpauth://totp/${encodeURIComponent(value.issuer)}:${encodeURIComponent(value.account)}?${params.toString()}`;
}

// The untrusted exp claim only shortens the UI deadline; API validation remains authoritative.
// Never renew an MFA challenge as a completed access session.
export function mfaGrantDeadline(token: string, expiresIn: number, now = Date.now()): number {
  if (token.length > 8192 || !Number.isFinite(now) || !Number.isFinite(expiresIn) || expiresIn <= 0)
    return now;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return now;
    const payload = JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= 0 ||
      payload.exp > Number.MAX_SAFE_INTEGER / 1000
    )
      return now;
    return Math.min(now + Math.min(expiresIn, 300) * 1000, payload.exp * 1000);
  } catch {
    return now;
  }
}
export function mfaRemainingSeconds(deadline: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function formatMfaRemaining(seconds: number): string {
  const value = Math.max(0, Math.min(300, Math.floor(seconds)));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`.replace(
    /[0-9]/g,
    (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)],
  );
}
