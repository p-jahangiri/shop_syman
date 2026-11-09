import assert from 'node:assert/strict';
import test from 'node:test';
import { copyPalettePreset } from '@sayman/web-shared/lib/content/palette-presets.ts';
import {
  editPalette,
  paletteFor,
  selectPalette,
  selectedPalette,
  type PaletteSettings,
} from '../src/features/content/cms-palette-library.ts';

test('edits to separate presets survive switching and saving the shared draft', () => {
  const original = { palette: copyPalettePreset('spring') };
  const spring = editPalette(original, {
    ...original.palette,
    primaryLight: '#123456',
    sections: { cards: { dark: '#789abc' } },
  });
  const winter = selectPalette(spring, 'winter');
  const edited = editPalette(winter, { ...winter.palette, primaryDark: '#cbe1ff' });
  const saved = JSON.parse(JSON.stringify(edited)) as PaletteSettings;

  const back = selectPalette(saved, 'spring');
  assert.equal(selectedPalette(back), 'spring');
  assert.deepEqual(back.palette, spring.palette);
  assert.equal(paletteFor(back, 'winter')?.primaryDark, '#cbe1ff');
  assert.equal(selectPalette(back, 'spring'), back);
  assert.notEqual(copyPalettePreset('spring').primaryLight, '#123456');
});

test('store defaults and resetting one preset preserve the other edits and older custom colors', () => {
  const legacy = { palette: { primaryLight: '#112233' } };
  const spring = selectPalette(legacy, 'spring');
  const edit = editPalette(spring, { ...spring.palette, primaryLight: '#224466' });
  const defaults = selectPalette(edit, 'default');
  assert.equal(defaults.palette, undefined);
  assert.equal(paletteFor(defaults, 'spring')?.primaryLight, '#224466');
  assert.deepEqual(selectPalette(defaults, 'custom').palette, legacy.palette);

  const reset = editPalette(selectPalette(defaults, 'spring'), copyPalettePreset('spring'));
  assert.deepEqual(reset.palette, copyPalettePreset('spring'));
  assert.deepEqual(paletteFor(reset, 'custom'), legacy.palette);
});
