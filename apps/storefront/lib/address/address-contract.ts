import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import {
  normalizeOrderDigits,
  normalizeOrderPhone,
} from '@sayman/web-shared/lib/orders/order-form.ts';
import {
  geographyVersion,
  findProvince,
  findCounty,
  findCity,
  deliveryPoint,
} from './address-geography.ts';
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
const locationId = z.string().regex(/^\d{1,16}$/);
const buildingText = (max: number) =>
  text(0, max)
    .transform(normalizeOrderDigits)
    .refine((v) => !/[\u202a-\u202e\u2066-\u2069]/.test(v));
export const addressDetails = z
  .object({
    geographyVersion: z.literal(geographyVersion),
    provinceId: locationId,
    countyId: locationId,
    cityId: locationId.nullable(),
    localityKind: z.enum(['city', 'other']),
    plaque: buildingText(20).pipe(z.string().min(1)),
    unit: buildingText(10),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const province = findProvince(v.provinceId),
      county = findCounty(v.countyId),
      city = v.cityId ? findCity(v.cityId) : undefined;
    if (!province)
      ctx.addIssue({ code: 'custom', path: ['provinceId'], message: 'Select a province.' });
    if (!county || county.provinceId !== v.provinceId)
      ctx.addIssue({
        code: 'custom',
        path: ['countyId'],
        message: 'Select a county in this province.',
      });
    if (
      v.localityKind === 'city'
        ? !city || city.provinceId !== v.provinceId || city.countyId !== v.countyId
        : v.cityId !== null
    )
      ctx.addIssue({ code: 'custom', path: ['cityId'], message: 'Select a city in this county.' });
    if (
      !(v.latitude === null && v.longitude === null) &&
      !(v.latitude !== null && v.longitude !== null && deliveryPoint(v.latitude, v.longitude))
    )
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Select a point within Iran.' });
  });
export type AddressDetails = z.infer<typeof addressDetails>;
export const saveAddressInput = z
  .object({
    label: text(1, 60),
    contactName: text(2, 100),
    contactPhone: phone,
    delivery: savedDelivery,
    makeDefault: z.boolean(),
    version: version.nullable(),
    details: addressDetails,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (findProvince(v.details.provinceId)?.name !== v.delivery.province)
      ctx.addIssue({
        code: 'custom',
        path: ['details', 'provinceId'],
        message: 'Province does not match.',
      });
    if (
      v.details.localityKind === 'city' &&
      findCity(v.details.cityId ?? '')?.name !== v.delivery.city
    )
      ctx.addIssue({
        code: 'custom',
        path: ['details', 'cityId'],
        message: 'City does not match.',
      });
    if (deliveryAddressText(v.delivery, v.details).length > 2000)
      ctx.addIssue({
        code: 'custom',
        path: ['delivery', 'address'],
        message: 'The full delivery address including building details exceeds 2,000 characters.',
      });
  });
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
    details: addressDetails.optional(),
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
export function deliveryAddressText(delivery: { address: string }, details?: AddressDetails) {
  const building = details
    ? [
        details.localityKind === 'other'
          ? `شهرستان ${findCounty(details.countyId)?.name ?? ''}`
          : '',
        `پلاک ${details.plaque}`,
        details.unit ? `واحد ${details.unit}` : '',
      ]
        .filter(Boolean)
        .join('، ')
    : '';
  return building ? `${delivery.address}\n${building}` : delivery.address;
}
export function addressOrderFields(a: SavedAddress) {
  return {
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    province: a.delivery.province,
    city: a.delivery.city,
    address: deliveryAddressText(a.delivery, a.details),
    postalCode: a.delivery.postalCode,
  };
}
