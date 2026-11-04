import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import * as contract from '../src/api/contracts/finance/finance-contract.ts';
import * as money from '../src/utils/finance-inputs.ts';
import type { PurchaseMethod } from '../src/types/types.ts';

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const jsx = (type: unknown, props: Element['props']) => ({ type, props });

function compile(file: string, modules: Record<string, unknown>) {
  const exported: Record<string, unknown> = {};
  const code = swc.transformSync(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  }).code;
  vm.runInNewContext(code, {
    exports: exported,
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (Object.hasOwn(modules, name)) return modules[name];
      throw Error('Unexpected module ' + name);
    },
  });
  return exported;
}

function elements(root: unknown) {
  const result: Element[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object' && 'props' in value) {
      const node = value as Element;
      result.push(node);
      visit(node.props.children);
    }
  }
  visit(root);
  return result;
}

const dependency = compile('../src/features/content/cms-purchase-dependency-field.tsx', {
  '../../components/ui': { Field: 'Field' },
}).CmsPurchaseDependencyField as (props: {
  value?: PurchaseMethod['kind'];
  label?: string;
  onChange: (value: PurchaseMethod['kind'] | undefined) => void;
}) => Element;

test('the actual dependency field defaults to no extra condition and offers exactly the three purchase kinds', () => {
  const changes: (PurchaseMethod['kind'] | undefined)[] = [];
  const nodes = elements(dependency({ onChange: (value) => changes.push(value) }));
  const control = nodes.find((node) => node.type === 'select')!;
  assert.equal(control.props.value, '');
  assert.deepEqual(
    nodes.filter((node) => node.type === 'option').map((node) => node.props.value),
    ['', 'online', 'cheque', 'installment'],
  );
  assert.equal(changes.length, 0, 'rendering a draft must not silently set a dependency');
  for (const kind of ['online', 'cheque', 'installment'] as const) {
    (control.props.onChange as (event: unknown) => void)({ target: { value: kind } });
    assert.equal(changes.at(-1), kind);
  }
});

test('the actual dependency field restores a stored selection and clearing it omits metadata instead of writing null', () => {
  const original = {
    title: 'محتوای سفارشی',
    enabled: false,
    purchaseMethodKind: 'cheque' as const,
  };
  const updates: Record<string, unknown>[] = [];
  const nodes = elements(
    dependency({
      value: original.purchaseMethodKind,
      label: 'وابستگی پرسش ۲',
      onChange: (purchaseMethodKind) => updates.push({ ...original, purchaseMethodKind }),
    }),
  );
  assert.equal(nodes[0].props.label, 'وابستگی پرسش ۲');
  const control = nodes.find((node) => node.type === 'select')!;
  assert.equal(control.props.value, 'cheque');
  (control.props.onChange as (event: unknown) => void)({ target: { value: '' } });
  const updated = updates.at(-1)!;
  assert.equal(updated.purchaseMethodKind, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(updated)), {
    title: original.title,
    enabled: false,
  });
  assert.equal(original.purchaseMethodKind, 'cheque');
});

const method: PurchaseMethod = {
  id: 'cheque-one',
  version: 'AAAAAAAAAAE=',
  kind: 'cheque',
  nameFa: 'روش چکی',
  nameEn: 'Cheque method',
  descriptionFa: '',
  descriptionEn: '',
  enabled: true,
  requiresApproval: true,
  minAmountRial: '9007199254740993',
  maxAmountRial: '9223372036854775807',
  categories: [],
};

function methodEditor({ readOnly = false, pending = false } = {}) {
  const requests: { path: string; options: { method: string; body: string } }[] = [];
  const values: unknown[] = [];
  let cursor = 0;
  const exported = compile('../src/features/finance/finance-forms.tsx', {
    react: {
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in values)) values[index] = { current: initial };
        return values[index];
      },
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in values)) values[index] = initial;
        return [
          values[index],
          (value: unknown) =>
            (values[index] = typeof value === 'function' ? value(values[index]) : value),
        ];
      },
    },
    '@tanstack/react-query': {
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
      useMutation: (options: { mutationFn: (value: unknown) => unknown }) => ({
        isPending: pending,
        mutate: (value: unknown) => options.mutationFn(value),
      }),
    },
    '../../api/api': {
      api(path: string, options: { method: string; body: string }) {
        requests.push({ path, options });
        return Promise.resolve({ id: method.id });
      },
      ApiError: class extends Error {},
    },
    '../../components/ui': { Check: 'Check', ErrorBox: 'ErrorBox', Field: 'Field' },
    '../../components/forms/forms': { Text: 'Text', Area: 'Area' },
    '../../types/types': { nameOf: () => '' },
    '../../api/contracts/finance/finance-contract': contract,
    '../../utils/finance-inputs': money,
    './finance-review-box': { FinanceReviewBox: 'FinanceReviewBox' },
    '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
  });
  const form = exported.MethodForm as (props: unknown) => Element;
  function render() {
    cursor = 0;
    return form({
      item: method,
      catalog: { categories: [], products: [], attributes: [], brands: [] },
      readOnly,
      onClose() {},
    });
  }
  return { render, requests };
}

test('the actual global-method switch edits only the draft, then saves the fresh CAS version and exact rial limits', () => {
  const view = methodEditor();
  const initial = view.render();
  const toggle = elements(initial).find((node) => node.props.role === 'switch')!;
  assert.equal(toggle.props.checked, true);
  (toggle.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.equal(view.requests.length, 0, 'a switch event must not send an unversioned row mutation');
  const changed = view.render();
  assert.equal(
    elements(changed).find((node) => node.props.role === 'switch')!.props.checked,
    false,
  );
  (changed.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  assert.equal(view.requests.length, 0, 'review step must not write');
  const review = elements(view.render()).find((node) => node.type === 'FinanceReviewBox')!;
  const confirm = review.props.onConfirm as () => void;
  confirm();
  confirm();
  assert.equal(view.requests.length, 1, 'duplicate confirm must not write twice');
  assert.equal(view.requests[0].path, '/admin/purchase-methods/cheque-one');
  assert.equal(view.requests[0].options.method, 'PUT');
  const payload = JSON.parse(view.requests[0].options.body);
  assert.equal(payload.version, method.version);
  assert.equal(payload.enabled, false);
  assert.equal(payload.requiresApproval, true);
  assert.equal(payload.minAmountRial, method.minAmountRial);
  assert.equal(payload.maxAmountRial, method.maxAmountRial);
  assert.equal(method.enabled, true);
});

test('the actual method form locks the switch for read-only or in-flight views and blocks submission', () => {
  for (const options of [{ readOnly: true }, { pending: true }]) {
    const view = methodEditor(options);
    const tree = view.render();
    const guard = elements(tree).find((node) => node.props.className === 'finance-fields')!;
    assert.equal(guard.type, 'fieldset');
    assert.equal(guard.props.disabled, true);
    (tree.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    assert.equal(view.requests.length, 0);
  }
});
