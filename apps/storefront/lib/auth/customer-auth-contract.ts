import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';

// Keep the existing customer session projection: staff permissions, refresh
// credentials and any other upstream fields never belong in this browser DTO.
export const customerAuthSchema = z.object({
  accessToken: z.string().min(20).max(8192),
  expiresIn: z.number().int().min(1).max(3600),
  requiresMfa: z.boolean(),
  requiresEnrollment: z.boolean(),
  user: z.object({
    id: z.string().min(1).max(64),
    displayName: z.string().max(200),
    userName: z.string().max(256),
  }),
});
export type CustomerSession = z.infer<typeof customerAuthSchema>;
