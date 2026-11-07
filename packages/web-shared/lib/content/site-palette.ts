import { z } from '../config/schema-runtime.ts';

export const paletteRegions = ['canvas', 'navigation', 'cards', 'promotions', 'footer'] as const;
export const paletteIntensities = ['soft', 'balanced', 'strong'] as const;
export type PaletteRegion = (typeof paletteRegions)[number] | 'hero';
export type PaletteTheme = 'light' | 'dark';

const color = z
  .string()
  .length(7)
  .regex(/^#[0-9a-f]{6}$/i);
const themedColor = z.strictObject({ light: color.optional(), dark: color.optional() });

export const sitePaletteSchema = z.strictObject({
  primaryLight: color.optional(),
  primaryDark: color.optional(),
  heroLight: color.optional(),
  heroDark: color.optional(),
  intensity: z.enum(paletteIntensities).optional(),
  sections: z.partialRecord(z.enum(paletteRegions), themedColor).optional(),
});

export type SitePalette = z.infer<typeof sitePaletteSchema>;

export function sectionColor(
  palette: SitePalette | undefined,
  section: PaletteRegion,
  theme: PaletteTheme,
) {
  if (section === 'hero') return theme === 'light' ? palette?.heroLight : palette?.heroDark;
  return palette?.sections?.[section]?.[theme];
}
