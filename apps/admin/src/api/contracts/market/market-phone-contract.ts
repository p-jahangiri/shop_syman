import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const configurationId = z.string().regex(/^[a-f0-9]{32}$/);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const nullable = <T extends z.ZodType>(value: T) =>
  value.nullish().transform((value) => value ?? null);
export const phoneConfigurationInputSchema = z
  .object({
    enabled: z.boolean(),
    ramGb: z.number().int().min(1).max(128),
    storageGb: z.number().int().min(1).max(32768),
    colorKey: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(64),
    colorNameFa: z.string().trim().min(1).max(120),
    colorNameEn: z.string().trim().min(1).max(120),
    colorHex: nullable(
      z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .transform((value) => value.toLowerCase()),
    ),
    imageUrl: nullable(z.string().min(1).max(1500)),
    linkedVariantId: nullable(id),
  })
  .strict();
export const phoneConfigurationSchema = phoneConfigurationInputSchema
  .extend({ id: configurationId, version })
  .strict();
export const phoneConfigurationsSchema = z
  .object({
    schemaVersion: z.literal(1),
    listingId: id,
    listingVersion: version,
    configurations: z.array(phoneConfigurationSchema),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.configurations.map((item) => item.id)).size === value.configurations.length,
  );
export const phoneConfigurationCommandInputSchema = z
  .object({
    listingVersion: version,
    configurationVersion: nullable(version),
    configuration: phoneConfigurationInputSchema,
  })
  .strict();
export const phoneConfigurationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    listingId: id,
    configurationId,
    listingVersion: version,
    configurationVersion: version,
    replayed: z.boolean(),
  })
  .strict();
export type PhoneConfiguration = z.infer<typeof phoneConfigurationSchema>;
export type PhoneConfigurations = z.infer<typeof phoneConfigurationsSchema>;
export type PhoneConfigurationResult = z.infer<typeof phoneConfigurationResultSchema>;
export interface PhoneConfigurationCommand {
  listingId: string;
  configurationId: string;
  requestId: string;
  input: z.infer<typeof phoneConfigurationCommandInputSchema>;
}
export function readPhoneConfigurationResult(raw: unknown, command: PhoneConfigurationCommand) {
  const result = phoneConfigurationResultSchema.parse(raw);
  if (
    result.requestId.toLowerCase() !== command.requestId.toLowerCase() ||
    result.listingId !== command.listingId ||
    result.configurationId !== command.configurationId
  )
    throw Error('رسید ثبت ترکیب با همان مدل، انتخاب و شناسهٔ فرمان هم‌خوان نیست.');
  return result;
}
export const phoneConfigurationPath = (listingId: string) =>
  '/admin/market/' + encodeURIComponent(id.parse(listingId)) + '/phone-configurations';
export const phoneConfigurationReceiptPath = (requestId: string) =>
  '/admin/market/phone-configuration-commands/' +
  encodeURIComponent(z.string().uuid().parse(requestId));
