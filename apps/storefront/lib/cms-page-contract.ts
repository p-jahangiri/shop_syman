import { z } from './schema-runtime.ts';
export const cmsPageId = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((v) => !/^0+$/.test(v));
export const cmsPageSlug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (v) =>
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(v) &&
        Array.from(v).every(
          (c) => c.length !== 1 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff,
        ),
      'Invalid text',
    );
export const cmsPageInternalPath = z
  .string()
  .min(1)
  .max(1500)
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  .refine((v) => v.startsWith('/') && !v.startsWith('//') && !/[\\%\s\x00-\x1f\x7f-\x9f]/u.test(v));
export const cmsPageImage = z
  .string()
  .max(160)
  .regex(
    /^\/(?:products\/[a-zA-Z0-9-]+\.(?:svg|png|jpg|webp)|media\/catalog\/[a-f0-9]{32}\/(?:thumb|card|zoom)\.webp)$/,
  );
const base = { id: cmsPageId, visibility: z.enum(['All', 'Mobile', 'Desktop']) };
export const cmsPageBlockSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...base,
    kind: z.literal('Text'),
    heading: text(240),
    text: text(8000).refine((v) => v.trim().length > 0),
    image: z.null().optional(),
    alt: z.null().optional(),
    links: z.null().optional(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('Callout'),
    heading: text(240),
    text: text(8000).refine((v) => v.trim().length > 0),
    image: z.null().optional(),
    alt: z.null().optional(),
    links: z.null().optional(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('Image'),
    heading: z.null().optional(),
    text: z.null().optional(),
    image: cmsPageImage,
    alt: text(240).refine((v) => v.trim().length > 0),
    links: z.null().optional(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('Links'),
    heading: text(240),
    text: z.null().optional(),
    image: z.null().optional(),
    alt: z.null().optional(),
    links: z
      .array(
        z.strictObject({
          label: text(150).refine((v) => v.trim().length > 0),
          href: cmsPageInternalPath,
        }),
      )
      .min(1)
      .max(12),
  }),
]);
const language = z.strictObject({
  title: text(200),
  description: text(400),
  blocks: z
    .array(cmsPageBlockSchema)
    .max(20)
    .refine((a) => new Set(a.map((b) => b.id)).size === a.length),
});
export const cmsPageContentSchema = z
  .strictObject({ fa: language, en: language })
  .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= 65536);
export function publishedCmsPageContent(v: unknown) {
  const c = cmsPageContentSchema.parse(v);
  if ([c.fa, c.en].some((x) => !x.title.trim() || !x.blocks.length))
    throw Error('Both page languages must be complete');
  return c;
}
const version = z
    .string()
    .regex(/^[A-Za-z0-9+/]{11}=$/)
    .refine((v) => {
      try {
        return btoa(atob(v)) === v && atob(v).length === 8;
      } catch {
        return false;
      }
    }),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  utc = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const publication = z.number().int().min(0).max(10000),
  action = z.enum(['Create', 'Save', 'Publish', 'Restore', 'Unpublish']);
export const cmsPageInputSchema = z
  .strictObject({
    action,
    version: version.nullable().optional(),
    slug: cmsPageSlug.nullable().optional(),
    isDemo: z.boolean().nullable().optional(),
    content: cmsPageContentSchema.nullable().optional(),
    restoreRevisionId: cmsPageId.nullable().optional(),
    confirmed: z.boolean().optional(),
  })
  .superRefine((v, c) => {
    const fail = () => c.addIssue({ code: 'custom', message: 'Invalid page operation' });
    if (v.action === 'Create') {
      if (
        v.version != null ||
        !v.slug ||
        typeof v.isDemo !== 'boolean' ||
        !v.content ||
        v.restoreRevisionId != null ||
        v.confirmed
      )
        fail();
    } else if (!v.version || v.slug != null || v.isDemo != null) fail();
    if (v.action === 'Save' && (!v.content || v.restoreRevisionId != null || v.confirmed)) fail();
    if (
      ['Publish', 'Restore', 'Unpublish'].includes(v.action) &&
      (v.confirmed !== true || v.content != null)
    )
      fail();
    if (v.action === 'Restore' ? !v.restoreRevisionId : v.restoreRevisionId != null) fail();
  });
export const cmsPageResultSchema = z
  .strictObject({
    commandId: cmsPageId,
    pageId: cmsPageId,
    slug: cmsPageSlug,
    version,
    action,
    publication,
    revisionId: cmsPageId.nullable(),
    publishedRevisionId: cmsPageId.nullable(),
    draftHash: hash,
    replayed: z.boolean(),
  })
  .superRefine((v, c) => {
    if (
      (['Publish', 'Restore', 'Unpublish'].includes(v.action)
        ? v.revisionId === null
        : v.revisionId !== null) ||
      (v.action === 'Unpublish' && v.publishedRevisionId !== null) ||
      (['Publish', 'Restore'].includes(v.action) && v.revisionId !== v.publishedRevisionId) ||
      (v.action === 'Create' && (v.publication !== 0 || v.publishedRevisionId !== null))
    )
      c.addIssue({ code: 'custom', message: 'Page receipt bindings' });
  });
export const cmsPageDetailSchema = z
  .strictObject({
    id: cmsPageId,
    slug: cmsPageSlug,
    isDemo: z.boolean(),
    version,
    publication,
    publishedRevisionId: cmsPageId.nullable(),
    draft: cmsPageContentSchema,
    published: cmsPageContentSchema.nullable(),
  })
  .refine((v) => (v.published === null) === (v.publishedRevisionId === null))
  .superRefine((v, c) => {
    if (v.published)
      try {
        publishedCmsPageContent(v.published);
      } catch {
        c.addIssue({ code: 'custom', message: 'Invalid published page' });
      }
  });
export const cmsPageListSchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          id: cmsPageId,
          slug: cmsPageSlug,
          isDemo: z.boolean(),
          version,
          publication,
          publishedRevisionId: cmsPageId.nullable(),
          updatedAt: utc,
        }),
      )
      .max(50),
    nextCursor: cmsPageSlug.nullable(),
  })
  .refine(
    (v) =>
      v.items.every((x, i) => i === 0 || v.items[i - 1].slug < x.slug) &&
      new Set(v.items.map((x) => x.id)).size === v.items.length &&
      (v.nextCursor === null || (v.items.length === 50 && v.nextCursor === v.items[49].slug)),
  );
const revision = z.strictObject({
  id: cmsPageId,
  publication: z.number().int().min(1).max(10000),
  action: z.enum(['Publish', 'Restore', 'Unpublish']),
  at: utc,
});
export const cmsPageHistorySchema = z
  .strictObject({
    items: z.array(revision).max(20),
    nextBefore: z.number().int().min(1).max(10000).nullable(),
  })
  .refine(
    (v) =>
      v.items.every((x, i) => i === 0 || v.items[i - 1].publication === x.publication + 1) &&
      new Set(v.items.map((x) => x.id)).size === v.items.length &&
      (v.nextBefore === null ||
        (v.items.length === 20 && v.nextBefore === v.items[19].publication)),
  );
export const cmsPageRevisionSchema = z
  .strictObject({
    pageId: cmsPageId,
    slug: cmsPageSlug,
    isDemo: z.boolean(),
    revision,
    content: cmsPageContentSchema,
  })
  .superRefine((v, c) => {
    try {
      publishedCmsPageContent(v.content);
    } catch {
      c.addIssue({ code: 'custom', message: 'Invalid page revision' });
    }
  });
export const cmsPublicPageSchema = z.strictObject({
  id: cmsPageId,
  slug: cmsPageSlug,
  locale: z.enum(['fa', 'en']),
  revisionId: cmsPageId,
  publishedAt: utc,
  isDemo: z.boolean(),
  title: text(200).refine((v) => v.trim().length > 0),
  description: text(400),
  blocks: z
    .array(cmsPageBlockSchema)
    .min(1)
    .max(20)
    .refine((v) => new Set(v.map((b) => b.id)).size === v.length),
});
export type CmsPageContent = z.infer<typeof cmsPageContentSchema>;
export type CmsPageBlock = z.infer<typeof cmsPageBlockSchema>;
export type CmsPageInput = z.infer<typeof cmsPageInputSchema>;
export type CmsPageResult = z.infer<typeof cmsPageResultSchema>;
export type CmsPageDetail = z.infer<typeof cmsPageDetailSchema>;
export type CmsPageRevision = z.infer<typeof cmsPageRevisionSchema>;
export type CmsPublicPage = z.infer<typeof cmsPublicPageSchema>;
export const cmsPageCommandSchema = z
  .strictObject({ id: cmsPageId, pageId: cmsPageId.nullable(), input: cmsPageInputSchema })
  .refine((v) => (v.pageId === null) === (v.input.action === 'Create'));
export type CmsPageCommand = z.infer<typeof cmsPageCommandSchema>;
export function cmsPageCommandPath(c: CmsPageCommand) {
  cmsPageCommandSchema.parse(c);
  return `/admin/pages${c.pageId ? '/' + c.pageId : ''}/commands/${c.id}`;
}
export function readCmsPageResult(raw: unknown, c: CmsPageCommand) {
  const r = cmsPageResultSchema.parse(raw);
  if (
    r.commandId !== c.id ||
    r.action !== c.input.action ||
    (c.pageId !== null && r.pageId !== c.pageId) ||
    (c.input.action === 'Create' && r.slug !== c.input.slug)
  )
    throw Error('Unrelated page receipt');
  return r;
}
export const emptyCmsPageContent = (): CmsPageContent => ({
  fa: { title: '', description: '', blocks: [] },
  en: { title: '', description: '', blocks: [] },
});
