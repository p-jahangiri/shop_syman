import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';

const singleLine = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine(
      (value) =>
        value === value.trim() &&
        // eslint-disable-next-line no-control-regex -- Account fields reject display controls at the trust boundary.
        !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) &&
        !/\p{Surrogate}/u.test(value),
    );

export const customerAccountProfileSchema = z
  .object({
    id: singleLine(1, 64),
    userName: singleLine(1, 256),
    displayName: singleLine(0, 200),
    email: singleLine(1, 256).nullable(),
    emailConfirmed: z.boolean(),
    phoneNumber: singleLine(1, 64).nullable(),
    phoneNumberConfirmed: z.boolean(),
    createdAt: z
      .string()
      .datetime({ offset: true })
      .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
    passwordEnabled: z.boolean(),
    twoFactorEnabled: z.boolean(),
    version: singleLine(1, 128),
  })
  .strict();

export type CustomerAccountProfile = z.infer<typeof customerAccountProfileSchema>;
export const updateCustomerProfileSchema = z
  .object({ displayName: singleLine(1, 200), version: singleLine(1, 128) })
  .strict();
export type UpdateCustomerProfile = z.infer<typeof updateCustomerProfileSchema>;
export const changeCustomerPasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) })
  .strict();
export type ChangeCustomerPassword = z.infer<typeof changeCustomerPasswordSchema>;

export function isCustomerAccountPath(path: string, method = 'GET') {
  return (
    (path === '/api/account/profile' && (method === 'GET' || method === 'PUT')) ||
    (path === '/api/account/password' && method === 'POST')
  );
}
