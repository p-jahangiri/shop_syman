import { z } from 'zod';
import { normalizeAdminListText } from '../../../utils/admin-list-text.ts';

const version = z
  .string()
  .regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/)
  .nullable();
const parameter = z.string().regex(/^[A-Za-z0-9_]{1,50}$/);
const genericName = z
  .string()
  .max(25)
  .refine((value) => value === value.trim() && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value));
const fields = {
  provider: z.literal('smsIr'),
  enabled: z.boolean(),
  mode: z.enum(['live', 'sandbox']),
  templateId: z.number().int().min(1).max(2147483647),
  codeParameterName: parameter,
  nameParameterName: parameter.nullable(),
  genericName,
};
function validNames(value: {
  codeParameterName: string;
  nameParameterName: string | null;
  genericName: string;
}) {
  return (
    value.nameParameterName === null ||
    (value.genericName.length > 0 &&
      value.nameParameterName.toLowerCase() !== value.codeParameterName.toLowerCase())
  );
}
function validMode(value: {
  mode: 'live' | 'sandbox';
  templateId: number;
  codeParameterName: string;
  nameParameterName: string | null;
}) {
  return value.mode === 'live'
    ? value.templateId !== 123456
    : value.templateId === 123456 &&
        value.codeParameterName === 'Code' &&
        value.nameParameterName === null;
}
export const smsSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    version,
    ...fields,
    keyConfigured: z.boolean(),
    otpLifetimeSeconds: z.literal(300),
    resendAfterSeconds: z.literal(60),
    maxAttempts: z.literal(5),
    availability: z.enum(['unconfigured', 'disabled', 'sandbox', 'configured']),
  })
  .strict()
  .refine(validNames)
  .refine(validMode)
  .refine(
    (value) =>
      value.availability ===
      (!value.keyConfigured
        ? 'unconfigured'
        : !value.enabled
          ? 'disabled'
          : value.mode === 'sandbox'
            ? 'sandbox'
            : 'configured'),
  );
export type SmsSettings = z.infer<typeof smsSettingsSchema>;
const commandBase = { version, requestId: z.string().regex(/^(?!0{32}$)[a-f0-9]{32}$/), ...fields };
export const smsSettingsCommandSchema = z
  .discriminatedUnion('apiKeyAction', [
    z.object({ ...commandBase, apiKeyAction: z.literal('keep') }).strict(),
    z.object({ ...commandBase, apiKeyAction: z.literal('clear') }).strict(),
    z
      .object({
        ...commandBase,
        apiKeyAction: z.literal('replace'),
        apiKey: z.string().regex(/^[!-~]{1,512}$/),
      })
      .strict(),
  ])
  .refine(validNames)
  .refine(validMode);
export type SmsSettingsCommand = z.infer<typeof smsSettingsCommandSchema>;
export type SmsKeyAction = SmsSettingsCommand['apiKeyAction'];
export type SmsSettingsDraft = {
  enabled: boolean;
  mode: 'live' | 'sandbox';
  templateId: string;
  codeParameterName: string;
  useName: boolean;
  nameParameterName: string;
  genericName: string;
};
export function smsSettingsDraft(value: SmsSettings): SmsSettingsDraft {
  return {
    enabled: value.enabled,
    mode: value.mode,
    templateId: String(value.templateId),
    codeParameterName: value.codeParameterName,
    useName: value.nameParameterName !== null,
    nameParameterName: value.nameParameterName ?? 'NAME',
    genericName: value.genericName,
  };
}
export function readSmsSettings(raw: unknown): SmsSettings {
  const parsed = smsSettingsSchema.safeParse(raw);
  if (!parsed.success) throw new Error('تنظیمات پیامک معتبر نیست؛ دوباره از سرور دریافت کنید.');
  return parsed.data;
}
export function smsSettingsCommand(
  draft: SmsSettingsDraft,
  expectedVersion: string | null,
  requestId: string,
  action: SmsKeyAction,
  apiKey: string,
): SmsSettingsCommand {
  const template = normalizeAdminListText(draft.templateId);
  const raw = {
    version: expectedVersion,
    requestId,
    provider: 'smsIr',
    enabled: draft.enabled,
    mode: draft.mode,
    templateId: /^[1-9][0-9]{0,9}$/.test(template) ? Number(template) : 0,
    codeParameterName: draft.codeParameterName,
    nameParameterName: draft.useName ? draft.nameParameterName : null,
    genericName: draft.useName ? draft.genericName : '',
    apiKeyAction: action,
    ...(action === 'replace' ? { apiKey } : {}),
  };
  const parsed = smsSettingsCommandSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      'شناسهٔ قالب، نام پارامترها و کلید جایگزین را بررسی کنید؛ کلید باید بدون فاصله و نام عمومی حداکثر ۲۵ نویسه باشد.',
    );
  return parsed.data;
}
export function readSmsSettingsReceipt(
  raw: unknown,
  command: SmsSettingsCommand,
  previousKeyConfigured: boolean,
) {
  const value = readSmsSettings(raw);
  const keys = [
    'provider',
    'enabled',
    'mode',
    'templateId',
    'codeParameterName',
    'nameParameterName',
    'genericName',
  ] as const;
  if (
    !value.version ||
    keys.some((key) => value[key] !== command[key]) ||
    value.keyConfigured !==
      (command.apiKeyAction === 'replace'
        ? true
        : command.apiKeyAction === 'clear'
          ? false
          : previousKeyConfigured)
  )
    throw new Error(
      'پاسخ ذخیرهٔ پیامک قابل تأیید نیست؛ نتیجه را نامشخص در نظر بگیرید و تنظیمات جاری را بازخوانی کنید.',
    );
  return value;
}
