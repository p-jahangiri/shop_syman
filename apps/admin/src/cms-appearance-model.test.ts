import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import type { SiteAppearance } from '../../storefront/lib/types.ts';
import * as appearance from '../../storefront/lib/appearance.ts';
import * as model from './cms-appearance-model.ts';

test('appearance editing preserves omitted defaults and an explicitly disabled sticky header', () => {
  const original: SiteAppearance = { stickyHeader: false, surface: 'solid' };
  const updated = model.setAppearanceChoice(original, 'motion', 'none');
  assert.deepEqual(updated, { stickyHeader: false, surface: 'solid', motion: 'none' });
  assert.deepEqual(original, { stickyHeader: false, surface: 'solid' });
  assert.equal(Object.hasOwn(updated, 'heroLayout'), false);
  assert.equal(appearance.resolveAppearance(updated).stickyHeader, false);
  for (const invalid of ['', 'GLASS', 'url(https://bad.test)', 'none'])
    assert.throws(() => model.setAppearanceChoice(original, 'surface', invalid));
});

const require = createRequire(import.meta.url);
const swc = require('next/dist/build/swc');
await swc.loadBindings();
type Element = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function editor(value?: SiteAppearance) {
  const exported: Record<string, unknown> = {};
  const changes: (SiteAppearance | undefined)[] = [];
  const jsx = (type: unknown, props: Element['props']) => ({ type, props });
  const code = swc.transformSync(
    fs.readFileSync(new URL('./cms-appearance-editor.tsx', import.meta.url), 'utf8'),
    {
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        target: 'es2022',
        transform: { react: { runtime: 'automatic' } },
      },
      module: { type: 'commonjs' },
    },
  ).code;
  vm.runInNewContext(code, {
    exports: exported,
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '../../storefront/lib/appearance') return appearance;
      if (name === './cms-appearance-model') return model;
      if (name === './ui') return { Field: 'Field', Check: 'Check' };
      if (name === './cms-appearance.css') return {};
      throw new Error('Unexpected module ' + name);
    },
  });
  const component = exported.CmsAppearanceEditor as (props: unknown) => Element;
  const tree = component({
    value,
    name: 'سایمان',
    onChange: (v?: SiteAppearance) => changes.push(v),
  });
  const nodes: Element[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object' && 'props' in value) {
      const node = value as Element;
      nodes.push(node);
      visit(node.props.children);
    }
  }
  visit(tree);
  return { nodes, changes };
}

test('the actual editor uses shared defaults and every finite design option reaches the draft', () => {
  const view = editor();
  const controls = view.nodes.filter((node) => node.type === 'select');
  assert.equal(controls.length, 5);
  for (const [index, choice] of model.appearanceChoices.entries()) {
    const control = controls[index];
    assert.equal(control.props.value, appearance.defaultAppearance[choice.key]);
    for (const option of choice.options) {
      (control.props.onChange as (event: unknown) => void)({ target: { value: option.value } });
      const result = view.changes.at(-1)!;
      assert.equal(result[choice.key], option.value);
      assert.deepEqual(Object.keys(result), [choice.key]);
    }
  }
  const checkbox = view.nodes.find((node) => node.type === 'Check')!;
  assert.equal(checkbox.props.checked, true);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.equal(view.changes.at(-1)?.stickyHeader, false);
});

test('the actual preview follows persisted appearance and reset removes only the design override', () => {
  const value: SiteAppearance = {
    surface: 'solid',
    density: 'compact',
    corners: 'soft',
    motion: 'none',
    heroLayout: 'compact',
    stickyHeader: false,
  };
  const view = editor(value);
  const preview = view.nodes.find((node) => node.props.className === 'cms-appearance-canvas')!;
  assert.equal(preview.props['data-surface'], 'solid');
  assert.equal(preview.props['data-density'], 'compact');
  assert.equal(preview.props['data-corners'], 'soft');
  assert.equal(preview.props['data-motion'], 'none');
  assert.equal(preview.props['data-hero-layout'], 'compact');
  const checkbox = view.nodes.find((node) => node.type === 'Check')!;
  assert.equal(checkbox.props.checked, false);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  assert.deepEqual(structuredClone(view.changes.at(-1)), { ...value, stickyHeader: true });
  const reset = view.nodes.find((node) => node.type === 'button')!;
  (reset.props.onClick as () => void)();
  assert.equal(view.changes.at(-1), undefined);
  assert.deepEqual(appearance.resolveAppearance(view.changes.at(-1)), appearance.defaultAppearance);
  assert.equal(value.stickyHeader, false);
});
