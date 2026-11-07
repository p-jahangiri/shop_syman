import { validProductVideoUrl } from '../catalog/product-video.ts';
import { usedConditionSchema } from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';
import { storeIdentitySchema } from '@sayman/web-shared/lib/content/store-identity.ts';
import { sitePaletteSchema } from '@sayman/web-shared/lib/content/site-palette.ts';
import { motionPresets } from '@sayman/web-shared/lib/content/appearance.ts';
import { publicImageUrlSchema } from '@sayman/web-shared/lib/media/public-image-url.ts';
import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import type { MenuItem, MoneyRial } from '@sayman/web-shared/lib/shared/types.ts';
const money = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n)
  .transform((v) => v as MoneyRial);
const optionalMoney = money.nullish().transform((v) => v ?? undefined);
const attributes = z.record(z.string(), z.string());
const menu: z.ZodType<MenuItem> = z.lazy(() =>
  z.object({
    label: z.string().max(150),
    purchaseMethodKind: z.enum(['online', 'cheque', 'installment']).optional(),
    href: z
      .string()
      .startsWith('/')
      // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
      .refine((v) => !v.startsWith('//') && !v.includes('\\') && !/[\x00-\x1f]/.test(v)),
    children: z.array(menu).max(50).optional(),
  }),
);
const internalPath = z
  .string()
  .startsWith('/')
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  .refine((v) => !v.startsWith('//') && !v.includes('\\') && !/[\x00-\x1f]/.test(v));
const imagePath = publicImageUrlSchema;
export const homeBlockSchema = z
  .object({
    id: z.string().max(64),
    kind: z.enum([
      'categories',
      'collection',
      'promotions',
      'products',
      'spotlight',
      'brands',
      'cheque',
    ]),
    enabled: z.boolean(),
    purchaseMethodKind: z.enum(['online', 'cheque', 'installment']).optional(),
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    action: z.string().optional(),
    href: internalPath.optional(),
    categoryId: z.string().optional(),
    limit: z.number().int().min(1).max(24).optional(),
    productIds: z.array(z.string().max(64)).max(24).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    items: z
      .array(
        z.object({
          eyebrow: z.string(),
          purchaseMethodKind: z.enum(['online', 'cheque', 'installment']).optional(),
          title: z.string(),
          action: z.string(),
          href: internalPath,
          image: imagePath,
          watermark: z.string().optional(),
        }),
      )
      .max(6)
      .optional(),
  })
  .refine((b) => new Set(b.productIds).size === (b.productIds?.length ?? 0))
  .refine((b) => !b.startsAt || !b.endsAt || Date.parse(b.startsAt) < Date.parse(b.endsAt))
  .refine(
    (b) => b.kind !== 'spotlight' || !b.enabled || Boolean(b.title?.trim() && b.productIds?.length),
  );
export const snapshotSchema = z.object({
  version: z.literal(1),
  isPreview: z.boolean(),
  dataSource: z.enum(['api', 'fixture']).optional(),
  locale: z.enum(['fa', 'en']).optional(),
  site: z.object({
    storeIdentity: storeIdentitySchema.optional(),
    seo: z
      .object({
        title: z.string().max(150).optional(),
        description: z.string().max(400).optional(),
        shareImage: imagePath
          .max(2048)
          .refine((v) => {
            try {
              return (
                // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
                !/[?#\\\x00-\x20]/.test(v) &&
                (!v.startsWith('https:') || (!new URL(v).username && !new URL(v).password))
              );
            } catch {
              return false;
            }
          })
          .optional(),
        allowIndexing: z.boolean().optional(),
      })
      .strict()
      .optional(),
    name: z.string(),
    latinName: z.string(),
    tagline: z.string(),
    announcement: z.string(),
    chequeDisclaimer: z.string(),
    about: z.string(),
    hero: z.object({
      purchaseMethodKind: z.enum(['online', 'cheque', 'installment']).optional(),
      eyebrow: z.string(),
      title: z.string(),
      description: z.string(),
      action: z.string(),
      secondary: z.string(),
      image: imagePath.optional(),
      actionHref: internalPath.optional(),
      secondaryHref: internalPath.optional(),
      visualTitle: z.string().optional(),
      floatingTitle: z.string().optional(),
      floatingDescription: z.string().optional(),
      footnote: z.string().optional(),
    }),
    nav: z.array(menu).max(50),
    homeBlocks: z.array(homeBlockSchema).max(20).optional(),
    logoUrl: imagePath.optional(),
    font: z.enum(['vazirmatn', 'noto-arabic', 'system']).optional(),
    appearance: z
      .object({
        surface: z.enum(['glass', 'solid']).optional(),
        density: z.enum(['comfortable', 'compact']).optional(),
        corners: z.enum(['soft', 'rounded']).optional(),
        motion: z.enum(['subtle', 'full', 'none']).optional(),
        motionPreset: z.enum(motionPresets).optional(),
        motionBanners: z.boolean().optional(),
        motionCards: z.boolean().optional(),
        motionSidebar: z.boolean().optional(),
        cards: z.enum(['classic', 'outline', 'editorial']).optional(),
        navigation: z.enum(['links', 'pills']).optional(),
        heroLayout: z.enum(['split', 'compact']).optional(),
        stickyHeader: z.boolean().optional(),
        showUsedProducts: z.boolean().optional(),
      })
      .strict()
      .optional(),
    palette: sitePaletteSchema.optional(),
    contact: z
      .object({
        phone: z.string().max(32).optional(),
        email: z.email().optional(),
        address: z.string().max(1000).optional(),
        hours: z.string().max(200).optional(),
      })
      .optional(),
  }),
  products: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      englishName: z.string(),
      category: z.string(),
      brand: z.string(),
      description: z.string(),
      image: imagePath,
      images: z.array(imagePath).max(24).optional(),
      videos: z
        .array(
          z.object({
            url: z.string().refine(validProductVideoUrl),
            variantId: z.string().max(64).nullish(),
          }),
        )
        .max(8)
        .optional(),
      badge: z
        .string()
        .nullish()
        .transform((v) => v ?? undefined),
      isDigital: z.boolean().optional(),
      featured: z.boolean().optional(),
      attributes,
      variants: z
        .array(
          z.object({
            usedCondition: usedConditionSchema.optional(),
            id: z.string(),
            sku: z.string(),
            label: z.string(),
            color: z.string(),
            colorName: z.string(),
            priceRial: money,
            compareAtRial: optionalMoney,
            stock: z.number().int().nonnegative(),
            warranty: z.string(),
            attributes: attributes.optional(),
            purchaseMethodIds: z
              .array(z.string())
              .nullish()
              .transform((v) => v ?? undefined),
          }),
        )
        .min(1),
      purchaseMethodIds: z.array(z.string()),
      chequePlanIds: z.array(z.string()).optional(),
    }),
  ),
  categories: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      description: z.string(),
      image: imagePath,
      filters: z.array(z.object({ key: z.string(), label: z.string() })),
      attributeRules: z
        .array(
          z.object({
            key: z.string(),
            comparable: z.boolean(),
            showInSpecs: z.boolean(),
            variantAxis: z.boolean(),
          }),
        )
        .optional(),
    }),
  ),
  chequePlans: z.array(
    z
      .object({
        roundingUnitRial: z.enum(['1', '10']).optional(),
        id: z.string(),
        name: z.string().optional(),
        months: z.number().int().min(1).max(60),
        markupPercent: z
          .number()
          .min(0)
          .max(1000)
          .refine((v) => /^\d{1,4}(?:\.\d{1,2})?$/.test(String(v))),
        downPaymentPercent: z
          .number()
          .min(0)
          .max(100)
          .refine((v) => /^\d{1,3}(?:\.\d{1,2})?$/.test(String(v))),
        intervalMonths: z.number().int().min(1).max(60),
        enabled: z.boolean().optional(),
        categoryIds: z.array(z.string()).optional(),
        minAmountRial: optionalMoney,
        maxAmountRial: optionalMoney,
      })
      .refine((p) => p.months % p.intervalMonths === 0),
  ),
  purchaseMethods: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['online', 'cheque', 'installment']),
      name: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      requiresApproval: z.boolean(),
      categoryIds: z.array(z.string()).optional(),
      minAmountRial: optionalMoney,
      maxAmountRial: optionalMoney,
    }),
  ),
  authSettings: z.object({
    mobileOtp: z.boolean(),
    emailPassword: z.boolean(),
    usernamePassword: z.boolean(),
    registration: z.boolean(),
    passwordReset: z.boolean(),
  }),
  attributeDefinitions: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      dataType: z.enum(['text', 'number', 'bool', 'select', 'multiSelect']),
      unit: z
        .string()
        .nullish()
        .transform((v) => v ?? undefined),
      comparable: z.boolean(),
      filterable: z.boolean(),
      showInSpecs: z.boolean().optional(),
    }),
  ),
  attributeLabels: attributes,
});
