import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppearance, resolveAppearance } from '@sayman/web-shared/lib/content/appearance.ts';
import {
  resolveBrandColors,
  resolveStorefrontColors,
  storefrontColorVariables,
} from '@sayman/web-shared/lib/content/brand-colors.ts';
import {
  paletteIntensities,
  sitePaletteSchema,
} from '@sayman/web-shared/lib/content/site-palette.ts';
import {
  copyPalettePreset,
  matchingPalettePreset,
  palettePresets,
} from '@sayman/web-shared/lib/content/palette-presets.ts';
import { snapshotSchema } from '../lib/data/snapshot.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';

test('palette controls update automatic surfaces and isolate each theme override', () => {
  const input = sitePaletteSchema.parse({
    primaryLight: '#e83b55',
    primaryDark: '#9d8cff',
    intensity: 'strong',
    heroLight: '#f2e5fc',
    sections: { navigation: { light: '#def1ff' }, footer: { dark: '#000000' } },
  });
  const light = resolveStorefrontColors('light', input);
  const dark = resolveStorefrontColors('dark', input);
  const original = resolveStorefrontColors('light');
  const soft = resolveStorefrontColors('light', { ...input, intensity: 'soft' });
  assert.equal(light.regions.hero, '#f2e5fc');
  assert.equal(light.regions.navigation, '#def1ff');
  assert.notEqual(dark.regions.navigation, light.regions.navigation);
  assert.notEqual(dark.regions.footer, resolveStorefrontColors('dark').regions.footer);
  assert.notEqual(light.regions.footer, original.regions.footer);
  assert.notEqual(light.regions.cards, soft.regions.cards);
  assert.equal(light.regions.navigation, soft.regions.navigation);
  assert.notEqual(light.spotlight, original.spotlight);
});

test('published palette keeps documented sections and rejects CSS and unknown settings', () => {
  const withPalette = (palette: unknown) => ({
    ...storefrontSnapshot,
    site: { ...storefrontSnapshot.site, palette },
  });
  const palette = { sections: { cards: { light: '#ff0000', dark: '#ffffff' } } };
  const data = snapshotSchema.parse(withPalette(palette));
  assert.deepEqual(data.site.palette, palette);
  assert.notEqual(resolveStorefrontColors('light', data.site.palette).regions.cards, '#ff0000');
  assert.notEqual(resolveStorefrontColors('dark', data.site.palette).regions.cards, '#ffffff');
  for (const invalid of [
    { intensity: 'max' },
    { sections: { arbitrary: { light: '#ffffff' } } },
    { sections: { canvas: { light: 'var(--something)' } } },
    { sections: { footer: { custom: '#abcdef' } } },
    { sections: { footer: { dark: null } } },
  ])
    assert.equal(snapshotSchema.safeParse(withPalette(invalid)).success, false);
});

function luminance(color: string) {
  const rgb = [1, 3, 5].map((offset) => {
    const byte = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return byte <= 0.04045 ? byte / 12.92 : ((byte + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function ratio(color: string, background: string) {
  const a = luminance(color) + 0.05;
  const b = luminance(background) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}

test('identical or extreme CMS colors preserve page, card, and image boundaries in both themes', () => {
  const seeds = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#5b6f48', '#f7eedc'];
  for (const theme of ['light', 'dark'] as const) {
    for (const intensity of paletteIntensities) {
      for (const canvas of seeds) {
        for (const cards of seeds) {
          const p = resolveStorefrontColors(theme, {
            intensity,
            sections: { canvas: { [theme]: canvas }, cards: { [theme]: cards } },
          });
          const key = [theme, intensity, canvas, cards].join(' ');
          assert.ok(ratio(p.regions.canvas, p.regions.cards) >= 1.1, key);
          assert.ok(ratio(p.regions.cards, p.media) >= 1.07, key);
          for (const bg of [p.regions.canvas, p.regions.cards, p.media]) {
            assert.ok(ratio(p.edge, bg) >= 1.65, key);
            assert.ok(ratio(p.brand.accent, bg) >= 4.5, key);
          }
        }
      }
    }
  }
});

test('all seasonal presets save as editable colors in the existing CMS document', () => {
  assert.equal(matchingPalettePreset(undefined), undefined);
  assert.equal(palettePresets.length, 5);
  for (const { id, colors } of palettePresets) {
    const editable = copyPalettePreset(id);
    assert.deepEqual(sitePaletteSchema.parse(JSON.parse(JSON.stringify(editable))), colors);
    assert.equal(matchingPalettePreset(editable), id);
    assert.ok(editable.sections?.cards);
    editable.sections.cards.light = '#000000';
    assert.equal(matchingPalettePreset(editable), undefined);
    assert.notEqual(copyPalettePreset(id).sections?.cards?.light, '#000000');
  }
});

test('editorial roles and each seasonal palette retain variety, contrast and visible card edges', () => {
  for (const theme of ['light', 'dark'] as const) {
    const seasonHeroColors = new Set<string>();
    const seasonButtonColors = new Set<string>();
    for (const palette of [undefined, ...palettePresets.map(({ colors }) => colors)]) {
      const p = resolveStorefrontColors(theme, palette);
      assert.equal(new Set(p.lanes.map(({ media }) => media)).size, 5);
      assert.ok(new Set(p.lanes.map(({ body }) => body)).size >= 3);
      assert.notEqual(p.navTrack, p.regions.navigation);
      assert.notEqual(p.heroArt, p.regions.hero);
      assert.notEqual(p.promoWarm, p.promoCool);
      assert.ok(ratio(p.brand.accent, p.navTrack) >= 4.5);
      assert.ok(ratio(p.lanes[2].ink, p.promoWarm) >= 4.5);
      assert.ok(ratio(p.lanes[3].ink, p.promoCool) >= 4.5);
      assert.ok(ratio(p.heroInk, p.heroArt) >= 4.5 && ratio(p.heroInk, p.heroGlow) >= 4.5);
      assert.ok(ratio('#f7f7f5', p.footerBand) >= 4.5);
      assert.ok(ratio(p.brand.text, p.brand.fill) >= 4.5);
      for (const lane of p.lanes) {
        assert.ok(ratio(lane.body, p.regions.canvas) >= 1.1);
        assert.ok(ratio(lane.body, lane.media) >= 1.07);
        assert.ok(ratio(p.edge, lane.body) >= 1.65);
        assert.ok(ratio(lane.ink, lane.body) >= 4.5);
        assert.ok(ratio(lane.ink, lane.media) >= 4.5);
      }
      const css = storefrontColorVariables(theme, palette);
      assert.equal(css[`--shop-nav-track-${theme}`], p.navTrack);
      assert.equal(css[`--shop-tone-2-media-${theme}`], p.lanes[2].media);
      if (palette) {
        seasonHeroColors.add(p.heroArt);
        seasonButtonColors.add(p.brand.fill);
      }
    }
    assert.equal(seasonHeroColors.size, 5);
    assert.equal(seasonButtonColors.size, 5);
  }
});

test('brand fill stays exact and text, hover and accent keep contrast in either theme', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const fill of [
      '#ffffff',
      '#000000',
      '#767676',
      '#777777',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#aac282',
    ]) {
      const colors = resolveBrandColors(theme, fill);
      assert.equal(colors.fill, fill);
      assert.ok(ratio(colors.text, colors.fill) >= 4.5, theme + fill);
      assert.ok(ratio(colors.text, colors.hover) >= ratio(colors.text, colors.fill), theme + fill);
      assert.ok(
        ratio(colors.accent, theme === 'light' ? '#dfdfdf' : '#414141') >= 4.5,
        theme + fill,
      );
    }
  }
  assert.equal(resolveBrandColors('light', '#ffffff').text, '#000000');
  assert.equal(resolveBrandColors('dark', '#000000').text, '#ffffff');
  assert.equal(resolveBrandColors('light', '#ffffff\n').fill, resolveBrandColors('light').fill);
});

test('published content without appearance retains defaults and explicit false is preserved', () => {
  const snapshot = structuredClone(storefrontSnapshot);
  delete snapshot.site.appearance;
  const parsed = snapshotSchema.parse(snapshot);
  assert.deepEqual(resolveAppearance(parsed.site.appearance), defaultAppearance);
  assert.deepEqual(resolveAppearance({ surface: 'solid', motion: 'none', stickyHeader: false }), {
    ...defaultAppearance,
    surface: 'solid',
    motion: 'none',
    stickyHeader: false,
  });
  assert.equal(defaultAppearance.stickyHeader, true);
});

test('public appearance boundary rejects raw styles, unknown controls, null and invalid enums', () => {
  for (const appearance of [
    null,
    [],
    'glass',
    { surface: 'url(https://example.test/style)' },
    { motion: 'infinite' },
    { motionPreset: 'animation: infinite' },
    { motionPreset: null },
    { motionBanners: 'false' },
    { motionCards: 0 },
    { motionSidebar: null },
    { density: 'tiny' },
    { corners: 'square' },
    { heroLayout: 'html' },
    { stickyHeader: 'false' },
    { surface: null },
    { css: 'body { display: none; }' },
  ]) {
    const snapshot = { ...storefrontSnapshot, site: { ...storefrontSnapshot.site, appearance } };
    assert.equal(snapshotSchema.safeParse(snapshot).success, false, JSON.stringify(appearance));
  }
  assert.equal(
    snapshotSchema.safeParse({
      ...storefrontSnapshot,
      site: {
        ...storefrontSnapshot.site,
        font: 'noto-arabic',
        appearance: {
          ...defaultAppearance,
          motion: 'full',
          cards: 'editorial',
          navigation: 'pills',
        },
      },
    }).success,
    true,
  );
});

test('a published motion preset preserves explicitly disabled areas and accepts the older shape', () => {
  const published = {
    ...storefrontSnapshot,
    site: {
      ...storefrontSnapshot.site,
      appearance: {
        motion: 'full',
        motionPreset: 'ripple',
        motionBanners: true,
        motionCards: false,
        motionSidebar: false,
      },
    },
  };
  assert.deepEqual(resolveAppearance(snapshotSchema.parse(published).site.appearance), {
    ...defaultAppearance,
    motion: 'full',
    motionPreset: 'ripple',
    motionBanners: true,
    motionCards: false,
    motionSidebar: false,
  });
  assert.equal(resolveAppearance({ motion: 'none' }).motionPreset, 'lift');
  assert.equal(resolveAppearance({ motion: 'none' }).motion, 'none');
});
