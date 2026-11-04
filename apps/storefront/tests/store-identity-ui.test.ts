import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as identity from '@sayman/web-shared/lib/content/store-identity.ts';

function footer(
  value: unknown,
  locale = 'fa',
  part: 'social' | 'licenses' | 'policies' | 'license-card' = 'social',
  showExamples = false,
) {
  const h = digitalUiHarness(
    'apps/storefront/components/content/store-identity-footer.tsx',
    {
      '@sayman/web-shared/lib/content/store-identity.ts': identity,
      '../navigation/localized-link': 'localized-link',
      '../media/content-image': 'image',
      './store-identity-footer.css': {},
    },
    { URL },
    'export const TestLicenseCard = LicenseCard;',
  );
  h.mount(
    part === 'license-card' ? 'TestLicenseCard' : 'StoreIdentityFooter',
    part === 'license-card' ? { badge: value, locale } : { value, locale, part, showExamples },
  );
  return h;
}
const socialAnchors = (tree: unknown) =>
  uiElements(tree)
    .filter((e) => typeof e.type === 'function' && e.type.name === 'StoreSocialLinks')
    .flatMap((e) => uiElements((e.type as (props: typeof e.props) => unknown)(e.props)))
    .filter((e) => e.type === 'a');
test('unconfigured and malformed identity render no empty section or executable content', () => {
  for (const value of [
    undefined,
    {},
    { socialLinks: [{ platform: 'telegram', url: 'javascript:alert(1)', enabled: true }] },
  ]) {
    const h = footer(value);
    assert.equal(h.tree(), null);
    h.unmount();
  }
});
test('demo licenses and blank social channels are omitted in both languages', () => {
  for (const locale of ['fa', 'en']) {
    const h = footer(
      {
        demonstration: true,
        socialLinks: identity.socialPlatforms.map((platform) => ({
          platform,
          url: '',
          enabled: false,
        })),
      },
      locale,
    );
    assert.equal(h.tree(), null);
    h.unmount();
  }
});
test('published social links remain visible when demo licenses and disabled links are hidden', () => {
  const value = {
    demonstration: true,
    badges: [
      {
        id: 'license',
        kind: 'license',
        title: 'مجوز',
        verificationUrl: 'https://issuer.example/license',
        enabled: true,
      },
    ],
    socialLinks: [
      { platform: 'linkedin', url: 'https://www.linkedin.com/company/sayman', enabled: true },
      { platform: 'telegram', url: 'https://t.me/shop_sample', enabled: false },
    ],
  };
  const h = footer(value);
  const licenses = footer(value, 'fa', 'licenses', true);
  const links = socialAnchors(h.tree());
  assert.deepEqual(
    links.map((link) => link.props.href),
    ['https://www.linkedin.com/company/sayman'],
  );
  assert.match(String(links[0].props['aria-label']), /لینکدین/);
  assert.equal(licenses.tree(), null);
  h.unmount();
  licenses.unmount();
});
test('real social links include external-link protections while policy paths stay localized', () => {
  const value = {
    socialLinks: [
      { platform: 'telegram', url: 'https://t.me/shop_sample', enabled: true },
      { platform: 'instagram', url: '', enabled: false },
    ],
    policyLinks: [{ id: 'terms', title: 'شرایط خرید', href: '/support', enabled: true }],
  };
  const h = footer(value);
  const links = socialAnchors(h.tree());
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, 'https://t.me/shop_sample');
  assert.equal(links[0].props.target, '_blank');
  assert.match(String(links[0].props.rel), /noopener noreferrer/);
  assert.match(String(links[0].props['aria-label']), /پنجرهٔ جدید/);
  assert.equal(uiText(links[0]), '');
  const policies = footer(value, 'fa', 'policies');
  assert.equal(
    uiElements(policies.tree()).find((e) => e.type === 'localized-link')?.props.href,
    '/support',
  );
  h.unmount();
  policies.unmount();
});
test('development trust samples are labeled, inert and bound to the demonstration identity', () => {
  const badges = [
    { id: 'enamad', kind: 'enamad', title: 'اینماد', verificationUrl: '', enabled: false },
    {
      id: 'store-license',
      kind: 'license',
      title: 'نشان اعتماد',
      verificationUrl: '',
      enabled: false,
    },
  ];
  for (const locale of ['fa', 'en']) {
    const value = { demonstration: true, badges };
    const hidden = footer(value, locale, 'licenses');
    const live = footer({ badges }, locale, 'licenses', true);
    const preview = footer(value, locale, 'licenses', true);
    assert.equal(hidden.tree(), null);
    assert.equal(live.tree(), null);
    const elements = uiElements(preview.tree());
    assert.deepEqual(
      elements.flatMap((e) => e.props['data-preview-badge'] ?? []),
      ['enamad', 'store-license'],
    );
    assert.ok(
      uiText(preview.tree()).includes(locale === 'fa' ? 'نمونهٔ نمایشی' : 'Preview sample'),
    );
    assert.ok(!elements.some((e) => e.props.href || e.props.src));
    for (const h of [hidden, live, preview]) h.unmount();
  }
});
test('badge image failure leaves the real verification link and neutral fallback available', () => {
  const badge = {
    id: 'enamad',
    kind: 'enamad',
    title: 'نماد',
    verificationUrl: 'https://trustseal.enamad.ir/?id=123&Code=fixture',
    imageUrl: 'https://trustseal.enamad.ir/logo.aspx?id=123&Code=fixture',
    enabled: true,
  };
  const h = footer(badge, 'fa', 'license-card');
  const image = uiElements(h.tree()).find((e) => e.type === 'image')!;
  assert.equal(image.props.loading, 'lazy');
  (image.props.onError as () => void)();
  h.rerender();
  assert.equal(
    uiElements(h.tree()).some((e) => e.type === 'image'),
    false,
  );
  assert.equal(uiElements(h.tree()).find((e) => e.type === 'a')?.props.href, badge.verificationUrl);
  assert.ok(uiText(h.tree()).includes('trustseal.enamad.ir'));
  h.unmount();
});
