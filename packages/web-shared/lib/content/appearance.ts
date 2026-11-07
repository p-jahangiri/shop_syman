import type { SiteAppearance } from '../shared/types.ts';

export const motionPresets = ['lift', 'glow', 'ripple'] as const satisfies readonly NonNullable<
  SiteAppearance['motionPreset']
>[];

export const defaultAppearance: Readonly<Required<SiteAppearance>> = Object.freeze({
  surface: 'glass',
  density: 'comfortable',
  corners: 'rounded',
  motion: 'subtle',
  motionPreset: 'lift',
  motionBanners: true,
  motionCards: true,
  motionSidebar: true,
  cards: 'classic',
  navigation: 'links',
  heroLayout: 'split',
  stickyHeader: true,
  showUsedProducts: true,
});

// Called only with a validated CMS snapshot; undefined keys retain accessible defaults.
export function resolveAppearance(value?: SiteAppearance): Required<SiteAppearance> {
  return {
    surface: value?.surface ?? defaultAppearance.surface,
    density: value?.density ?? defaultAppearance.density,
    corners: value?.corners ?? defaultAppearance.corners,
    motion: value?.motion ?? defaultAppearance.motion,
    motionPreset: value?.motionPreset ?? defaultAppearance.motionPreset,
    motionBanners: value?.motionBanners ?? defaultAppearance.motionBanners,
    motionCards: value?.motionCards ?? defaultAppearance.motionCards,
    motionSidebar: value?.motionSidebar ?? defaultAppearance.motionSidebar,
    cards: value?.cards ?? defaultAppearance.cards,
    navigation: value?.navigation ?? defaultAppearance.navigation,
    heroLayout: value?.heroLayout ?? defaultAppearance.heroLayout,
    stickyHeader: value?.stickyHeader ?? defaultAppearance.stickyHeader,
    showUsedProducts: value?.showUsedProducts ?? defaultAppearance.showUsedProducts,
  };
}

export function isUsedCatalogHref(href: string): boolean {
  const [path, search] = href.split('#', 1)[0].split('?', 2);
  return (
    /^\/(?:fa\/|en\/)?catalog\/?$/.test(path) &&
    new URLSearchParams(search).getAll('condition').includes('used')
  );
}
