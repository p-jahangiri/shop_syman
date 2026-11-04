import { z } from '../config/schema-runtime.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => !/^0+$/.test(x));
const plain = (max: number, min = 0, single = false) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(
      (x) =>
        x === x.trim() &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x) &&
        !/\p{Surrogate}/u.test(x) &&
        (!single || !/[\n\t]/.test(x)),
    );
const faq = z
  .object({
    id,
    question: plain(240, 1, true),
    answer: plain(4000, 1),
    purchaseMethodKind: z.enum(['online', 'cheque', 'installment']).optional(),
  })
  .strict();
const fields = {
  isDemo: z.boolean(),
  eyebrow: plain(140, 0, true),
  title: plain(200, 1, true),
  description: plain(1000),
  ticketsAction: plain(100, 1, true),
  faqTitle: plain(150, 1, true),
  faqDescription: plain(1000),
};
export const supportContentDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...fields,
    faqs: z.array(faq.extend({ enabled: z.boolean() }).strict()).max(30),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.faqs.map((f) => f.id)).size === x.faqs.length &&
      new TextEncoder().encode(JSON.stringify(x)).length <= 100000,
  );
export const supportContentPublicSchema = z
  .object({ ...fields, faqs: z.array(faq).max(30) })
  .strict()
  .refine((x) => new Set(x.faqs.map((f) => f.id)).size === x.faqs.length);
export const supportContentPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    revision: z.number().int().min(0).max(2147483647),
    content: supportContentPublicSchema.nullable(),
  })
  .strict()
  .refine((x) => (x.revision === 0) === (x.content === null));
export type SupportContentDraft = z.infer<typeof supportContentDraftSchema>;
export type SupportContentPage = z.infer<typeof supportContentPageSchema>;
export function readSupportContent(raw: unknown, locale: 'fa' | 'en') {
  const result = supportContentPageSchema.parse(raw);
  if (result.locale !== locale) throw Error('Support content belongs to another language.');
  return result;
}
export function emptySupportContent(locale: 'fa' | 'en'): SupportContentDraft {
  return {
    schemaVersion: 1,
    isDemo: false,
    eyebrow: '',
    title: locale === 'fa' ? 'راهنما و پشتیبانی' : 'Help and support',
    description: '',
    ticketsAction:
      locale === 'fa' ? 'ثبت و پیگیری درخواست پشتیبانی' : 'Send and track a support request',
    faqTitle: locale === 'fa' ? 'پرسش‌های متداول' : 'Frequently asked questions',
    faqDescription: '',
    faqs: [],
  };
}

const revisionId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((x) => /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n);
export const supportContentRevisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    revisionId,
    revision: z.number().int().min(1).max(2147483647),
    content: supportContentDraftSchema,
  })
  .strict();
export function readSupportContentRevision(raw: unknown, locale: 'fa' | 'en', id: string) {
  const result = supportContentRevisionSchema.parse(raw);
  if (result.locale !== locale || result.revisionId !== revisionId.parse(id))
    throw Error('Support revision belongs to another document or language.');
  return result;
}
