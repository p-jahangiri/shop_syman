import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveAppearance } from '@sayman/web-shared/lib/content/appearance.ts';
import { resolveStorefrontColors } from '@sayman/web-shared/lib/content/brand-colors.ts';
import {
  generateDesignPalette,
  neutralTemperatures,
  paletteHarmonies,
} from '@sayman/web-shared/lib/content/design-palette-generator.ts';
import { readDesignTransfer } from '@sayman/web-shared/lib/content/design-transfer.ts';
import { palettePresets } from '@sayman/web-shared/lib/content/palette-presets.ts';
import {
  editableSiteDesign,
  designTemplateIds,
  resolveSiteDesign,
  siteDesignSchema,
} from '@sayman/web-shared/lib/content/site-design.ts';
import { sitePaletteSchema } from '@sayman/web-shared/lib/content/site-palette.ts';

test('the storefront and API accept the same versioned design fixture', () => {
  const fixture = new URL(
    '../../../backend/tests/Shop.Tests/Fixtures/site-design-contract.json',
    import.meta.url,
  );
  const cases = JSON.parse(readFileSync(fixture, 'utf8')) as { valid: boolean; value: unknown }[];
  for (const { valid, value } of cases)
    assert.equal(siteDesignSchema.safeParse(value).success, valid, JSON.stringify(value));
});

test('legacy appearance round-trips and the template never controls used inventory', () => {
  const old = {
    appearance: { surface: 'solid', cards: 'editorial', showUsedProducts: false } as const,
    font: 'noto-arabic' as const,
  };
  assert.deepEqual(
    resolveSiteDesign({ ...old, design: editableSiteDesign(old) }),
    resolveSiteDesign(old),
  );
  assert.deepEqual(resolveSiteDesign(old).appearance, resolveAppearance(old.appearance));
  const design = siteDesignSchema.parse({
    schemaVersion: 1,
    template: 'technology',
    theme: 'dark',
    overrides: { layout: { cards: 'classic' } },
  });
  const next = resolveSiteDesign({ ...old, design });
  assert.equal(next.appearance.cards, 'classic');
  assert.equal(next.appearance.navigation, 'pills');
  assert.equal(next.appearance.showUsedProducts, false);
  assert.equal(next.theme, 'dark');
});

test('templates resolve to distinct combinations and generated palettes fit both themes', () => {
  const variants = designTemplateIds.map((template) =>
    resolveSiteDesign({ design: { schemaVersion: 1, template } }),
  );
  assert.equal(
    new Set(variants.map((entry) => JSON.stringify(entry))).size,
    designTemplateIds.length,
  );
  assert.ok(palettePresets.length >= 10);
  for (const brand of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080']) {
    for (const harmony of paletteHarmonies) {
      for (const neutral of neutralTemperatures) {
        const result = generateDesignPalette(brand, harmony, neutral);
        assert.ok(sitePaletteSchema.safeParse(result).success);
        assert.notEqual(result.primaryLight, result.primaryDark);
        for (const theme of ['light', 'dark'] as const)
          assert.ok(resolveStorefrontColors(theme, result).brand.ratio >= 4.5);
      }
    }
  }
  const blue = '#2244cc';
  assert.notDeepEqual(
    generateDesignPalette(blue, 'analogous', 'cool'),
    generateDesignPalette(blue, 'triadic', 'warm'),
  );
});

test('portable design retains block order, content and IDs, rejecting duplicate and unsafe blocks', () => {
  const file = {
    format: 'sayman-store-design',
    schemaVersion: 1,
    design: { schemaVersion: 1, template: 'editorial' },
    homeBlocks: [
      { id: 'p', kind: 'products', enabled: true, title: 'پیشنهادها', productIds: ['sku1'] },
      { id: 'b', kind: 'brands', enabled: false },
    ],
  };
  assert.deepEqual(readDesignTransfer(JSON.stringify(file)), file);
  assert.throws(() =>
    readDesignTransfer(
      JSON.stringify({ ...file, homeBlocks: [file.homeBlocks[0], file.homeBlocks[0]] }),
    ),
  );
  assert.throws(() =>
    readDesignTransfer(
      JSON.stringify({ ...file, homeBlocks: [{ ...file.homeBlocks[0], href: '//evil.test' }] }),
    ),
  );
  assert.throws(() => readDesignTransfer(JSON.stringify({ ...file, nav: [] })));
});
