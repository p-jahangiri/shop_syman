import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as navigation from '../src/layout/admin-navigation.ts';
import * as access from '../src/auth/admin-page-access.ts';

test('workspace shortcuts preserve the same combined permissions as the sidebar', () => {
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/layout/admin-module-header.tsx', import.meta.url)),
    {
      './admin-page-help': { AdminPageHelp: 'AdminPageHelp' },
      './admin-navigation': navigation,
      '../auth/admin-page-access': access,
      '../styles/admin-module-header.css': {},
    },
  );
  const opened: string[] = [];
  const props = {
    page: 'finance',
    permissions: ['finance.read'],
    onNavigate: (page: string) => opened.push(page),
  };
  h.mount('AdminModuleHeader', props);
  const button = (text: string) =>
    uiElements(h.tree()).find((node) => node.type === 'button' && uiText(node).includes(text));
  assert.equal(button('پرداخت‌ها و تطبیق مالی'), undefined);
  const charges = button('ارسال و مالیات');
  assert.ok(charges);
  (charges.props.onClick as () => void)();
  assert.deepEqual(opened, ['charges']);
  h.rerender({ ...props, permissions: ['finance.read', 'sales.read'] });
  assert.ok(button('پرداخت‌ها و تطبیق مالی'));
  h.unmount();
});
