import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import * as contract from './media-contract.ts';

// The real editor is compiled in memory. Hooks and transport are synthetic;
// these tests do not authenticate, contact a service or persist an image.
const require = createRequire(import.meta.url),
  swc = require('next/dist/build/swc');
await swc.loadBindings();
type Element = { type: unknown; props: Record<string, unknown> };
type Handler = (event?: unknown) => unknown;
const capability = {
  configured: true,
  maxBytes: 8 * 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  publicImagesOnly: true,
};
function issuedImage(id = 'a'.repeat(32)) {
  return {
    id,
    url: `/media/catalog/${id}/card.webp`,
    variants: (['thumb', 'card', 'zoom'] as const).map((name) => ({
      name,
      url: `/media/catalog/${id}/${name}.webp`,
      width: 16,
      height: 16,
      bytes: 20,
      sha256: 'b'.repeat(64),
    })),
  };
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
async function flush() {
  for (let i = 0; i < 6; i++) await setImmediate();
}
function elements(value: unknown): Element[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  const node = value as Element;
  return node.props ? [node, ...elements(node.props.children)] : [];
}
function text(value: unknown): string {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(text).join('');
  return typeof value === 'object' ? text((value as Element).props?.children) : String(value);
}
function field(tree: Element, label: string) {
  const node = elements(tree).find((v) => v.props['aria-label'] === label);
  assert.ok(node, 'Missing field ' + label);
  return node;
}
function button(tree: Element, label: string) {
  const node = elements(tree).find((v) => v.type === 'button' && text(v) === label);
  assert.ok(node, 'Missing button ' + label);
  return node;
}
function change(node: Element, value: unknown) {
  assert.equal(typeof node.props.onChange, 'function');
  (node.props.onChange as Handler)({ target: { value } });
}
function click(node: Element) {
  assert.equal(typeof node.props.onClick, 'function');
  return (node.props.onClick as Handler)();
}
function file(name = 'synthetic.png', type = 'image/png', bytes = 16) {
  return new File([new Uint8Array(bytes)], name, { type });
}
class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function harness(options: { value?: string[]; disabled?: boolean; max?: number } = {}) {
  const values: unknown[] = [],
    cleanups: (() => void)[] = [],
    effects = new Set<number>(),
    requests: { path: string; init: RequestInit }[] = [],
    changes: string[][] = [],
    busy: boolean[] = [];
  let cursor = 0,
    disposed = false,
    lateStateWrites = 0,
    transport: (path: string, init: RequestInit) => Promise<unknown> = async () => issuedImage();
  const props = {
    value: options.value ?? [],
    disabled: options.disabled ?? false,
    max: options.max ?? 24,
    onChange(value: string[]) {
      changes.push(Array.from(value));
      props.value = Array.from(value);
    },
    onBusy(value: boolean) {
      busy.push(value);
    },
  };
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [
        values[index],
        (next: unknown) => {
          if (disposed) lateStateWrites++;
          values[index] = typeof next === 'function' ? next(values[index]) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      return (values[index] ??= { current: initial });
    },
    useEffect(effect: () => (() => void) | undefined) {
      const index = cursor++;
      if (effects.has(index)) return;
      effects.add(index);
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    },
  };
  const jsx = (type: unknown, childProps: Record<string, unknown>) => ({ type, props: childProps }),
    exported: Record<string, unknown> = {},
    code = swc.transformSync(fs.readFileSync(new URL('./media.tsx', import.meta.url), 'utf8'), {
      filename: 'media.tsx',
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        target: 'es2022',
        transform: { react: { runtime: 'automatic' } },
      },
      module: { type: 'commonjs' },
    }).code;
  const mocks: Record<string, unknown> = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': {},
    '@tanstack/react-query': {
      useQuery: () => ({
        data: contract.readImageCapabilities(capability),
        isPending: false,
        refetch() {},
      }),
    },
    './media-contract': contract,
    './api': {
      ApiError,
      api(path: string, init: RequestInit = {}) {
        requests.push({ path, init });
        return transport(path, init);
      },
    },
  };
  vm.runInNewContext(code, {
    exports: exported,
    require(name: string) {
      assert.ok(name in mocks, 'Unexpected module ' + name);
      return mocks[name];
    },
    AbortController,
    FormData,
    Error,
  });
  return {
    props,
    requests,
    changes,
    busy,
    transport(value: typeof transport) {
      transport = value;
    },
    render() {
      cursor = 0;
      return (exported.ImageEditor as (props: unknown) => Element)(props);
    },
    upload(tree: Element, files: File[]) {
      const input = elements(tree).find((v) => v.type === 'input' && v.props.type === 'file');
      assert.ok(input);
      const target = { files, value: 'synthetic-selected-file' };
      (input.props.onChange as Handler)({ target });
      assert.equal(target.value, '');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    },
    lateStateWrites: () => lateStateWrites,
  };
}

test('actual image editor accepts one issued response and blocks duplicate same-tick upload events', async () => {
  const h = harness(),
    pending = deferred<unknown>(),
    image = issuedImage();
  h.transport(async () => pending.promise);
  try {
    const tree = h.render();
    h.upload(tree, [file()]);
    h.upload(tree, [file('second.png')]);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].path, '/admin/media/images');
    assert.equal(h.requests[0].init.method, 'POST');
    assert.ok(h.requests[0].init.body instanceof FormData);
    assert.equal((h.requests[0].init.body as FormData).get('file') instanceof File, true);
    assert.deepEqual(h.busy, [true]);
    pending.resolve(image);
    await flush();
    assert.deepEqual(h.changes, [[image.url]]);
    assert.deepEqual(h.busy, [true, false]);
  } finally {
    h.dispose();
  }
});

test('unmount aborts the request, clears parent busy and suppresses a late upload result', async () => {
  const h = harness(),
    pending = deferred<unknown>();
  h.transport(async () => pending.promise);
  h.upload(h.render(), [file()]);
  const signal = h.requests[0].init.signal;
  assert.ok(signal);
  h.dispose();
  assert.equal(signal.aborted, true);
  assert.deepEqual(h.busy, [true, false]);
  pending.resolve(issuedImage());
  await flush();
  assert.deepEqual(h.changes, []);
  assert.deepEqual(h.busy, [true, false]);
  assert.equal(h.lateStateWrites(), 0);
});

test('unmount releases the latest parent busy callback after a rerender', async () => {
  const h = harness(),
    pending = deferred<unknown>(),
    latest: boolean[] = [];
  h.transport(async () => pending.promise);
  h.upload(h.render(), [file()]);
  h.props.onBusy = (busy: boolean) => latest.push(busy);
  h.render();
  h.dispose();
  pending.reject(new Error('Synthetic abort completion'));
  await flush();
  assert.deepEqual(h.busy, [true]);
  assert.deepEqual(latest, [false]);
  assert.equal(h.lateStateWrites(), 0);
});

test('disabling an editor blocks manual, upload, reorder and deletion actions', async () => {
  const h = harness({ value: ['/products/phone.svg', '/products/laptop.svg'], disabled: true });
  try {
    let tree = h.render();
    h.upload(tree, [file()]);
    change(field(tree, 'نشانی عمومی تصویر'), 'https://images.example.test/phone.webp');
    tree = h.render();
    click(button(tree, 'افزودن'));
    click(field(tree, 'پایین بردن تصویر 1'));
    click(field(tree, 'حذف تصویر 1 از فرم'));
    for (const node of elements(tree).filter(
      (v) => v.type === 'input' || (v.type === 'button' && v.props['aria-label']),
    ))
      assert.equal(node.props.disabled, true);
    await flush();
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.changes, []);
  } finally {
    h.dispose();
  }
});

test('a parent upload lock does not abort the same upload when disabled becomes true', async () => {
  const h = harness(),
    pending = deferred<unknown>(),
    image = issuedImage();
  h.transport(async () => pending.promise);
  try {
    h.upload(h.render(), [file()]);
    h.props.disabled = true;
    const tree = h.render();
    assert.equal(h.requests[0].init.signal?.aborted, false);
    assert.equal(field(tree, 'آپلود تصاویر کالا').props.disabled, true);
    pending.resolve(image);
    await flush();
    assert.deepEqual(h.changes, [[image.url]]);
    assert.deepEqual(h.busy, [true, false]);
  } finally {
    h.dispose();
  }
});

test('same-tick stale manual, reorder and delete handlers cannot change a running upload batch', async () => {
  const original = ['/products/phone.svg', '/products/laptop.svg'],
    h = harness({ value: original }),
    pending = deferred<unknown>(),
    image = issuedImage();
  h.transport(async () => pending.promise);
  try {
    change(field(h.render(), 'نشانی عمومی تصویر'), 'https://images.example.test/manual.webp');
    const staleTree = h.render();
    h.upload(staleTree, [file()]);
    click(button(staleTree, 'افزودن'));
    click(field(staleTree, 'پایین بردن تصویر 1'));
    click(field(staleTree, 'حذف تصویر 1 از فرم'));
    assert.deepEqual(h.changes, []);
    pending.resolve(image);
    await flush();
    assert.deepEqual(h.changes, [[...original, image.url]]);
  } finally {
    h.dispose();
  }
});

test('invalid file types, empty and oversized files and batch capacity fail before upload', async () => {
  for (const files of [
    [file('animation.gif', 'image/gif')],
    [file('empty.png', 'image/png', 0)],
    [file('large.png', 'image/png', capability.maxBytes + 1)],
    [file('one.png'), file('two.png')],
  ]) {
    const h = harness({ max: 1 });
    try {
      h.upload(h.render(), files);
      await flush();
      assert.equal(h.requests.length, 0);
      assert.deepEqual(h.changes, []);
      assert.deepEqual(h.busy, []);
      assert.ok(elements(h.render()).some((v) => v.props.role === 'alert'));
    } finally {
      h.dispose();
    }
  }
});

test('a failed second upload preserves the first issued image and never attempts the remaining batch', async () => {
  const original = '/products/phone.svg',
    h = harness({ value: [original] }),
    image = issuedImage();
  let count = 0;
  h.transport(async () => {
    if (++count === 1) return image;
    throw new ApiError(503, 'media_unavailable', 'Synthetic scanner unavailable');
  });
  try {
    h.upload(h.render(), [file('first.png'), file('second.png'), file('third.png')]);
    await flush();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.changes, [[original, image.url]]);
    assert.deepEqual(h.props.value, [original, image.url]);
    const tree = h.render();
    assert.match(
      text(elements(tree).find((v) => v.props.role === 'alert')),
      /Synthetic scanner unavailable/,
    );
    assert.deepEqual(h.busy, [true, false]);
  } finally {
    h.dispose();
  }
});

test('malformed upload success cannot add an unissued or private image URL', async () => {
  for (const raw of [
    { ...issuedImage(), url: 'https://untrusted.example/forged.webp' },
    { ...issuedImage(), variants: [] },
    { ...issuedImage(), url: '/api/private-files/secret' },
  ]) {
    const h = harness();
    h.transport(async () => raw);
    try {
      h.upload(h.render(), [file()]);
      await flush();
      assert.deepEqual(h.changes, []);
      assert.match(
        text(elements(h.render()).find((v) => v.props.role === 'alert')),
        /پاسخ ذخیرهٔ تصویر معتبر نیست/,
      );
      assert.deepEqual(h.busy, [true, false]);
    } finally {
      h.dispose();
    }
  }
});

test('manual credential-bearing and malformed media URLs are rejected without a request', () => {
  const h = harness();
  try {
    for (const url of [
      'https://user:secret@images.example.test/a.webp',
      '/media/private/a.webp',
      '/products/../private.webp',
    ]) {
      change(field(h.render(), 'نشانی عمومی تصویر'), url);
      click(button(h.render(), 'افزودن'));
      assert.deepEqual(h.changes, []);
    }
    assert.equal(h.requests.length, 0);
    const image = issuedImage();
    change(field(h.render(), 'نشانی عمومی تصویر'), image.url);
    click(button(h.render(), 'افزودن'));
    assert.deepEqual(h.changes, [[image.url]]);
  } finally {
    h.dispose();
  }
});

test('media contracts bound capabilities, exact issued variants and preview URL ownership', () => {
  assert.equal(contract.readImageCapabilities(capability).configured, true);
  for (const invalid of [
    { ...capability, maxBytes: 8 * 1024 * 1024 + 1 },
    { ...capability, contentTypes: [] },
    { ...capability, contentTypes: ['image/svg+xml'] },
    { ...capability, contentTypes: ['image/png', 'image/png'] },
    { ...capability, publicImagesOnly: false },
  ])
    assert.throws(() => contract.readImageCapabilities(invalid));
  const image = issuedImage();
  assert.equal(contract.readUploadedImage(image).url, image.url);
  const invalidImages = [
    { ...image, id: 'A'.repeat(32) },
    { ...image, url: image.url + '?token=private' },
    { ...image, variants: [image.variants[0], image.variants[0], image.variants[2]] },
    {
      ...image,
      variants: image.variants.map((v) => ({ ...v, url: v.url.replace(image.id, 'c'.repeat(32)) })),
    },
    { ...image, variants: image.variants.map((v) => ({ ...v, bytes: 8 * 1024 * 1024 + 1 })) },
    { ...image, variants: image.variants.map((v) => ({ ...v, width: 8193 })) },
    { ...image, variants: image.variants.map((v) => ({ ...v, sha256: 'B'.repeat(64) })) },
  ];
  for (const invalid of invalidImages) assert.throws(() => contract.readUploadedImage(invalid));
  assert.equal(contract.imagePreviewUrl(image.url), `/api/media/catalog/${image.id}/thumb.webp`);
  assert.equal(contract.imagePreviewUrl('/api/private-files/a'), undefined);
  assert.equal(
    contract.imagePreviewUrl('https://images.example.test/a.webp?width=800'),
    'https://images.example.test/a.webp?width=800',
  );
  assert.equal(contract.validEditorImageUrl('https://images.example.test/a.webp', false), false);
});
