import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const swc = require('next/dist/build/swc');
await swc.loadBindings();
type Form = { isConnected: boolean; checkValidity: () => boolean; requestSubmit: () => void };
type Event = { currentTarget: Form };
type FormNode = {
  props: {
    onChange: (event: Event) => void;
    onCompositionStart: () => void;
    onCompositionEnd: (event: Event) => void;
    onSubmit: (event: unknown) => void;
  };
};
function harness() {
  let current: (() => void) | undefined, cleanup: (() => void) | undefined;
  let submissions = 0;
  const exported: Record<string, unknown> = {};
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const code = swc.transformSync(
    fs.readFileSync(new URL('./admin-filters.tsx', import.meta.url), 'utf8'),
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
      if (name === 'react')
        return {
          useRef: (value: unknown) => ({ current: value }),
          useEffect: (effect: () => () => void) => {
            cleanup = effect();
          },
          useId: () => 'synthetic',
          useState: () => [false, () => undefined],
        };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'lucide-react') return {};
      throw Error('Unexpected module ' + name);
    },
    setTimeout(fn: () => void) {
      current = fn;
      return 1;
    },
    clearTimeout() {
      current = undefined;
    },
  });
  const component = exported.AdminFilterForm as (props: unknown) => FormNode;
  const node = component({ label: 'synthetic', onSubmit: () => submissions++ });
  const form: Form = {
    isConnected: true,
    checkValidity: () => true,
    requestSubmit: () => node.props.onSubmit({}),
  };
  return {
    node,
    form,
    tick() {
      const fn = current;
      current = undefined;
      fn?.();
    },
    cleanup: () => cleanup?.(),
    count: () => submissions,
  };
}
test('live filter debounces changes and does not submit incomplete IME text', () => {
  const h = harness(),
    event = { currentTarget: h.form };
  h.node.props.onChange(event);
  h.node.props.onChange(event);
  assert.equal(h.count(), 0);
  h.tick();
  assert.equal(h.count(), 1);
  h.node.props.onCompositionStart();
  h.node.props.onChange(event);
  h.tick();
  assert.equal(h.count(), 1);
  h.node.props.onCompositionEnd(event);
  h.tick();
  assert.equal(h.count(), 2);
});
test('invalid, detached or unmounted filters cannot issue a delayed request', () => {
  const h = harness(),
    event = { currentTarget: h.form };
  h.form.checkValidity = () => false;
  h.node.props.onChange(event);
  h.tick();
  assert.equal(h.count(), 0);
  h.form.checkValidity = () => true;
  h.form.isConnected = false;
  h.node.props.onChange(event);
  h.tick();
  assert.equal(h.count(), 0);
  h.form.isConnected = true;
  h.node.props.onChange(event);
  h.cleanup();
  h.tick();
  assert.equal(h.count(), 0);
});
