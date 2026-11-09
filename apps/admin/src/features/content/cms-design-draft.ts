import { defaultHomeBlocks } from '@sayman/web-shared/lib/content/home-blocks-contract.ts';
import { editableSiteDesign, type SiteDesign } from '@sayman/web-shared/lib/content/site-design.ts';
import type { DesignTransfer } from '@sayman/web-shared/lib/content/design-transfer.ts';
import type {
  HomeBlock,
  SiteAppearance,
  SiteContent,
} from '@sayman/web-shared/lib/shared/types.ts';
import { matchingPalettePreset } from '@sayman/web-shared/lib/content/palette-presets.ts';
import {
  paletteFor,
  replaceCustomPalette,
  selectPalette,
  type PaletteSettings,
} from './cms-palette-library.ts';

export type DesignDraft = PaletteSettings & {
  design?: SiteDesign;
  appearance?: SiteAppearance;
  font?: SiteContent['font'];
  homeBlocks?: HomeBlock[];
};

export function editableHomeBlocks(blocks?: HomeBlock[]) {
  return blocks ?? defaultHomeBlocks('دنیای دیجیتال تو');
}

export function updateAppearance(draft: DesignDraft, patch: SiteAppearance): Partial<DesignDraft> {
  const {
    showUsedProducts,
    motion,
    motionPreset,
    motionBanners,
    motionCards,
    motionSidebar,
    ...layout
  } = patch;
  if (showUsedProducts !== undefined)
    return { appearance: { ...draft.appearance, showUsedProducts } };
  const motionPatch = Object.fromEntries(
    Object.entries({ motion, motionPreset, motionBanners, motionCards, motionSidebar }).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const design = editableSiteDesign(draft);
  return {
    design: {
      ...design,
      overrides: {
        ...design.overrides,
        ...(Object.keys(layout).length && { layout: { ...design.overrides?.layout, ...layout } }),
        ...(Object.keys(motionPatch).length && {
          motion: { ...design.overrides?.motion, ...motionPatch },
        }),
      },
    },
  };
}

export type DesignImportScope = { appearance: boolean; blocks: boolean };

export function importDesignPatch(
  draft: DesignDraft,
  file: DesignTransfer,
  scope: DesignImportScope,
): Partial<DesignDraft> {
  const patch: Partial<DesignDraft> = {};
  if (scope.appearance) {
    patch.design = file.design;
    const preset = matchingPalettePreset(file.palette);
    // Applying the file must not overwrite a separately edited named preset.
    const palette = !file.palette
      ? selectPalette(draft, 'default')
      : preset && matchingPalettePreset(paletteFor(draft, preset)) === preset
        ? selectPalette(draft, preset)
        : replaceCustomPalette(draft, file.palette);
    patch.palette = palette.palette;
    patch.paletteLibrary = palette.paletteLibrary;
  }
  if (scope.blocks && file.homeBlocks !== undefined) patch.homeBlocks = file.homeBlocks;
  return patch;
}

export function unavailableBlockCategories(blocks: HomeBlock[], categoryIds: readonly string[]) {
  const known = new Set(categoryIds.map((id) => id.toLowerCase()));
  return blocks.filter((block) => block.categoryId && !known.has(block.categoryId.toLowerCase()));
}
