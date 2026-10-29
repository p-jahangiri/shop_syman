import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppearance, resolveAppearance } from './appearance.ts';
import { snapshotSchema } from './snapshot.ts';
import { storefrontSnapshot } from './fixtures.ts';

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
      site: { ...storefrontSnapshot.site, appearance: defaultAppearance },
    }).success,
    true,
  );
});
