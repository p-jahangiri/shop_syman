import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import type { SiteAppearance } from '@sayman/web-shared/lib/shared/types.ts';
import * as appearance from '@sayman/web-shared/lib/content/appearance.ts';
import * as model from '../src/features/content/cms-appearance-model.ts';

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

type Element = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function editor(value?: SiteAppearance) {
  const exported: Record<string, unknown> = {};
  const changes: (SiteAppearance | undefined)[] = [];
  let previewState: unknown;
  const jsx = (type: unknown, props: Element['props']) => ({ type, props });
  const code = swc.transformSync(
    fs.readFileSync(
      new URL('../src/features/content/cms-appearance-editor.tsx', import.meta.url),
      'utf8',
    ),
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
      if (name === 'react')
        return {
          useState(initial: unknown) {
            previewState ??= initial;
            return [
              previewState,
              (update: (previous: unknown) => unknown) => {
                previewState = update(previewState);
              },
            ];
          },
        };
      if (name === '@sayman/web-shared/lib/content/appearance.ts') return appearance;
      if (name === './cms-appearance-model') return model;
      if (name === '../../components/ui') return { Field: 'Field', Check: 'Check' };
      if (name === '../../styles/content/cms-appearance.css') return {};
      throw new Error('Unexpected module ' + name);
    },
  });
  const component = exported.CmsAppearanceEditor as (props: unknown) => Element;
  function render(nextValue = value) {
    const tree = component({
      value: nextValue,
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
    return nodes;
  }
  return { nodes: render(), changes, render };
}

test('the actual editor uses shared defaults and every finite design option reaches the draft', () => {
  const view = editor();
  const controls = view.nodes.filter((node) => node.type === 'select');
  assert.equal(controls.length, model.appearanceChoices.length);
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
  const checkbox = view.nodes.find(
    (node) => node.props.label === 'هدر هنگام پیمایش در دسترس بماند',
  )!;
  assert.equal(checkbox.props.checked, true);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.equal(view.changes.at(-1)?.stickyHeader, false);
});

test('the actual preview follows persisted appearance and reports a patch for the edited option', () => {
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
  const checkbox = view.nodes.find(
    (node) => node.props.label === 'هدر هنگام پیمایش در دسترس بماند',
  )!;
  assert.equal(checkbox.props.checked, false);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  assert.deepEqual(structuredClone(view.changes.at(-1)), { stickyHeader: true });
  assert.equal(value.stickyHeader, false);
});

test('motion preview starts on request and reflects independent scope switches', () => {
  const draft: SiteAppearance = { motionPreset: 'ripple', motionCards: false };
  const view = editor(draft);
  const canvas = (nodes: Element[]) =>
    nodes.find((node) => node.props.className === 'cms-appearance-canvas')!.props;
  const replay = view.nodes.find((node) => node.props.children === 'پخش نمونهٔ حرکت')!;
  assert.equal(canvas(view.nodes)['data-preview-motion'], false);
  assert.equal(canvas(view.nodes)['data-motion-preset'], 'ripple');
  assert.equal(canvas(view.nodes)['data-motion-cards'], false);
  assert.equal(canvas(view.nodes)['data-motion-banners'], true);
  assert.equal(canvas(view.nodes)['data-motion-sidebar'], true);
  (replay.props.onClick as () => void)();
  assert.equal(canvas(view.render())['data-preview-motion'], true);
  assert.equal(view.changes.length, 0);

  const sidebar = view.nodes.find((node) => node.props.label === 'پنل فیلتر')!;
  (sidebar.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.deepEqual(structuredClone(view.changes.at(-1)), { motionSidebar: false });
  const switched = view.render({ ...draft, ...view.changes.at(-1) });
  assert.equal(canvas(switched)['data-motion-sidebar'], false);
  assert.equal(canvas(switched)['data-preview-motion'], false);
  const stopped = view.render({ ...draft, motion: 'none' });
  assert.equal(canvas(stopped)['data-preview-motion'], false);
  assert.equal(
    stopped.some((node) => node.props.children === 'پخش نمونهٔ حرکت'),
    false,
  );
});
