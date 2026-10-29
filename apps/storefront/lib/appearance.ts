import type { SiteAppearance } from './types.ts';

export const defaultAppearance: Readonly<Required<SiteAppearance>> = Object.freeze({
  surface: 'glass',
  density: 'comfortable',
  corners: 'rounded',
  motion: 'subtle',
  heroLayout: 'split',
  stickyHeader: true,
});

// Called only with a validated CMS snapshot; undefined keys retain accessible defaults.
export function resolveAppearance(value?: SiteAppearance): Required<SiteAppearance> {
  return {
    surface: value?.surface ?? defaultAppearance.surface,
    density: value?.density ?? defaultAppearance.density,
    corners: value?.corners ?? defaultAppearance.corners,
    motion: value?.motion ?? defaultAppearance.motion,
    heroLayout: value?.heroLayout ?? defaultAppearance.heroLayout,
    stickyHeader: value?.stickyHeader ?? defaultAppearance.stickyHeader,
  };
}
