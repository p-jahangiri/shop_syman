import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { emptyCmsPageContent } from '@sayman/web-shared/lib/content/cms-page-contract.ts';
import * as model from '../src/features/content/cms-editor-model.ts';

const file = fileURLToPath(
  new URL('../src/features/content/cms-editor-workspace.tsx', import.meta.url),
);
const mocks = {
  '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
  './cms-editor-model': model,
  '../../components/ui': { Busy: 'Busy', Modal: 'Modal' },
  '../../styles/content/cms-editor-workspace.css': {},
};

test('draft editors and publishers have independent command and recovery permissions', () => {
  for (const action of ['Create', 'Save'] as const) {
    assert.equal(model.canRunCmsCommand(action, true, false), true);
    assert.equal(model.canRunCmsCommand(action, false, true), false);
  }
  for (const action of ['Publish', 'Restore', 'Unpublish'] as const) {
    assert.equal(model.canRunCmsCommand(action, true, false), false);
    assert.equal(model.canRunCmsCommand(action, false, true), true);
    assert.equal(model.canRunCmsCommand(action, false, false), false);
  }
});

test('the content table distinguishes a new draft from unpublication and the summary exposes only live links', () => {
  const h = digitalUiHarness(file, mocks);
  const stamp = '2026-11-03T10:00:00Z';
  const record = { isDemo: true, updatedAt: stamp };
  h.mount('CmsContentList', {
    rows: [
      { ...record, id: 'draft', slug: 'draft-page', publication: 0, publishedRevisionId: null },
      { ...record, id: 'hidden', slug: 'hidden-page', publication: 2, publishedRevisionId: null },
      { ...record, id: 'live', slug: 'live-page', publication: 1, publishedRevisionId: 'rev' },
    ],
    kind: 'صفحه',
  });
  assert.deepEqual(
    uiElements(h.tree())
      .filter((node) => node.type === 'span')
      .map(uiText),
    ['پیش‌نویس', 'لغو انتشار', 'منتشرشده'],
  );
  assert.equal(uiElements(h.tree()).filter((node) => node.type === 'time').length, 3);
  const draft = emptyCmsPageContent();
  draft.fa.title = 'راهنما';
  draft.fa.blocks.push({
    id: 'a'.repeat(32),
    visibility: 'All',
    kind: 'Text',
    heading: '',
    text: 'راهنما',
  });
  const summary = {
    draft,
    authorReady: false,
    dirty: true,
    publishable: false,
    publication: 2,
    publishedRevisionId: null,
    publishedLinks: { fa: '/fa/pages/guide', en: '/en/pages/guide' },
  };
  h.mount('CmsPublicationSummary', summary);
  assert.equal(uiElements(h.tree()).filter((node) => node.type === 'a').length, 0);
  assert.match(uiText(h.tree()), /فارسیراهنماآماده/);
  assert.match(uiText(h.tree()), /انگلیسیعنوان و حداقل یک بلوک لازم است/);
  assert.match(uiText(h.tree()), /دسترسی ناشر محتوا/);
  h.rerender({ ...summary, publishedRevisionId: 'rev' });
  assert.deepEqual(
    uiElements(h.tree())
      .filter((node) => node.type === 'a')
      .map((node) => node.props.href),
    ['/fa/pages/guide', '/en/pages/guide'],
  );
  h.unmount();
});

test('editor navigation keeps the dirty form on cancel and advances exactly once on discard', async () => {
  const h = digitalUiHarness(file, mocks);
  h.mount('useCmsEditorNavigation', {});
  type State = ReturnType<
    typeof import('../src/features/content/cms-editor-workspace.tsx').useCmsEditorNavigation
  >;
  const state = () => h.tree() as State;
  let transitions = 0;
  const advance = () => transitions++;
  state().navigate(advance);
  assert.equal(transitions, 1);
  state().setDirty(true);
  await h.settle();
  state().navigate(advance);
  await h.settle();
  assert.equal(transitions, 1);
  assert.ok(state().nextAction);
  state().cancel();
  await h.settle();
  assert.equal(state().nextAction, null);
  assert.equal(state().dirty, true);
  state().navigate(advance);
  await h.settle();
  state().discard();
  await h.settle();
  assert.equal(transitions, 2);
  assert.equal(state().dirty, false);
  assert.equal(state().nextAction, null);
  assert.equal(state().epoch, 1);
  state().discard();
  assert.equal(transitions, 2);
  h.unmount();
});
