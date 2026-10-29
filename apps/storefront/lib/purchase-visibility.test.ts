import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPurchaseMenu,
  isPurchaseContentEnabled,
  isPurchaseHrefEnabled,
  isPurchaseKindEnabled,
} from './purchasing.ts';
import { snapshotSchema } from './snapshot.ts';
import { storefrontSnapshot } from './fixtures.ts';
import {
  supportContentDraftSchema,
  supportContentPublicSchema,
  emptySupportContent,
} from './support-content-contract.ts';
import type { PurchaseMethod, MenuItem } from './types.ts';
const methods: PurchaseMethod[] = [
  {
    id: 'cash',
    kind: 'online',
    enabled: true,
    name: 'Cash',
    description: '',
    requiresApproval: false,
  },
  {
    id: 'check-off',
    kind: 'cheque',
    enabled: false,
    name: 'Old',
    description: '',
    requiresApproval: true,
  },
  {
    id: 'check-on',
    kind: 'cheque',
    enabled: true,
    name: 'Current',
    description: '',
    requiresApproval: true,
  },
  {
    id: 'provider',
    kind: 'installment',
    enabled: false,
    name: 'Provider',
    description: '',
    requiresApproval: true,
  },
];
const cashOnly = methods.map((m) => ({ ...m, enabled: m.kind === 'online' }));
test('global kinds use any enabled method without making provider or product eligibility claims', () => {
  assert.equal(isPurchaseKindEnabled(methods, 'cheque'), true);
  assert.equal(isPurchaseKindEnabled(cashOnly, 'cheque'), false);
  assert.equal(isPurchaseKindEnabled(methods, 'installment'), false);
  assert.equal(isPurchaseKindEnabled([], 'online'), false);
  for (const kind of ['online', 'cheque', 'installment'] as const) {
    assert.equal(
      isPurchaseContentEnabled({ purchaseMethodKind: kind }, methods),
      kind !== 'installment',
    );
    assert.equal(isPurchaseContentEnabled({ purchaseMethodKind: kind }, []), false);
  }
  assert.equal(isPurchaseContentEnabled({ kind: 'cheque' }, cashOnly), false);
  assert.equal(isPurchaseContentEnabled({}, []), true);
});
test('localized, query and encoded guide routes are gated but history and unrelated names remain reachable', () => {
  for (const href of [
    '/installments',
    '/installments/',
    '/fa/installments?product=p#calculator',
    '/en/installments',
    '/%69nstallments',
    '/installments/help',
  ]) {
    assert.equal(isPurchaseHrefEnabled(href, cashOnly), false, href);
    assert.equal(isPurchaseHrefEnabled(href, methods), true, href);
  }
  for (const href of [
    '/credit',
    '/credit/purchases',
    '/orders',
    '/account?tab=credit',
    '/checkout',
    '/installments-news',
    '/catalog?q=installments',
  ]) {
    assert.equal(isPurchaseHrefEnabled(href, cashOnly), true, href);
  }
  assert.equal(isPurchaseHrefEnabled('/%ZZ', cashOnly), false);
});
test('nested CMS gating retains unrelated branches without mutating saved content', () => {
  const menu: MenuItem[] = [
    {
      label: 'Shop',
      href: '/catalog',
      children: [
        { label: 'Guide', href: '/fa/installments' },
        { label: 'Cash offer', href: '/catalog', purchaseMethodKind: 'online' },
        { label: 'Custom cheque', href: '/pages/custom', purchaseMethodKind: 'cheque' },
      ],
    },
    { label: 'Provider', href: '/pages/provider', purchaseMethodKind: 'installment' },
    { label: 'My previous purchases', href: '/credit/purchases' },
  ];
  const original = structuredClone(menu);
  assert.deepEqual(filterPurchaseMenu(menu, cashOnly), [
    { ...menu[0], children: [menu[0].children![1]] },
    menu[2],
  ]);
  assert.deepEqual(menu, original);
  assert.equal(filterPurchaseMenu(menu, methods)[0].children!.length, 3);
  assert.equal(
    isPurchaseContentEnabled({ purchaseMethodKind: 'online', href: '/installments' }, cashOnly),
    false,
  );
});
test('site parser preserves finite dependency metadata in all content slots and rejects null/unknown values', () => {
  const value = structuredClone(storefrontSnapshot);
  value.site.hero.purchaseMethodKind = 'cheque';
  value.site.nav = [
    {
      label: 'Nested',
      href: '/catalog',
      purchaseMethodKind: 'online',
      children: [{ label: 'Cheque', href: '/pages/custom', purchaseMethodKind: 'cheque' }],
    },
  ];
  value.site.homeBlocks = [
    {
      id: 'promo',
      kind: 'promotions',
      enabled: true,
      purchaseMethodKind: 'online',
      items: [
        {
          title: 'Provider',
          eyebrow: 'Terms',
          action: 'View',
          href: '/pages/provider',
          image: '/products/phone-green.svg',
          purchaseMethodKind: 'installment',
        },
      ],
    },
  ];
  const parsed = snapshotSchema.parse(value);
  assert.deepEqual(parsed.site, value.site);
  for (const bad of [null, 'cash', 'false', false, {}, []]) {
    assert.equal(
      snapshotSchema.safeParse({
        ...value,
        site: { ...value.site, hero: { ...value.site.hero, purchaseMethodKind: bad } },
      }).success,
      false,
    );
    assert.equal(
      snapshotSchema.safeParse({
        ...value,
        site: { ...value.site, nav: [{ label: 'x', href: '/catalog', purchaseMethodKind: bad }] },
      }).success,
      false,
    );
  }
});
test('FAQ dependency is optional and finite in draft and public contracts', () => {
  const faq = { id: '1'.repeat(32), question: 'Terms?', answer: 'Conditions', enabled: true };
  const draft = { ...emptySupportContent('en'), faqs: [faq] };
  assert.deepEqual(supportContentDraftSchema.parse(draft), draft);
  const { schemaVersion, ...fields } = draft;
  void schemaVersion;
  const { enabled, ...publicFaq } = faq;
  void enabled;
  assert.equal(
    supportContentPublicSchema.safeParse({ ...fields, faqs: [publicFaq] }).success,
    true,
  );
  for (const kind of ['online', 'cheque', 'installment']) {
    assert.equal(
      supportContentDraftSchema.safeParse({
        ...draft,
        faqs: [{ ...faq, purchaseMethodKind: kind }],
      }).success,
      true,
    );
    assert.equal(
      supportContentPublicSchema.safeParse({
        ...fields,
        faqs: [{ ...publicFaq, purchaseMethodKind: kind }],
      }).success,
      true,
    );
  }
  for (const kind of [null, 'cash', false, {}])
    assert.equal(
      supportContentDraftSchema.safeParse({
        ...draft,
        faqs: [{ ...faq, purchaseMethodKind: kind }],
      }).success,
      false,
    );
});
