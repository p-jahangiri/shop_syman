import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import {
  cmsImagePreview,
  cmsPagePreview,
  createCmsImageUploadTracker,
} from '../src/features/content/cms-image-model.ts';
import * as pageContract from '@sayman/web-shared/lib/content/cms-page-contract.ts';

test('CMS preview proxies only issued catalog paths and leaves persisted content unchanged', () => {
  const image = '/media/catalog/' + 'a'.repeat(32) + '/card.webp';
  const content = {
    title: 'نمونهٔ تألیفی',
    description: '',
    blocks: [
      {
        id: 'b'.repeat(32),
        kind: 'Image' as const,
        visibility: 'All' as const,
        image,
        alt: 'تصویر نمونه',
      },
    ],
  };
  const preview = cmsPagePreview(content);
  assert.equal(preview.blocks[0].kind === 'Image' && preview.blocks[0].image, '/api' + image);
  assert.equal(content.blocks[0].image, image);
  for (const untouched of [
    '/products/phone-titanium.svg',
    image + '?token=private',
    '/media/catalog/../card.webp',
    '//foreign.example/image.png',
  ]) {
    assert.equal(cmsImagePreview(untouched), untouched);
  }
});

test('one completed or cancelled CMS field cannot unlock another active upload', () => {
  const uploads = createCmsImageUploadTracker();
  const changes: boolean[] = [];
  const unsubscribe = uploads.subscribe(() => changes.push(uploads.snapshot()));
  uploads.set('fa:block-1', true);
  uploads.set('en:block-2', true);
  uploads.set('fa:block-1', true);
  uploads.set('fa:block-1', false);
  uploads.set('unrelated', false);
  assert.equal(uploads.snapshot(), true);
  uploads.set('en:block-2', false);
  assert.equal(uploads.snapshot(), false);
  assert.deepEqual(changes, [true, false]);
  unsubscribe();
  uploads.set('cover', true);
  assert.deepEqual(changes, [true, false]);
});

type Node = { type: unknown; props: { onSubmit?: (event: unknown) => void } };

function editorHarness(uploading: boolean, writable = true) {
  const exported: Record<string, unknown> = {};
  let saves = 0;
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const source = fs
    .readFileSync(new URL('../src/features/content/cms-pages.tsx', import.meta.url), 'utf8')
    .replaceAll('import.meta.env', '({})');
  const code = swc.transformSync(source, {
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
      if (name === 'react') {
        return {
          useState: (initial: unknown) => [
            typeof initial === 'function' ? initial() : initial,
            () => undefined,
          ],
          useEffect: () => undefined,
        };
      }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@sayman/web-shared/lib/content/cms-page-contract.ts') return pageContract;
      if (name === './cms-image-uploads')
        return {
          useCmsImageUploads: () => ({
            busy: uploading,
            isBusy: () => uploading,
            setBusy: () => undefined,
          }),
        };
      if (
        [
          '../media/media',
          './cms-image-model',
          '@tanstack/react-query',
          '../../api/api',
          '../../state/content/admin-cms-page-journal',
          '../../auth/admin-view-authority',
          './cms-editor-model',
          './cms-editor-workspace',
          '@sayman/web-shared/components/content/cms-page-view',
          '../../components/ui',
          '@sayman/web-shared/components/content/cms-page.css',
        ].includes(name)
      )
        return {};
      throw Error('Unexpected module ' + name);
    },
    structuredClone,
  });
  const PageEditor = exported.PageEditor as (props: unknown) => Node;
  const node = PageEditor({ writable, onSave: () => saves++ });
  return {
    submit() {
      node.props.onSubmit?.({ preventDefault() {} });
    },
    saves: () => saves,
  };
}

test('the actual CMS page submit handler blocks in-flight image uploads and read-only access', () => {
  for (const [uploading, writable] of [
    [true, true],
    [false, false],
  ]) {
    const editor = editorHarness(uploading, writable);
    editor.submit();
    assert.equal(editor.saves(), 0);
  }
  const ready = editorHarness(false);
  ready.submit();
  assert.equal(ready.saves(), 1);
});
