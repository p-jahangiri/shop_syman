import { z } from 'zod';

export function normalizeRecoveryCode(value: string): string | undefined {
  if (value.length > 64) return;
  let code = value.trim();
  if (code.length === 35) {
    if (code[8] !== '-' || code[17] !== '-' || code[26] !== '-') return;
    code = code.replaceAll('-', '');
  }
  return /^[0-9a-fA-F]{32}$/.test(code) ? code.toUpperCase() : undefined;
}
export function normalizeMfaCode(value: string) {
  return value
    .replace(/[۰-۹٠-٩]/g, (char) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(char) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(char) : '٠١٢٣٤٥٦٧٨٩'.indexOf(char)),
    )
    .replace(/[^0-9]/g, '')
    .slice(0, 6);
}
export const recoveryStatusSchema = z
  .object({ schemaVersion: z.literal(1), remainingCodes: z.number().int().min(0).max(10) })
  .strict();
export const recoveryBatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    codes: z
      .array(z.string().regex(/^[0-9A-F]{8}(?:-[0-9A-F]{8}){3}$/))
      .length(10)
      .refine((codes) => new Set(codes).size === 10),
    generatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const recoveryChallengeSchema = z
  .object({
    accessToken: z.string().min(16).max(8192),
    expiresIn: z.literal(300),
    requiresMfa: z.literal(true),
    requiresEnrollment: z.literal(true),
    requiresRecovery: z.literal(false),
    user: z
      .object({
        id: z.string().min(1).max(450),
        displayName: z.string().max(200),
        userName: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();
