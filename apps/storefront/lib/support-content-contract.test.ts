import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptySupportContent,
  readSupportContent,
  readSupportContentRevision,
  supportContentDraftSchema,
  supportContentPageSchema,
} from './support-content-contract.ts';
const draft = () => ({
  ...emptySupportContent('fa'),
  faqs: [
    { id: 'a'.repeat(32), question: 'پرسش نمونه؟', answer: '<b>متن ساده</b>\nپاسخ', enabled: true },
  ],
});
const page = () => {
  const { schemaVersion, ...content } = draft();
  return {
    schemaVersion,
    locale: 'fa' as const,
    revision: 1,
    content: { ...content, faqs: content.faqs.map(({ enabled, ...faq }) => faq) },
  };
};
test('support public decoder binds locale and publication, rejects draft fields and preserves plain text', () => {
  const value = page();
  assert.deepEqual(readSupportContent(value, 'fa'), value);
  assert.throws(() => readSupportContent(value, 'en'));
  for (const bad of [
    { ...value, draftJson: 'private' },
    { ...value, revision: 0 },
    { ...value, content: null },
    { ...value, content: { ...value.content, faqs: draft().faqs } },
    { ...value, content: { ...value.content, updatedBy: 'owner' } },
  ])
    assert.equal(supportContentPageSchema.safeParse(bad).success, false);
  assert.deepEqual(
    readSupportContent({ schemaVersion: 1, locale: 'en', revision: 0, content: null }, 'en')
      .content,
    null,
  );
});
test('support draft decoder requires canonical unique ids, booleans, bounded complete plain text', () => {
  const value = draft();
  assert.equal(supportContentDraftSchema.safeParse(value).success, true);
  for (const bad of [
    { ...value, isDemo: 'false' },
    { ...value, title: ' hidden ' },
    { ...value, unknown: true },
    { ...value, faqs: [value.faqs[0], value.faqs[0]] },
    { ...value, faqs: [{ ...value.faqs[0], id: '0'.repeat(32) }] },
    { ...value, faqs: [{ ...value.faqs[0], id: 'A'.repeat(32) }] },
    { ...value, faqs: [{ ...value.faqs[0], enabled: false, answer: '' }] },
    { ...value, faqs: [{ ...value.faqs[0], question: 'a\nb' }] },
    { ...value, description: 'a\u202eb' },
    { ...value, description: 'a\ud800b' },
    {
      ...value,
      faqs: Array.from({ length: 31 }, (_, i) => ({
        ...value.faqs[0],
        id: (i + 1).toString(16).padStart(32, '0'),
      })),
    },
  ])
    assert.equal(supportContentDraftSchema.safeParse(bad).success, false);
  assert.equal(
    supportContentDraftSchema.safeParse({ ...value, description: 'لپتاپ 😀' }).success,
    true,
  );
});
test('private historical preview is scoped to the exact locale and decimal revision id', () => {
  const value = {
    schemaVersion: 1,
    locale: 'fa',
    revisionId: '9223372036854775807',
    revision: 3,
    content: draft(),
  };
  assert.deepEqual(readSupportContentRevision(value, 'fa', value.revisionId), value);
  for (const bad of [
    { ...value, revisionId: '01' },
    { ...value, revisionId: '9223372036854775808' },
    { ...value, revisionId: 1 },
    { ...value, content: page().content },
    { ...value, revision: 0 },
  ])
    assert.throws(() => readSupportContentRevision(bad, 'fa', value.revisionId));
  assert.throws(() => readSupportContentRevision(value, 'en', value.revisionId));
  assert.throws(() => readSupportContentRevision(value, 'fa', '2'));
});
