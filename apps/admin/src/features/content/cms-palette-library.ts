import {
  copyPalettePreset,
  matchingPalettePreset,
  type PalettePresetId,
} from '@sayman/web-shared/lib/content/palette-presets.ts';
import type { SitePalette } from '@sayman/web-shared/lib/content/site-palette.ts';

type EditablePalette = PalettePresetId | 'custom';
export type PaletteChoice = EditablePalette | 'default';
export type PaletteSettings = {
  palette?: SitePalette;
  paletteLibrary?: {
    selected: PaletteChoice;
    alternatives: Partial<Record<EditablePalette, SitePalette>>;
  };
};

export function selectedPalette(settings: PaletteSettings): PaletteChoice {
  return (
    settings.paletteLibrary?.selected ??
    matchingPalettePreset(settings.palette) ??
    (settings.palette ? 'custom' : 'default')
  );
}

export function paletteFor(settings: PaletteSettings, choice: PaletteChoice) {
  if (choice === selectedPalette(settings)) return settings.palette;
  if (choice === 'default') return undefined;
  return (
    settings.paletteLibrary?.alternatives[choice] ??
    (choice === 'custom' ? undefined : copyPalettePreset(choice))
  );
}

export function selectPalette(settings: PaletteSettings, choice: PaletteChoice): PaletteSettings {
  const previous = selectedPalette(settings);
  if (previous === choice) return settings;
  const palette = paletteFor(settings, choice);
  if (choice === 'custom' && !palette) return settings;

  const alternatives = { ...settings.paletteLibrary?.alternatives };
  if (previous !== 'default' && settings.palette) alternatives[previous] = settings.palette;
  if (choice !== 'default') delete alternatives[choice];

  return { palette, paletteLibrary: { selected: choice, alternatives } };
}

export function editPalette(settings: PaletteSettings, palette: SitePalette): PaletteSettings {
  const previous = selectedPalette(settings);
  return {
    palette,
    paletteLibrary: {
      selected: previous === 'default' ? 'custom' : previous,
      alternatives: settings.paletteLibrary?.alternatives ?? {},
    },
  };
}
