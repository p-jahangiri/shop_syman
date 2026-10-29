import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import * as state from './market-import-state.ts';
import * as primaryJournal from './market-import-journal.ts';
import * as sourceJournal from './market-source-csv-journal.ts';
import * as primaryContract from './market-contract.ts';
import * as sourceContract from './market-source-csv-contract.ts';

// Execute the actual TSX handlers with mocked hooks/transport. This exercises
// asynchronous event ordering without a browser, network, database or build.
const require = createRequire(import.meta.url),
  swc = require('next/dist/build/swc');
await swc.loadBindings();
type Element = {
  type: unknown;
  props: Record<string, unknown> & {
    onClick: () => unknown;
    onChange: (event: unknown) => unknown;
  };
  key?: unknown;
};
const version = 'AAAAAAAAAAA=',
  listingId = 'a'.repeat(32),
  sourceId = 'b'.repeat(32);
class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super('Synthetic transport result');
    this.status = status;
  }
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
async function waitForIdle(ready: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!ready()) {
    assert.ok(performance.now() < deadline, 'CSV handler did not settle within five seconds');
    await setImmediate();
  }
}
function text(value: unknown): string {
  return value == null || value === false
    ? ''
    : Array.isArray(value)
      ? value.map(text).join('')
      : typeof value !== 'object'
        ? String(value)
        : text((value as Element).props?.children);
}
function elements(value: unknown): Element[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  const node = value as Element;
  return node.props ? [node, ...elements(node.props.children)] : [];
}
function button(tree: Element, label: string) {
  const result = elements(tree).find(
    (value) => value.type === 'button' && text(value).includes(label),
  );
  assert.ok(result, 'Missing button ' + label);
  return result;
}
async function harness(kind: 'primary' | 'extra') {
  primaryJournal.clearMarketImportJournal();
  sourceJournal.clearSourceCsvJournal();
  const values: unknown[] = [],
    operationRefs = new Set<{ current: unknown }>(),
    writes: { path: string; body: Record<string, unknown> }[] = [];
  let cursor = 0,
    authority = 0;
  let transport: (path: string, body?: unknown) => Promise<unknown> = async () => {
    throw Error('Transport not configured');
  };
  const owner = 'synthetic-' + kind;
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [
        values[index],
        (next: unknown) =>
          (values[index] = typeof next === 'function' ? next(values[index]) : next),
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      const reference = (values[index] ??= { current: initial }) as { current: unknown };
      if (initial === false || initial instanceof state.MarketImportDraft)
        operationRefs.add(reference);
      return reference;
    },
    useEffect() {},
  };
  const jsx = (type: unknown, props: Record<string, unknown>, key?: unknown) => ({
    type,
    props,
    key,
  });
  const mocks: Record<string, unknown> = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './market-import-journal': primaryJournal,
    './market-source-csv-journal': sourceJournal,
    './market-import-state': state,
    './market-contract': primaryContract,
    './market-source-csv-contract': sourceContract,
    './admin-view-authority': { adminViewRevision: () => authority },
    './ui': { ErrorBox: 'ErrorBox', Field: 'Field' },
    './admin-table': { AdminTable: 'AdminTable' },
    './api': {
      ApiError,
      api: (path: string) => transport(path),
      save: (path: string, body: unknown) => {
        assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body));
        writes.push({ path, body: structuredClone(body as Record<string, unknown>) });
        return transport(path, body);
      },
    },
  };
  const file = kind === 'primary' ? 'market-import.tsx' : 'market-source-csv.tsx';
  const code = swc.transformSync(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    filename: file,
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  }).code;
  const exported: Record<string, unknown> = {};
  vm.runInNewContext(code, {
    exports: exported,
    require: (name: string) => {
      assert.ok(name in mocks, 'Unexpected module ' + name);
      return mocks[name];
    },
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    structuredClone,
    window: {},
    navigator: {},
  });
  const render = () => {
    cursor = 0;
    const component = kind === 'primary' ? exported.MarketImport : exported.MarketSourceCsvImport;
    assert.ok(typeof component === 'function');
    return (component as (props: { viewerId: string; onSaved: () => void }) => Element)({
      viewerId: owner,
      onSaved() {},
    });
  };
  const preview = async (csv: string) => {
    const hash = await state.marketImportCsvHash(csv);
    const expected =
      kind === 'primary'
        ? {
            rowNumber: 2,
            listingId: null,
            listingVersion: null,
            modelId: null,
            modelVersion: null,
            metadataFingerprint: 'A'.repeat(64),
          }
        : {
            rowNumber: 2,
            listingId,
            listingVersion: version,
            sourceId,
            sourceVersion: null,
            modelVersion: version,
            metadataFingerprint: 'A'.repeat(64),
          };
    const row =
      kind === 'primary'
        ? {
            rowNumber: 2,
            operation: 'create',
            nameFa: csv,
            nameEn: 'Synthetic',
            sourceKey: 'manual',
            sourceItemKey: 'sample',
            status: 'Draft',
            referencePriceRial: null,
            hasStorefrontOffers: false,
            expected,
            issues: [],
          }
        : {
            rowNumber: 2,
            listingId,
            sourceId,
            operation: 'create',
            nameFa: csv,
            nameEn: 'Synthetic',
            sourceNameFa: 'نمونه',
            sourceNameEn: 'Sample',
            referencePriceRial: null,
            expected,
            issues: [],
          };
    return {
      schemaVersion: 1,
      fileHash: hash,
      rows: [row],
      validRows: 1,
      invalidRows: 0,
      canCommit: true,
    };
  };
  const readJournal = () =>
    kind === 'primary'
      ? primaryJournal.readMarketImportJournal(owner)
      : sourceJournal.readSourceCsvJournal(owner);
  return {
    kind,
    render,
    writes,
    preview,
    readJournal,
    // Actual guards cover async hashing, transport and finally cleanup. The
    // intentionally pending file/commit cases assert before awaiting them.
    settle: () =>
      waitForIdle(() =>
        [...operationRefs].every(
          ({ current }) =>
            current !== true &&
            !(current instanceof state.MarketImportDraft && current.readingFile),
        ),
      ),
    setTransport: (next: typeof transport) => (transport = next),
    invalidate: () => authority++,
    previewLabel: kind === 'primary' ? 'پیش‌نمایش و بررسی خطاها' : 'بررسی فایل منابع',
    commitLabel: kind === 'primary' ? 'ردیف بررسی‌شده' : 'گزارش منابع',
    retryLabel: kind === 'primary' ? 'ارسال دوبارهٔ همان درخواست' : 'ارسال دقیق همان فایل منابع',
  };
}

for (const kind of ['primary', 'extra'] as const) {
  test(
    kind + ' CSV blocks stale preview/commit handlers while a replacement file is being read',
    async () => {
      const h = await harness(kind);
      let tree = h.render();
      elements(tree)
        .find((value) => value.type === 'textarea')!
        .props.onChange({ target: { value: 'FILE_A' } });
      tree = h.render();
      h.setTransport(async () => h.preview('FILE_A'));
      button(tree, h.previewLabel).props.onClick();
      await h.settle();
      tree = h.render();
      const staleCommit = button(tree, h.commitLabel),
        file = deferred<ArrayBuffer>();
      elements(tree)
        .find((value) => value.type === 'input' && value.props.type === 'file')!
        .props.onChange({ target: { files: [{ size: 6, arrayBuffer: () => file.promise }] } });
      staleCommit.props.onClick();
      button(tree, h.previewLabel).props.onClick();
      assert.equal(h.writes.filter((value) => value.path.endsWith('/commit')).length, 0);
      assert.equal(h.writes.filter((value) => value.path.endsWith('/preview')).length, 1);
      file.resolve(new TextEncoder().encode('FILE_B').buffer);
      await h.settle();
      tree = h.render();
      assert.equal(
        elements(tree).find((value) => value.type === 'textarea')!.props.value,
        'FILE_B',
      );
      h.setTransport(async (path) =>
        path.endsWith('/preview') ? h.preview('FILE_B') : new Promise(() => {}),
      );
      button(tree, h.previewLabel).props.onClick();
      await h.settle();
      tree = h.render();
      button(tree, h.commitLabel).props.onClick();
      assert.equal(h.writes.find((value) => value.path.endsWith('/commit'))!.body.csv, 'FILE_B');
    },
  );
  test(kind + ' CSV retains one frozen command through lost reply,403 and a later409', async () => {
    const h = await harness(kind);
    let tree = h.render();
    elements(tree)
      .find((value) => value.type === 'textarea')!
      .props.onChange({ target: { value: 'EXACT_CSV\r\n' } });
    tree = h.render();
    h.setTransport(async () => h.preview('EXACT_CSV\r\n'));
    button(tree, h.previewLabel).props.onClick();
    await h.settle();
    tree = h.render();
    h.setTransport(async () => {
      throw Error('Synthetic lost reply');
    });
    button(tree, h.commitLabel).props.onClick();
    await h.settle();
    const first = h.readJournal()!;
    assert.equal(first.uncertain, true);
    for (const status of [403, 409]) {
      tree = h.render();
      h.setTransport(async () => {
        throw new ApiError(status);
      });
      button(tree, h.retryLabel).props.onClick();
      await h.settle();
      assert.deepEqual(h.readJournal()!.command, first.command);
      assert.equal(h.readJournal()!.uncertain, true);
    }
    assert.equal(
      new Set(
        h.writes
          .filter((value) => value.path.endsWith('/commit'))
          .map((value) => value.body.requestId),
      ).size,
      1,
    );
  });
  test(kind + ' CSV ignores a late preview after the authorization view changes', async () => {
    const h = await harness(kind),
      response = deferred<unknown>();
    let tree = h.render();
    elements(tree)
      .find((value) => value.type === 'textarea')!
      .props.onChange({ target: { value: 'PRIVATE_CSV' } });
    tree = h.render();
    h.setTransport(async () => response.promise);
    button(tree, h.previewLabel).props.onClick();
    h.invalidate();
    response.resolve(await h.preview('PRIVATE_CSV'));
    await h.settle();
    tree = h.render();
    assert.equal(
      elements(tree).some(
        (value) => value.type === 'button' && text(value).includes(h.commitLabel),
      ),
      false,
    );
  });
}
