import { z } from 'zod';
import { staffRowSchema, staffRolesPayload, type StaffRole } from './staff-contract.ts';

function validUnicode(value: string, displayName = false) {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if ((point >= 0xd800 && point <= 0xdfff) || point <= 31 || (point >= 127 && point <= 159))
      return false;
    if (
      displayName &&
      ((point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069))
    )
      return false;
  }
  return true;
}
export const staffPasswordSchema = z
  .string()
  .min(12, 'رمز باید حداقل ۱۲ نویسه داشته باشد.')
  .max(128)
  .refine(
    (value) =>
      /[A-Z]/.test(value) &&
      /[a-z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^A-Za-z0-9]/.test(value),
    'رمز باید شامل حرف بزرگ و کوچک انگلیسی، عدد و نماد باشد.',
  )
  .refine((value) => validUnicode(value), 'رمز دارای نویسهٔ نامعتبر است.');
export const initialStaffPasswordSchema = z
  .object({
    newPassword: staffPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'تکرار رمز یکسان نیست.',
    path: ['confirmPassword'],
  });
export const createStaffFormSchema = z.object({
  userName: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/,
      'نام کاربری ۳ تا ۶۴ نویسهٔ انگلیسی، عدد، نقطه، خط تیره یا زیرخط است.',
    ),
  displayName: z
    .string()
    .trim()
    .min(1, 'نام همکار را وارد کنید.')
    .max(200)
    .refine((value) => validUnicode(value, true), 'نام معتبر نیست.'),
  email: z.union([z.literal(''), z.email().max(256)]),
  initialPassword: staffPasswordSchema,
});
export const staffCreationSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    replayed: z.boolean(),
    staff: staffRowSchema,
  })
  .strict();
export function readStaffCreation(raw: unknown, requestId: string) {
  const parsed = staffCreationSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.requestId !== requestId ||
    parsed.data.staff.provisionedByAdministrator !== true ||
    parsed.data.staff.requiresPasswordChange !== true
  )
    throw new Error('رسید ساخت حساب قابل تأیید نیست؛ شناسهٔ همین تلاش را پیگیری کنید.');
  return parsed.data;
}
export function staffCreationPayload(
  raw: unknown,
  selected: string[],
  roles: StaffRole[],
  requestId: string,
) {
  const values = createStaffFormSchema.parse(raw);
  return {
    requestId: z.uuid().parse(requestId),
    userName: values.userName.toLowerCase(),
    displayName: values.displayName,
    initialPassword: values.initialPassword,
    roles: staffRolesPayload(selected, roles),
    ...(values.email ? { email: values.email } : {}),
  };
}
