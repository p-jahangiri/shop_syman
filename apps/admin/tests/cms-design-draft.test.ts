import assert from 'node:assert/strict';
import test from 'node:test';
import { copyPalettePreset } from '@sayman/web-shared/lib/content/palette-presets.ts';
import { resolveSiteDesign, type SiteDesign } from '@sayman/web-shared/lib/content/site-design.ts';
import type { DesignTransfer } from '@sayman/web-shared/lib/content/design-transfer.ts';
import type { HomeBlock } from '@sayman/web-shared/lib/shared/types.ts';
import {
  editableHomeBlocks,
  importDesignPatch,
  unavailableBlockCategories,
  updateAppearance,
  type DesignDraft,
} from '../src/features/content/cms-design-draft.ts';
import { paletteFor } from '../src/features/content/cms-palette-library.ts';

test('changing one option retains manual values that match the current template', () => {
  const design: SiteDesign = {
    schemaVersion: 1,
    template: 'technology',
    overrides: { layout: { cards: 'outline' }, motion: { motionPreset: 'ripple' } },
  };
  const patch = updateAppearance({ design }, { stickyHeader: false });
  const selected = patch.design!;
  assert.equal(selected.overrides?.layout?.cards, 'outline');
  assert.equal(selected.overrides?.motion?.motionPreset, 'ripple');
  assert.equal(selected.overrides?.layout?.stickyHeader, false);

  const next = resolveSiteDesign({ design: { ...selected, template: 'signature' } });
  assert.equal(next.appearance.cards, 'outline');
  assert.equal(next.appearance.motionPreset, 'ripple');
});

test('a legacy edit keeps other appearance choices and separates used stock', () => {
  const draft: DesignDraft = { appearance: { cards: 'editorial', showUsedProducts: false } };
  const patched = { ...draft, ...updateAppearance(draft, { motionCards: false }) };
  assert.equal(resolveSiteDesign(patched).appearance.cards, 'editorial');
  assert.equal(resolveSiteDesign(patched).appearance.motionCards, false);
  assert.equal(patched.appearance?.showUsedProducts, false);
  assert.deepEqual(updateAppearance(draft, { showUsedProducts: true }), {
    appearance: { cards: 'editorial', showUsedProducts: true },
  });
});

const file: DesignTransfer = {
  format: 'sayman-store-design',
  schemaVersion: 1,
  design: { schemaVersion: 1, template: 'minimal' },
  palette: copyPalettePreset('spring'),
  homeBlocks: [],
};

test('the import applies only the reviewed parts and treats a deliberate empty home as an edit', () => {
  const draft: DesignDraft = { homeBlocks: editableHomeBlocks() };
  assert.deepEqual(importDesignPatch(draft, file, { appearance: false, blocks: true }), {
    homeBlocks: [],
  });
  const appearance = importDesignPatch(draft, file, { appearance: true, blocks: false });
  assert.equal(appearance.paletteLibrary?.selected, 'spring');
  assert.equal(Object.hasOwn(appearance, 'homeBlocks'), false);
  assert.deepEqual(importDesignPatch(draft, file, { appearance: false, blocks: false }), {});
  assert.deepEqual(editableHomeBlocks([]), []);
});

test('applying a preset file never replaces existing manual colors for that preset', () => {
  const edited = { ...copyPalettePreset('spring'), primaryLight: '#123456' };
  const draft: DesignDraft = {
    palette: edited,
    paletteLibrary: { selected: 'spring', alternatives: {} },
  };
  const patch = importDesignPatch(draft, file, { appearance: true, blocks: true });
  assert.equal(patch.paletteLibrary?.selected, 'custom');
  assert.deepEqual(paletteFor(patch, 'spring'), edited);
  assert.deepEqual(patch.palette, file.palette);
});

test('import review flags missing category references without rewriting file content', () => {
  const known: HomeBlock = { id: 'known', kind: 'products', enabled: true, categoryId: 'ABCD' };
  const missing: HomeBlock = { ...known, id: 'missing', categoryId: 'other' };
  assert.deepEqual(unavailableBlockCategories([known, missing], ['abcd']), [missing]);
});
