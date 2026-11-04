import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';

export type TestElement = { type: unknown; props: Record<string, unknown> };
export function uiElements(value: unknown): TestElement[] {
  if (Array.isArray(value)) return value.flatMap(uiElements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as TestElement;
  return [node, ...uiElements(node.props.children)];
}
export function uiText(value: unknown): string {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(uiText).join('');
  return typeof value === 'object'
    ? 'props' in value
      ? uiText((value as TestElement).props.children)
      : ''
    : String(value);
}
// Execute actual TSX handlers/effects with deterministic in-memory hooks. This
// harness makes no browser, API or SQL calls and does not claim browser QA.
export function digitalUiHarness(
  file: string,
  mocks: Record<string, unknown>,
  globals: Record<string, unknown> = {},
  extra = '',
) {
  let cursor = 0,
    dirty = true,
    active = true,
    element: unknown;
  const slots: unknown[] = [],
    effects: { deps: unknown[]; cleanup?: () => void }[] = [],
    pending: (() => void)[] = [];
  const react = {
    useId: () => 'digital-ui-test-id',
    // Deferred children are inspected through their own component harnesses.
    lazy: (_load: unknown) => 'DeferredComponent',
    Suspense: 'Suspense',
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (next: unknown) => {
          if (!active) return;
          const value = typeof next === 'function' ? next(slots[index]) : next;
          if (!Object.is(value, slots[index])) {
            slots[index] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(factory: () => unknown, deps: unknown[]): unknown {
      const index = cursor++,
        previous = slots[index] as { deps: unknown[]; value: unknown } | undefined;
      if (
        !previous ||
        previous.deps.length !== deps.length ||
        deps.some((item, i) => !Object.is(item, previous.deps[i]))
      )
        slots[index] = { deps: [...deps], value: factory() };
      return (slots[index] as { value: unknown }).value;
    },
    useCallback(callback: unknown, deps: unknown[]): unknown {
      return react.useMemo(() => callback, deps);
    },
    useEffect(callback: () => void | (() => void), deps: unknown[] = []) {
      const index = cursor++,
        previous = effects[index];
      if (
        previous &&
        previous.deps.length === deps.length &&
        deps.every((x, i) => Object.is(x, previous.deps[i]))
      )
        return;
      pending.push(() => {
        previous?.cleanup?.();
        const cleanup = callback();
        effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
      });
    },
    useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) {
      cursor++;
      return snapshot();
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const all = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_target, name) => String(name) }),
    ...mocks,
  };
  const compiled = swc.transformSync(fs.readFileSync(file, 'utf8') + '\n' + extra, {
    jsc: {
      target: 'es2022',
      parser: { syntax: 'typescript', tsx: true },
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  const exports: Record<string, (p: Record<string, unknown>) => unknown> = {};
  vm.runInNewContext(
    compiled.code,
    {
      exports,
      require: (name: string) => {
        if (!(name in all)) throw Error('Missing digital UI mock: ' + name);
        return all[name as keyof typeof all];
      },
      AbortController,
      TextEncoder,
      Intl,
      Date,
      JSON,
      crypto,
      structuredClone,
      ...globals,
    },
    { filename: file },
  );
  let component: (p: Record<string, unknown>) => unknown, props: Record<string, unknown>;
  function paint() {
    cursor = 0;
    dirty = false;
    element = component(props);
    return element;
  }
  return {
    mount(name: string, initial: Record<string, unknown>) {
      component = exports[name];
      props = initial;
      return paint();
    },
    tree: () => element,
    rerender(next = props) {
      props = next;
      dirty = true;
      return paint();
    },
    async settle() {
      for (let n = 0; n < 20; n++) {
        if (dirty) paint();
        while (pending.length) pending.shift()!();
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!dirty && !pending.length) return element;
      }
      throw Error('Digital UI did not settle');
    },
    unmount() {
      active = false;
      for (const effect of effects) effect?.cleanup?.();
    },
  };
}
