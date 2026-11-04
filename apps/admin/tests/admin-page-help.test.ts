import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { adminGuides } from '../src/layout/admin-guides.ts';
test('SMS help explains write-only keys, uncertain saves and identity gates without irrelevant table instructions', async () => {
  for (const page of ['sms', 'products'] as const) {
    const h = digitalUiHarness(
      fileURLToPath(new URL('../src/layout/admin-page-help.tsx', import.meta.url)),
      {
        './admin-guides': { adminGuides },
        '../components/ui': { Modal: 'Modal' },
      },
    );
    h.mount('AdminPageHelp', { page, title: page === 'sms' ? 'پیامک' : 'کالاها' });
    (uiElements(h.tree()).find((node) => node.type === 'button')!.props.onClick as () => void)();
    await h.settle();
    const text = uiText(h.tree());
    assert.equal(text.includes('کار با جدول و جست‌وجو'), page === 'products');
    if (page === 'sms') {
      assert.match(text, /Sandbox/);
      assert.match(text, /کلید ذخیره‌شده هیچ‌وقت نمایش داده نمی‌شود/);
      assert.match(text, /رسید قطعی همان درخواست نیست/);
      assert.match(text, /پیامک آزمایشی ارسال نمی‌کند/);
    }
  }
});
