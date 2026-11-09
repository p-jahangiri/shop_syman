import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as threadContract from '@sayman/web-shared/lib/support/product-questions.ts';
import * as ticketContract from '@sayman/web-shared/lib/support/ticket-contract.ts';

test('a not-yet-published question with an omitted thread can be published without an answer', async () => {
  type Query = { queryFn: (args: { signal: AbortSignal }) => Promise<unknown> };
  let query: Query | undefined;
  const state: { data?: unknown } = {};
  const posted: { path: string; body: unknown }[] = [];
  const page = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/support/shopping-reply-tools.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {
        useQuery: (config: Query) => {
          query = config;
          return {
            data: state.data,
            isSuccess: state.data !== undefined,
            isPending: state.data === undefined,
            refetch() {},
          };
        },
      },
      '@sayman/web-shared/lib/support/product-questions.ts': threadContract,
      '@sayman/web-shared/lib/support/ticket-contract.ts': ticketContract,
      '../../api/api': {
        ApiError: Error,
        api: (path: string, options: { method?: string; body?: string }) => {
          if (!options.method) return {}; // Actual JSON shape when nulls are omitted.
          posted.push({ path, body: JSON.parse(options.body!) });
          return { published: true };
        },
      },
      '../../components/ui': { ErrorBox: 'ErrorBox', Field: 'Field' },
      '../../features/catalog/product-picker': { ProductPicker: 'ProductPicker' },
    },
  );
  const id = 'a'.repeat(32);
  const question = 'آیا شارژر همراه کالا است؟';
  const version = 'AAAAAAAAAAE=';
  page.mount('PublicQuestionReply', {
    ticket: { id, version, state: 'Open', locale: 'fa' },
    first: { author: 'customer', body: 'iphone-16\n\n' + question },
    viewerId: 'staff-test',
    refresh() {},
  });
  state.data = await query!.queryFn({ signal: new AbortController().signal });
  page.rerender();
  assert.match(uiText(page.tree()), /هنوز در صفحهٔ کالا منتشر نشده/);
  const edit = uiElements(page.tree()).find(
    (el) => uiText(el) === 'بازبینی و انتشار پرسش' && el.type === 'button',
  );
  assert(edit);
  (edit.props.onClick as () => void)();
  await page.settle();
  const checkbox = uiElements(page.tree()).find(
    (el) => el.type === 'input' && el.props.type === 'checkbox',
  );
  assert(checkbox);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  await page.settle();
  const submit = uiElements(page.tree()).find(
    (el) => el.type === 'button' && el.props.type === 'submit',
  );
  const form = uiElements(page.tree()).find((el) => el.type === 'form');
  assert(submit && form);
  assert.equal(submit.props.disabled, false);
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await page.settle();
  assert.equal(posted.length, 1);
  assert.match(posted[0]!.path, new RegExp('/' + id + '/public-answer/[a-f0-9]{32}$'));
  assert.deepEqual(posted[0]!.body, { version, question, answer: '', confirmed: true });
  assert.match(uiText(page.tree()), /پرسش در صفحهٔ کالا منتشر شد/);
  assert.equal(
    threadContract.staffProductQuestion.safeParse({ thread: { question } }).success,
    false,
  );
});
