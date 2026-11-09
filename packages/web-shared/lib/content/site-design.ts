import { z } from '../config/schema-runtime.ts';
import type { SiteAppearance } from '../shared/types.ts';
import { defaultAppearance, motionPresets, resolveAppearance } from './appearance.ts';
import type { PalettePresetId } from './palette-presets.ts';

export const designFonts = ['vazirmatn', 'noto-arabic', 'system'] as const;
export const designThemes = ['system', 'light', 'dark'] as const;
export const designTemplateIds = [
  'signature',
  'minimal',
  'technology',
  'warm',
  'editorial',
  'marketplace',
  'luxury',
] as const;
export type DesignTemplateId = (typeof designTemplateIds)[number];

const layoutSchema = z.strictObject({
  surface: z.enum(['glass', 'solid']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  corners: z.enum(['soft', 'rounded']).optional(),
  cards: z.enum(['classic', 'outline', 'editorial']).optional(),
  navigation: z.enum(['links', 'pills']).optional(),
  heroLayout: z.enum(['split', 'compact']).optional(),
  stickyHeader: z.boolean().optional(),
});
const motionSchema = z.strictObject({
  motion: z.enum(['subtle', 'full', 'none']).optional(),
  motionPreset: z.enum(motionPresets).optional(),
  motionBanners: z.boolean().optional(),
  motionCards: z.boolean().optional(),
  motionSidebar: z.boolean().optional(),
});
const typographySchema = z.strictObject({ font: z.enum(designFonts).optional() });

export const siteDesignSchema = z.strictObject({
  schemaVersion: z.literal(1),
  template: z.enum(designTemplateIds),
  theme: z.enum(designThemes).optional(),
  overrides: z
    .strictObject({
      layout: layoutSchema.optional(),
      motion: motionSchema.optional(),
      typography: typographySchema.optional(),
    })
    .optional(),
});
export type SiteDesign = z.infer<typeof siteDesignSchema>;

type Template = {
  label: string;
  description: string;
  palette: PalettePresetId;
  font: (typeof designFonts)[number];
  appearance: SiteAppearance;
};
export const designTemplates: Record<DesignTemplateId, Template> = {
  signature: {
    label: 'امضای سایمان',
    description: 'چیدمان آشنا با کارت کلاسیک و حرکت ملایم',
    palette: 'sayman',
    font: 'vazirmatn',
    appearance: {},
  },
  minimal: {
    label: 'مینیمال روشن',
    description: 'سطح ساده، فضای باز و جلوه‌های خاموش',
    palette: 'linen',
    font: 'vazirmatn',
    appearance: { surface: 'solid', corners: 'soft', heroLayout: 'compact', motion: 'none' },
  },
  technology: {
    label: 'فناوری تیره',
    description: 'کارت قاب‌دار، منوی کپسولی و موج نور',
    palette: 'midnight',
    font: 'system',
    appearance: {
      surface: 'solid',
      density: 'compact',
      cards: 'outline',
      navigation: 'pills',
      motionPreset: 'ripple',
      motion: 'full',
    },
  },
  warm: {
    label: 'گرم و صمیمی',
    description: 'فضای باز، منوی کپسولی و بالاآمدن نرم کارت',
    palette: 'autumn',
    font: 'noto-arabic',
    appearance: { navigation: 'pills', motionSidebar: false },
  },
  editorial: {
    label: 'مجله‌ای',
    description: 'تصویر لب‌به‌لب، ویترین باز و هدر معمولی',
    palette: 'iris',
    font: 'noto-arabic',
    appearance: {
      surface: 'solid',
      cards: 'editorial',
      corners: 'soft',
      stickyHeader: false,
      motion: 'none',
    },
  },
  marketplace: {
    label: 'بازارچهٔ پرتراکم',
    description: 'کارت‌های فشرده و دسترسی سریع از هدر',
    palette: 'coastline',
    font: 'vazirmatn',
    appearance: { density: 'compact', cards: 'outline', heroLayout: 'compact', motion: 'none' },
  },
  luxury: {
    label: 'لوکس',
    description: 'تصویر بزرگ، فضای باز و درخشش آرام قاب',
    palette: 'copper',
    font: 'noto-arabic',
    appearance: { cards: 'editorial', corners: 'soft', motionPreset: 'glow', motionCards: false },
  },
};

type DesignSource = {
  design?: SiteDesign;
  appearance?: SiteAppearance;
  font?: (typeof designFonts)[number];
};
export function resolveSiteDesign(site: DesignSource) {
  const design = site.design;
  if (!design)
    return {
      appearance: resolveAppearance(site.appearance),
      font: site.font ?? 'vazirmatn',
      theme: 'system' as const,
    };
  const template = designTemplates[design.template];
  return {
    appearance: resolveAppearance({
      ...template.appearance,
      ...design.overrides?.layout,
      ...design.overrides?.motion,
      showUsedProducts: site.appearance?.showUsedProducts,
    }),
    font: design.overrides?.typography?.font ?? template.font,
    theme: design.theme ?? 'system',
  };
}

export function appearanceOverrides(
  appearance: SiteAppearance | undefined,
  template: DesignTemplateId,
) {
  const candidate = resolveAppearance(appearance);
  const base = { ...defaultAppearance, ...designTemplates[template].appearance };
  const differences = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) => key !== 'showUsedProducts' && value !== base[key as keyof SiteAppearance],
    ),
  );
  return {
    layout: layoutSchema.strip().parse(differences),
    motion: motionSchema.strip().parse(differences),
  };
}

export function editableSiteDesign(site: DesignSource): SiteDesign {
  if (site.design) return site.design;
  return {
    schemaVersion: 1,
    template: 'signature',
    overrides: {
      ...appearanceOverrides(site.appearance, 'signature'),
      ...(site.font && site.font !== 'vazirmatn' && { typography: { font: site.font } }),
    },
  };
}
