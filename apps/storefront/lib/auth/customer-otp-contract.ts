import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';

const id = z
  .string()
  .length(32)
  .regex(/^[a-f0-9]{32}$/);
const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/)
  .refine((value) => {
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19)
    );
  });
export const otpRequestSchema = z.strictObject({
  mobile: z
    .string()
    .length(13)
    .regex(/^\+989\d{9}$/),
  requestId: id,
});
export const otpVerifySchema = z.strictObject({
  challengeId: id,
  code: z
    .string()
    .length(6)
    .regex(/^[0-9]{6}$/),
});
export const otpChallengeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    challengeId: id,
    expiresAt: utc,
    resendAt: utc,
    delivery: z.enum(['accepted', 'unknown']),
  })
  .refine((value) => Date.parse(value.resendAt) < Date.parse(value.expiresAt));
export type OtpRequest = z.infer<typeof otpRequestSchema>;
export type OtpChallenge = z.infer<typeof otpChallengeSchema>;
export type OtpErrorKind =
  'input' | 'invalid' | 'expired' | 'cooldown' | 'limited' | 'unavailable' | 'unknown' | 'changed';
export class OtpError extends Error {
  kind: OtpErrorKind;
  constructor(kind: OtpErrorKind) {
    super(kind);
    this.kind = kind;
  }
}
// Only these public codes may cross the authentication BFF. Provider messages,
// account existence and raw exception details are never displayed.
export const otpPublicErrors: Readonly<Record<string, readonly number[]>> = {
  otp_invalid: [401],
  otp_expired: [410],
  otp_cooldown: [429],
  otp_rate_limited: [429],
  otp_unavailable: [503],
  otp_delivery_rejected: [503],
  otp_unknown: [503],
  invalid_otp: [400],
};
export function otpErrorKind(status: number, title?: unknown): OtpErrorKind {
  if (title === 'otp_cooldown' && status === 429) return 'cooldown';
  if (status === 401) return 'invalid';
  if (status === 410) return 'expired';
  if (status === 429) return 'limited';
  if (status === 400) return 'input';
  return 'unavailable';
}
export function normalizeOtpDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660)),
  );
}
export function normalizeIranMobile(value: string): string | null {
  if (value.length > 32) return null;
  const normalized = normalizeOtpDigits(value).trim();
  if (/^09\d{9}$/.test(normalized)) return '+98' + normalized.slice(1);
  if (/^00989\d{9}$/.test(normalized)) return '+' + normalized.slice(2);
  return /^\+989\d{9}$/.test(normalized) ? normalized : null;
}
export function otpTiming(challenge: OtpChallenge, now = Date.now()) {
  return {
    expiresIn: Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 1000)),
    resendIn: Math.max(0, Math.ceil((Date.parse(challenge.resendAt) - now) / 1000)),
  };
}
export async function otpResponseError(response: Response, start = false): Promise<OtpError> {
  let title: unknown;
  try {
    const value: unknown = await response.json();
    if (value && typeof value === 'object' && 'title' in value) title = value.title;
  } catch {
    // An unreadable failure body never changes the public status mapping.
  }
  if (start) {
    if (response.status === 400 && title === 'invalid_otp') return new OtpError('input');
    if (response.status === 503 && title === 'otp_delivery_rejected')
      return new OtpError('unavailable');
    if (response.status === 429 && (title === 'otp_cooldown' || title === 'otp_rate_limited'))
      return new OtpError(otpErrorKind(response.status, title));
    // A proxy timeout, transaction conflict or unrecognized service failure can
    // happen after a paid send. Preserve the request ID for explicit recovery.
    return new OtpError('unknown');
  }
  return new OtpError(otpErrorKind(response.status, title));
}
export async function requestOtp(input: OtpRequest): Promise<OtpChallenge> {
  const body = otpRequestSchema.safeParse(input);
  if (!body.success) throw new OtpError('input');
  let response: Response;
  try {
    // A paid send is attempted once. Recovery/resend is always an explicit user
    // action; no refresh machinery, HTTP retry, token or browser storage here.
    response = await fetch('/api/auth/otp', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.data),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new OtpError('unknown');
  }
  if (!response.ok) throw await otpResponseError(response, true);
  try {
    if (response.status !== 200) throw new Error('Unexpected challenge status');
    return otpChallengeSchema.parse(await response.json());
  } catch {
    // The request may have committed even when its response cannot be read.
    throw new OtpError('unknown');
  }
}
