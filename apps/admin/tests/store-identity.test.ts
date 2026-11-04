import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as identity from '@sayman/web-shared/lib/content/store-identity.ts';

function editor(initial: identity.StoreIdentity = {}, published?: identity.StoreIdentity) {
  let value = initial;
  const images: { id: string; url: string | undefined }[] = [];
  const h = digitalUiHarness('apps/admin/src/features/content/store-identity-editor.tsx', {
    '../../components/ui': { Check: 'Check', Field: 'Field' },
    '../../components/forms/forms': { Text: 'Text' },
    '../media/media': { ImageEditor: 'ImageEditor' },
    '@sayman/web-shared/lib/content/store-identity.ts': identity,
    '../../styles/content/store-identity-editor.css': {},
  });
  const props = () => ({
    value,
    published,
    locale: 'fa',
    disabled: false,
    onChange: (next: identity.StoreIdentity) => {
      value = next;
    },
    onBadgeImageChange: (id: string, url: string | undefined) => images.push({ id, url }),
    onBusy() {},
  });
  h.mount('StoreIdentityEditor', props());
  const find = (type: string, label: string) => {
    const element = uiElements(h.tree()).find((e) => e.type === type && e.props.label === label);
    assert.ok(element, label);
    return element;
  };
  const change = (type: string, label: string, next: unknown) => {
    (find(type, label).props.onChange as (v: unknown) => void)(next);
    h.rerender(props());
  };
  const changeUrl = (label: string, url: string) => {
    const field = find('Field', label);
    const input = uiElements(field.props.children).find((el) => el.type === 'input');
    assert.ok(input, label);
    (input.props.onChange as (e: unknown) => void)({ target: { value: url } });
    h.rerender(props());
  };
  return { h, find, change, changeUrl, images, value: () => value };
}
test('real admin checkbox writes booleans; social edits preserve other settings and invalid enabled links show errors', () => {
  const e = editor({
    policyLinks: [{ id: 'terms', title: 'شرایط', href: '/support', enabled: true }],
  });
  e.changeUrl('آدرس تلگرام', 'https://t.me/shop_sample');
  e.change('Check', 'نمایش تلگرام', { target: { checked: true } });
  assert.equal(e.value().socialLinks?.[0].enabled, true);
  assert.equal(e.value().policyLinks?.[0].href, '/support');
  e.changeUrl('آدرس تلگرام', 'javascript:alert(1)');
  assert.equal(identity.storeIdentitySchema.safeParse(e.value()).success, false);
  assert.equal(typeof e.find('Field', 'آدرس تلگرام').props.error, 'string');
  assert.ok(uiElements(e.h.tree()).some((el) => el.props.role === 'alert'));
  e.h.unmount();
});
test('clearing WhatsApp turns off its public link and preserves neighboring configuration', () => {
  const e = editor({
    socialLinks: [{ platform: 'telegram', url: 'https://t.me/shop_sample', enabled: true }],
  });
  assert.equal(e.find('Check', 'نمایش واتساپ').props.disabled, true);
  e.changeUrl('آدرس واتساپ', 'https://wa.me/989123456789');
  assert.equal(e.find('Check', 'نمایش واتساپ').props.disabled, false);
  e.change('Check', 'نمایش واتساپ', { target: { checked: true } });
  e.changeUrl('آدرس واتساپ', '  ');
  assert.equal(e.find('Check', 'نمایش واتساپ').props.checked, false);
  assert.equal(e.find('Check', 'نمایش واتساپ').props.disabled, true);
  assert.deepEqual(identity.storeIdentitySchema.parse(e.value()).socialLinks, [
    { platform: 'telegram', url: 'https://t.me/shop_sample', enabled: true },
    { platform: 'whatsapp', url: '', enabled: false },
  ]);
  e.h.unmount();
});
test('LinkedIn share links become public-profile drafts while an explicit hidden choice survives editing', () => {
  const e = editor({}, { socialLinks: [] });
  const profile = 'https://www.linkedin.com/company/sayman';
  e.changeUrl('آدرس لینکدین', profile + '?trk=public_profile#about');
  assert.deepEqual(identity.storeIdentitySchema.parse(e.value()).socialLinks, [
    { platform: 'linkedin', url: profile, enabled: true },
  ]);
  assert.match(uiText(e.h.tree()), /در انتظار انتشار/);
  e.change('Check', 'نمایش لینکدین', { target: { checked: false } });
  e.changeUrl('آدرس لینکدین', 'https://example.com/incorrect');
  e.changeUrl('آدرس لینکدین', profile + '/');
  assert.equal(e.value().socialLinks?.[0].enabled, false);
  e.h.unmount();
});
test('legacy demo mode can be cleared while keeping the saved configuration', () => {
  const e = editor({
    demonstration: true,
    policyLinks: [{ id: 'terms', title: 'شرایط', href: '/support', enabled: true }],
  });
  const button = uiElements(e.h.tree()).find(
    (node) => node.type === 'button' && uiText(node).includes('آماده‌سازی نمایش مجوزهای واقعی'),
  );
  assert.ok(button);
  (button.props.onClick as () => void)();
  assert.equal(e.value().demonstration, false);
  assert.equal(e.value().policyLinks?.[0].href, '/support');
  e.h.unmount();
});
test('a saved, matching public link is shown as live and an unpublished removal stays distinguished', () => {
  const profile = 'https://www.linkedin.com/company/sayman';
  const published: identity.StoreIdentity = {
    socialLinks: [{ platform: 'linkedin', url: profile, enabled: true }],
  };
  const e = editor(published, published);
  assert.match(uiText(e.h.tree()), /اکنون در فروشگاه/);
  e.change('Check', 'نمایش لینکدین', { target: { checked: false } });
  assert.match(uiText(e.h.tree()), /در انتشار بعد پنهان می‌شود/);
  e.h.unmount();
});
test('license image callback binds stable badge identity for functional parent updates', () => {
  const e = editor({
    badges: [
      {
        id: 'stable-id',
        kind: 'license',
        title: 'مجوز',
        verificationUrl: 'https://issuer.example/check',
        enabled: true,
      },
    ],
  });
  e.change('ImageEditor', 'تصویر واقعی مجوز — اختیاری', [
    '/media/catalog/' + 'a'.repeat(32) + '/card.webp',
  ]);
  assert.deepEqual(e.images, [
    { id: 'stable-id', url: '/media/catalog/' + 'a'.repeat(32) + '/card.webp' },
  ]);
  e.h.unmount();
});
