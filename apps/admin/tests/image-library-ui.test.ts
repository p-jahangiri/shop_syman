import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '../src/api/contracts/media/image-library-contract.ts';
import * as media from '../src/api/contracts/media/media-contract.ts';
import type {
  ImageLibraryItem,
  ImageLibraryPage,
} from '../src/api/contracts/media/image-library-contract.ts';

const at = '2026-10-31T10:00:00.1234567Z';
function item(id = 'a'.repeat(32)): ImageLibraryItem {
  return {
    id,
    url: `/media/catalog/${id}/card.webp`,
    createdAt: at,
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
function page(full = false): ImageLibraryPage {
  return {
    schemaVersion: 1,
    asOfAt: at,
    pageSize: 24,
    items: full
      ? Array.from({ length: 24 }, (_, i) => item((255 - i).toString(16).padStart(32, '0')))
      : [item()],
    nextCursor: full ? 'next_page' : null,
  };
}
type Query = {
  queryKey: unknown[];
  enabled: boolean;
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
  gcTime: number;
  placeholderData?: unknown;
  retry: boolean;
};
function setup() {
  let options: Query,
    revision = 0,
    retries = 0;
  let transport: (path: string, init: { signal: AbortSignal }) => Promise<unknown> = async () =>
    page();
  const views = new Map<string, Record<string, unknown>>(),
    selected: ImageLibraryItem[] = [],
    requests: string[] = [];
  const props = {
    id: 'library-inline',
    value: [] as string[],
    max: 24,
    disabled: false,
    onClose() {},
    onSelect: (image: ImageLibraryItem) => {
      selected.push(image);
      return true;
    },
  };
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/features/media/image-library.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {
        useQuery: (value: Query) => {
          options = value;
          return (
            views.get(JSON.stringify(value.queryKey)) ?? {
              isPending: true,
              isFetching: true,
              refetch() {
                retries++;
              },
            }
          );
        },
      },
      '../../components/forms/persian-date-field': { PersianDateField: 'PersianDateField' },
      '../../api/api': {
        api: (path: string, init: { signal: AbortSignal }) => {
          requests.push(path);
          return transport(path, init);
        },
      },
      '../../auth/admin-view-authority': { adminViewRevision: () => revision },
      '../../api/contracts/media/image-library-contract': contract,
      '../../api/contracts/media/media-contract': media,
      '../../styles/media/image-library.css': {},
      '../../components/ui': { Busy: 'Busy', ErrorBox: 'ErrorBox', Field: 'Field' },
    },
  );
  h.mount('ImageLibrary', props);
  const node = (type: string, label?: string) => {
    const found = uiElements(h.tree()).find(
      (v) =>
        v.type === type &&
        (!label ||
          uiText(v) === label ||
          v.props['aria-label'] === label ||
          v.props.label === label),
    );
    assert.ok(found, type + ': ' + label);
    return found;
  };
  const control = (label: string) => {
    const picker = uiElements(h.tree()).find(
      (v) => v.type === 'PersianDateField' && v.props.label === label,
    );
    if (picker) return picker;
    const found = uiElements(node('Field', label).props.children).find((v) => v.type === 'input');
    assert.ok(found);
    return found;
  };
  return {
    h,
    props,
    selected,
    requests,
    node,
    control,
    options: () => options,
    retries: () => retries,
    accept(data?: ImageLibraryPage, error?: Error) {
      views.set(JSON.stringify(options.queryKey), {
        data,
        error,
        isPending: false,
        isFetching: false,
        refetch() {
          retries++;
        },
      });
      h.rerender(props);
    },
    rerender() {
      h.rerender(props);
    },
    setRevision(value: number) {
      revision = value;
    },
    setTransport(value: typeof transport) {
      transport = value;
    },
    click(label: string) {
      (node('button', label).props.onClick as () => void)();
    },
    change(label: string, value: string) {
      (control(label).props.onChange as (event: unknown) => void)(
        control(label).type === 'PersianDateField' ? value : { target: { value } },
      );
    },
  };
}
test('inline library uses current issued thumb previews and explicit card selection without nesting a form or dialog', async () => {
  const x = setup();
  await x.h.settle();
  x.accept(page());
  await x.h.settle();
  assert.ok(!uiElements(x.h.tree()).some((v) => v.type === 'form' || v.type === 'dialog'));
  const image = x.node('img');
  assert.equal(image.props.src, '/api/media/catalog/' + item().id + '/thumb.webp');
  assert.equal(image.props.loading, 'lazy');
  assert.ok(
    uiElements(x.h.tree()).some((v) => v.props.role === 'region' && v.props.tabIndex === 0),
  );
  x.click('انتخاب تصویر ' + item().id);
  await x.h.settle();
  assert.equal(x.selected.length, 1);
  assert.equal(x.selected[0].url, item().url);
  assert.match(uiText(x.h.tree()), /خود فرم را ذخیره کنید/);
  assert.equal(x.options().gcTime, 0);
  assert.equal(x.options().placeholderData, undefined);
  assert.equal(x.options().retry, false);
  x.h.unmount();
});
test('prefix search is explicitly applied, normalized and Enter prevents submitting the surrounding editor', async () => {
  const x = setup();
  await x.h.settle();
  x.accept(page());
  await x.h.settle();
  const before = JSON.stringify(x.options().queryKey);
  x.change('شناسهٔ تصویر یا ابتدای آن', ' ABCD ');
  await x.h.settle();
  assert.equal(JSON.stringify(x.options().queryKey), before);
  let prevented = 0,
    stopped = 0;
  (x.control('شناسهٔ تصویر یا ابتدای آن').props.onKeyDown as (event: unknown) => void)({
    key: 'Enter',
    nativeEvent: { isComposing: false },
    target: { tagName: 'INPUT' },
    preventDefault() {
      prevented++;
    },
    stopPropagation() {
      stopped++;
    },
  });
  await x.h.settle();
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal((x.options().queryKey.at(-2) as contract.ImageLibraryFilters).q, 'abcd');
  x.change('شناسهٔ تصویر یا ابتدای آن', 'xyz');
  await x.h.settle();
  const validKey = JSON.stringify(x.options().queryKey);
  x.click('اعمال فیلتر تصاویر');
  await x.h.settle();
  assert.equal(JSON.stringify(x.options().queryKey), validKey);
  assert.ok(x.node('ErrorBox').props.error);
  x.h.unmount();
});

test('all native filter controls explicitly detach from an enclosing product or CMS form without changing label ownership', async () => {
  const x = setup();
  await x.h.settle();
  const controls = uiElements(x.h.tree()).filter(
    (node) => node.type === 'input' || node.type === 'PersianDateField',
  );
  assert.equal(controls.length, 3);
  const owner = controls[0].props.form;
  assert.equal(typeof owner, 'string');
  assert.ok(owner && owner !== x.props.id);
  assert.ok(controls.every((node) => node.props.form === owner));
  assert.ok(
    !uiElements(x.h.tree()).some((node) => node.type === 'form' || node.props.id === owner),
  );
  const fields = uiElements(x.h.tree()).filter(
    (node) => node.type === 'Field' || node.type === 'PersianDateField',
  );
  assert.deepEqual(
    fields.map((node) => node.props.label),
    ['شناسهٔ تصویر یا ابتدای آن', 'از زمان (شامل)', 'تا زمان (پیش از)'],
  );
  assert.ok(
    controls.every((node) => node.props.id === undefined),
    'Field still assigns its own independent label/control id',
  );
  assert.ok(
    uiElements(x.h.tree())
      .filter((node) => node.type === 'button')
      .every((node) => node.props.type === 'button'),
  );
  // A non-empty `form` attribute disassociates an input from an ancestor form
  // unless a form with that exact id exists. No such node is rendered here.
  // Verify the real handlers also prevent the parent form's implicit submit.
  let parentSubmits = 0;
  for (const control of controls) {
    let prevented = false,
      stopped = false;
    (control.props.onKeyDown as (event: unknown) => void)({
      key: 'Enter',
      nativeEvent: { isComposing: false },
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    });
    if (!prevented || !stopped) parentSubmits++;
  }
  assert.equal(parentSubmits, 0);
  x.h.unmount();
});
test('paging, refresh and clearing reset the cursor and empty/error states remain honest', async () => {
  const x = setup();
  await x.h.settle();
  x.accept(page(true));
  await x.h.settle();
  x.click('۲۴ تصویر بعدی');
  await x.h.settle();
  assert.equal(x.options().queryKey.at(-1), 'next_page');
  assert.ok(
    !uiElements(x.h.tree()).some((v) => v.type === 'img'),
    'old page must not appear as the next page',
  );
  x.accept({ ...page(), items: [] });
  await x.h.settle();
  assert.match(uiText(x.h.tree()), /تصویر آماده‌ای با این فیلتر پیدا نشد/);
  assert.equal(x.node('button', '۲۴ تصویر بعدی').props.disabled, true);
  x.click('تازه‌سازی تصاویر');
  await x.h.settle();
  assert.equal(x.options().queryKey.at(-1), null);
  x.accept(undefined, new Error('شبکه'));
  await x.h.settle();
  x.click('تلاش دوباره برای تصاویر');
  assert.equal(x.retries(), 1);
  x.click('پاک‌کردن فیلتر تصاویر');
  await x.h.settle();
  assert.deepEqual(x.options().queryKey.at(-2), contract.emptyImageLibraryFilters);
  assert.equal(x.options().queryKey.at(-1), null);
  x.h.unmount();
});
test('selected assets share identity across sizes and broken previews do not claim a healthy object or block valid selection', async () => {
  const x = setup();
  x.props.value = [item().variants[0].url];
  x.rerender();
  await x.h.settle();
  x.accept(page());
  await x.h.settle();
  const selectedButton = x.node('button', 'تصویر در فرم موجود است ' + item().id);
  assert.equal(selectedButton.props.disabled, true);
  (selectedButton.props.onClick as () => void)();
  assert.equal(x.selected.length, 0);
  x.props.value = [];
  x.rerender();
  await x.h.settle();
  (x.node('img').props.onError as () => void)();
  await x.h.settle();
  assert.ok(!uiElements(x.h.tree()).some((v) => v.type === 'img'));
  assert.match(uiText(x.h.tree()), /پیش‌نمایش در دسترس نیست/);
  x.click('انتخاب تصویر ' + item().id);
  assert.equal(x.selected.length, 1);
  x.h.unmount();
});
test('disabled/full views never send a library read even if a stale caller invokes queryFn', async () => {
  for (const boundary of ['disabled', 'full'] as const) {
    const x = setup();
    if (boundary === 'disabled') x.props.disabled = true;
    else x.props.value = Array.from({ length: 24 }, () => '/products/p.svg');
    x.rerender();
    await x.h.settle();
    assert.equal(x.options().enabled, false);
    await assert.rejects(
      x.options().queryFn({ signal: new AbortController().signal }),
      /نمای فعلی/,
    );
    assert.equal(x.requests.length, 0);
    x.h.unmount();
  }
});
test('filter changes, authority switches, abort and close suppress late reads with no old private page accepted', async () => {
  for (const boundary of ['filter', 'authority', 'abort', 'close'] as const) {
    const x = setup();
    await x.h.settle();
    let resolve: (raw: unknown) => void = () => {};
    const pending = new Promise<unknown>((yes) => {
      resolve = yes;
    });
    const controller = new AbortController();
    x.setTransport(async (_path, init) => {
      assert.equal(init.signal, controller.signal);
      return pending;
    });
    const request = x.options().queryFn({ signal: controller.signal }),
      rejected = assert.rejects(request, /نمای فعلی/);
    if (boundary === 'filter') {
      x.change('شناسهٔ تصویر یا ابتدای آن', 'aaaa');
      await x.h.settle();
      x.click('اعمال فیلتر تصاویر');
      await x.h.settle();
    }
    if (boundary === 'authority') x.setRevision(1);
    if (boundary === 'abort') controller.abort();
    if (boundary === 'close') x.h.unmount();
    resolve(page());
    await rejected;
    if (boundary !== 'close') x.h.unmount();
  }
});
test('page snapshots stay fixed and equal empty time windows are accepted while reversed ranges preserve existing scope', async () => {
  const x = setup();
  await x.h.settle();
  x.setTransport(async () => page(true));
  const first = (await x
    .options()
    .queryFn({ signal: new AbortController().signal })) as ImageLibraryPage;
  x.accept(first);
  await x.h.settle();
  x.click('۲۴ تصویر بعدی');
  await x.h.settle();
  x.setTransport(async () => ({ ...page(), asOfAt: '2026-10-31T10:00:00.1234568Z' }));
  await assert.rejects(
    x.options().queryFn({ signal: new AbortController().signal }),
    /زمان مبنای کتابخانه/,
  );
  x.change('از زمان (شامل)', '2026-10-31T12:30');
  await x.h.settle();
  x.change('تا زمان (پیش از)', '2026-10-30T12:30');
  await x.h.settle();
  const previous = JSON.stringify(x.options().queryKey);
  x.click('اعمال فیلتر تصاویر');
  await x.h.settle();
  assert.equal(JSON.stringify(x.options().queryKey), previous);
  x.change('تا زمان (پیش از)', '2026-10-31T12:30');
  await x.h.settle();
  x.click('اعمال فیلتر تصاویر');
  await x.h.settle();
  const filters = x.options().queryKey.at(-2) as contract.ImageLibraryFilters;
  assert.equal(filters.fromAt, filters.toAt);
  assert.equal(x.options().queryKey.at(-1), null);
  x.h.unmount();
});
