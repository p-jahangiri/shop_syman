import { z } from './schema-runtime.ts';
import { normalizeOrderDigits, normalizeOrderPhone } from './order-form.ts';
export const addressId = z.string().regex(/^[a-f0-9]{32}$/);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const text = (min: number, max: number, multiline = false) =>
  z
    .string()
    .transform((v) => v.normalize('NFKC').trim().replace(/\r\n?/g, '\n'))
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine(
          (v) =>
            ![...v].some(
              // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
              (c) => /[\u0000-\u001f\u007f-\u009f]/.test(c) && !(multiline && c === '\n'),
            ),
        ),
    );
const phone = z
  .string()
  .max(64)
  .transform(normalizeOrderPhone)
  .pipe(z.string().regex(/^09\d{9}$/));
const postal = z
  .string()
  .max(64)
  .transform((v) => normalizeOrderDigits(v).replace(/ /g, ''))
  .pipe(z.string().regex(/^\d{10}$/));
export const savedDelivery = z
  .object({
    countryCode: z.literal('IR'),
    province: text(2, 100),
    city: text(2, 100),
    address: text(10, 2000, true),
    postalCode: postal,
  })
  .strict();
export const saveAddressInput = z
  .object({
    label: text(1, 60),
    contactName: text(2, 100),
    contactPhone: phone,
    delivery: savedDelivery,
    makeDefault: z.boolean(),
    version: version.nullable(),
  })
  .strict();
export type SaveAddressInput = z.infer<typeof saveAddressInput>;
export const deleteAddressInput = z.object({ version }).strict();
export const savedAddress = z
  .object({
    id: addressId,
    label: text(1, 60),
    contactName: text(2, 100),
    contactPhone: z.string().regex(/^09\d{9}$/),
    delivery: savedDelivery,
    isDefault: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    version,
  })
  .strict();
export type SavedAddress = z.infer<typeof savedAddress>;
export const addressBook = z
  .object({
    schemaVersion: z.literal(1),
    capacity: z.literal(20),
    items: z.array(savedAddress).max(20),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.items.map((a) => a.id)).size === v.items.length &&
      (v.items.length === 0 || v.items.filter((a) => a.isDefault).length === 1),
  );
export type AddressBook = z.infer<typeof addressBook>;
export const saveAddressResult = z
  .object({ schemaVersion: z.literal(1), address: savedAddress, replayed: z.boolean() })
  .strict();
// Copy only delivery fields. Order notes, consent and a frozen retry remain independent.
export function addressOrderFields(a: SavedAddress) {
  return {
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    province: a.delivery.province,
    city: a.delivery.city,
    address: a.delivery.address,
    postalCode: a.delivery.postalCode,
  };
}
