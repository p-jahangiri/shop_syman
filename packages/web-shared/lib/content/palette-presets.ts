import {
  paletteRegions,
  sectionColor,
  type PaletteRegion,
  type PaletteTheme,
  type SitePalette,
} from './site-palette.ts';

type Recipe = Record<'primary' | PaletteRegion, string>;

function palette(light: Recipe, dark: Recipe): SitePalette {
  return {
    primaryLight: light.primary,
    primaryDark: dark.primary,
    heroLight: light.hero,
    heroDark: dark.hero,
    intensity: 'strong',
    sections: Object.fromEntries(
      paletteRegions.map((region) => [region, { light: light[region], dark: dark[region] }]),
    ),
  };
}

// Presets materialize existing editable CMS fields. They don't depend on the
// visitor's clock, a preset ID in SQL, or future changes to these recipes.
export const palettePresets = [
  {
    id: 'spring',
    label: 'بهار شکوفه',
    description: 'سبز بید، یاسی مه‌آلود و گلبهی',
    colors: palette(
      {
        primary: '#246755',
        canvas: '#f2f1e7',
        navigation: '#c4dbd0',
        hero: '#91c3ad',
        cards: '#a99bb9',
        promotions: '#d9aa9a',
        footer: '#a1b9aa',
      },
      {
        primary: '#8dd1b6',
        canvas: '#151c1a',
        navigation: '#33534b',
        hero: '#4c8d75',
        cards: '#725f82',
        promotions: '#a66f67',
        footer: '#355048',
      },
    ),
  },
  {
    id: 'summer',
    label: 'تابستان ساحلی',
    description: 'آبی دریا، سبزآبی آرام و شن طلایی',
    colors: palette(
      {
        primary: '#195892',
        canvas: '#eef2f3',
        navigation: '#aec8db',
        hero: '#77b7b7',
        cards: '#8dabcc',
        promotions: '#d6ac68',
        footer: '#91aabd',
      },
      {
        primary: '#8bc4ef',
        canvas: '#131c26',
        navigation: '#37566d',
        hero: '#3d7b86',
        cards: '#536e99',
        promotions: '#a78955',
        footer: '#344b60',
      },
    ),
  },
  {
    id: 'autumn',
    label: 'پاییز زعفرانی',
    description: 'آجری، شن گرم و سبز مریم‌گلی',
    colors: palette(
      {
        primary: '#923c28',
        canvas: '#f3ece2',
        navigation: '#d3baa2',
        hero: '#c38e64',
        cards: '#91a794',
        promotions: '#d2a069',
        footer: '#b19b87',
      },
      {
        primary: '#f1af89',
        canvas: '#211a16',
        navigation: '#624938',
        hero: '#946349',
        cards: '#4e6f5e',
        promotions: '#9d7949',
        footer: '#543d33',
      },
    ),
  },
  {
    id: 'winter',
    label: 'زمستان بلور',
    description: 'آبی یخی، سرمه‌ای دودی و مسی ملایم',
    colors: palette(
      {
        primary: '#465d93',
        canvas: '#edf1f6',
        navigation: '#a9bbdd',
        hero: '#86b8cf',
        cards: '#a799c0',
        promotions: '#d1ac8f',
        footer: '#9cacd0',
      },
      {
        primary: '#bacaf4',
        canvas: '#161c2b',
        navigation: '#3c5173',
        hero: '#527c9c',
        cards: '#655b87',
        promotions: '#9c7c70',
        footer: '#3d4a60',
      },
    ),
  },
  {
    id: 'sayman',
    label: 'امضای سایمان',
    description: 'زیتونی برند، عاجی، آبی دودی و مسی',
    colors: palette(
      {
        primary: '#405833',
        canvas: '#f0efe5',
        navigation: '#c8cfb6',
        hero: '#99ad7b',
        cards: '#a6aec3',
        promotions: '#cd9a6d',
        footer: '#a1ae92',
      },
      {
        primary: '#b3ca92',
        canvas: '#171d18',
        navigation: '#415142',
        hero: '#647f58',
        cards: '#56677c',
        promotions: '#9b6f56',
        footer: '#3f5244',
      },
    ),
  },
] as const;

export type PalettePresetId = (typeof palettePresets)[number]['id'];

const themes: readonly PaletteTheme[] = ['light', 'dark'];
const regions: readonly PaletteRegion[] = ['hero', ...paletteRegions];

export function copyPalettePreset(id: PalettePresetId): SitePalette {
  const preset = palettePresets.find((item) => item.id === id);
  if (!preset) throw new Error('Unknown palette preset.');
  return structuredClone(preset.colors);
}

export function matchingPalettePreset(value?: SitePalette): PalettePresetId | undefined {
  if (!value) return undefined;
  const match = palettePresets.find(
    ({ colors }) =>
      value.intensity === colors.intensity &&
      value.primaryLight?.toLowerCase() === colors.primaryLight &&
      value.primaryDark?.toLowerCase() === colors.primaryDark &&
      regions.every((region) =>
        themes.every(
          (theme) =>
            sectionColor(value, region, theme)?.toLowerCase() ===
            sectionColor(colors, region, theme),
        ),
      ),
  );
  return match?.id;
}
