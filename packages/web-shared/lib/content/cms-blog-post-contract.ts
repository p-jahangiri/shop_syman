import { z } from '../config/schema-runtime.ts';
import {
  cmsPageId as id,
  cmsPageSlug as slug,
  cmsPageImage as image,
  cmsPageContentSchema,
  publishedCmsPageContent,
  cmsPublicPageSchema,
} from './cms-page-contract.ts';
import { notificationTicks } from '../notifications/notification-contract.ts';
const line = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (v) =>
        v === v.trim() &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(v) &&
        Array.from(v).every(
          (c) => c.length !== 1 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff,
        ),
    );
const nonempty = (max: number) => line(max).refine((v) => v.length > 0),
  utc = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  version = z
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
  publication = z.number().int().min(0).max(10000),
  action = z.enum(['Create', 'Save', 'Publish', 'Restore', 'Unpublish']);
export const cmsBlogTagSchema = z.strictObject({
  slug,
  nameFa: nonempty(60),
  nameEn: nonempty(60),
});
const tags = z
  .array(cmsBlogTagSchema)
  .max(8)
  .refine((x) => x.every((t, i) => i === 0 || x[i - 1].slug < t.slug));
export const cmsBlogContentSchema = z
  .strictObject({
    body: cmsPageContentSchema,
    authorKind: z.enum(['Person', 'Organization']).nullable(),
    bylineFa: line(120),
    bylineEn: line(120),
    cover: image.nullable(),
    coverAltFa: nonempty(240).nullable(),
    coverAltEn: nonempty(240).nullable(),
    tags,
  })
  .refine(
    (x) =>
      (x.authorKind !== null || (x.bylineFa === '' && x.bylineEn === '')) &&
      (x.cover === null
        ? x.coverAltFa === null && x.coverAltEn === null
        : x.coverAltFa !== null && x.coverAltEn !== null) &&
      new TextEncoder().encode(JSON.stringify(x)).length <= 65536,
  );
export function publishedCmsBlogContent(value: unknown) {
  const x = cmsBlogContentSchema.parse(value);
  publishedCmsPageContent(x.body);
  if (x.authorKind === null || !x.bylineFa || !x.bylineEn)
    throw Error('Review the explicit bilingual public author');
  return x;
}
export const cmsBlogPostInputSchema = z
  .strictObject({
    action,
    version: version.nullable().optional(),
    slug: slug.nullable().optional(),
    isDemo: z.boolean().nullable().optional(),
    content: cmsBlogContentSchema.nullable().optional(),
    restoreRevisionId: id.nullable().optional(),
    confirmed: z.boolean().optional(),
  })
  .superRefine((x, c) => {
    const fail = () => c.addIssue({ code: 'custom', message: 'Invalid article command' });
    if (x.action === 'Create') {
      if (
        x.version != null ||
        !x.slug ||
        typeof x.isDemo !== 'boolean' ||
        !x.content ||
        x.restoreRevisionId != null ||
        x.confirmed
      )
        fail();
    } else if (!x.version || x.slug != null || x.isDemo != null) fail();
    if (x.action === 'Save' && (!x.content || x.restoreRevisionId != null || x.confirmed)) fail();
    if (
      ['Publish', 'Restore', 'Unpublish'].includes(x.action) &&
      (x.confirmed !== true || x.content != null)
    )
      fail();
    if (x.action === 'Restore' ? !x.restoreRevisionId : x.restoreRevisionId != null) fail();
  });
export const cmsBlogPostResultSchema = z
  .strictObject({
    commandId: id,
    postId: id,
    slug,
    version,
    action,
    publication,
    revisionId: id.nullable(),
    publishedRevisionId: id.nullable(),
    draftHash: hash,
    replayed: z.boolean(),
  })
  .refine(
    (x) =>
      (['Publish', 'Restore', 'Unpublish'].includes(x.action)
        ? x.revisionId !== null
        : x.revisionId === null) &&
      (x.action !== 'Unpublish' || x.publishedRevisionId === null) &&
      (!['Publish', 'Restore'].includes(x.action) || x.revisionId === x.publishedRevisionId) &&
      (x.action !== 'Create' || (x.publication === 0 && x.publishedRevisionId === null)),
  );
export const cmsBlogPostDetailSchema = z
  .strictObject({
    id,
    slug,
    isDemo: z.boolean(),
    version,
    publication,
    publishedRevisionId: id.nullable(),
    draft: cmsBlogContentSchema,
    published: cmsBlogContentSchema.nullable(),
    firstPublishedAt: utc.nullable(),
    draftHash: hash,
  })
  .refine(
    (x) =>
      (x.published === null) === (x.publishedRevisionId === null) &&
      (x.firstPublishedAt === null) === (x.publication === 0) &&
      (x.publication !== 0 || x.publishedRevisionId === null),
  )
  .superRefine((x, c) => {
    if (x.published)
      try {
        publishedCmsBlogContent(x.published);
      } catch {
        c.addIssue({ code: 'custom', message: 'Invalid published article' });
      }
  });
export const cmsBlogPostListSchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          id,
          slug,
          isDemo: z.boolean(),
          version,
          publication,
          publishedRevisionId: id.nullable(),
          updatedAt: utc,
        }),
      )
      .max(50),
    nextCursor: slug.nullable(),
  })
  .refine(
    (x) =>
      x.items.every((r, i) => i === 0 || x.items[i - 1].slug < r.slug) &&
      new Set(x.items.map((r) => r.id)).size === x.items.length &&
      (x.nextCursor === null || (x.items.length === 50 && x.nextCursor === x.items[49].slug)),
  );
const revision = z.strictObject({
  id,
  publication: z.number().int().min(1).max(10000),
  action: z.enum(['Publish', 'Restore', 'Unpublish']),
  at: utc,
});
export const cmsBlogPostHistorySchema = z
  .strictObject({
    items: z.array(revision).max(20),
    nextBefore: z.number().int().min(1).max(10000).nullable(),
  })
  .refine(
    (x) =>
      x.items.every((r, i) => i === 0 || x.items[i - 1].publication === r.publication + 1) &&
      new Set(x.items.map((r) => r.id)).size === x.items.length &&
      (x.nextBefore === null ||
        (x.items.length === 20 && x.nextBefore === x.items[19].publication)),
  );
export const cmsBlogPostRevisionSchema = z
  .strictObject({ postId: id, slug, isDemo: z.boolean(), revision, content: cmsBlogContentSchema })
  .superRefine((x, c) => {
    try {
      publishedCmsBlogContent(x.content);
    } catch {
      c.addIssue({ code: 'custom', message: 'Invalid article history' });
    }
  });
const publicTag = z.strictObject({ slug, name: nonempty(60) }),
  publicBase = {
    id,
    slug,
    locale: z.enum(['fa', 'en']),
    revisionId: id,
    firstPublishedAt: utc,
    publishedAt: utc,
    isDemo: z.boolean(),
    title: cmsPublicPageSchema.shape.title,
    description: cmsPublicPageSchema.shape.description,
    authorKind: z.enum(['Person', 'Organization']),
    byline: nonempty(120),
    cover: image.nullable(),
    coverAlt: nonempty(240).nullable(),
    tags: z
      .array(publicTag)
      .max(8)
      .refine((x) => x.every((t, i) => i === 0 || x[i - 1].slug < t.slug)),
  };
const validPublic = (x: {
  firstPublishedAt: string;
  publishedAt: string;
  cover: string | null;
  coverAlt: string | null;
}) =>
  notificationTicks(x.firstPublishedAt) <= notificationTicks(x.publishedAt) &&
  (x.cover === null) === (x.coverAlt === null);
export const cmsPublicBlogPostSchema = z
  .strictObject({
    ...publicBase,
    schemaVersion: z.literal(1),
    blocks: cmsPublicPageSchema.shape.blocks,
  })
  .refine(validPublic);
export const cmsBlogPublicSummarySchema = z.strictObject(publicBase).refine(validPublic);
export const cmsBlogPublicListSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    tag: slug.nullable(),
    items: z.array(cmsBlogPublicSummarySchema).max(20),
    nextCursor: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullable(),
  })
  .refine(
    (x) =>
      x.items.every(
        (r, i) =>
          r.locale === x.locale &&
          (x.tag === null || r.tags.some((t) => t.slug === x.tag)) &&
          (i === 0 ||
            notificationTicks(x.items[i - 1].firstPublishedAt) >
              notificationTicks(r.firstPublishedAt) ||
            (notificationTicks(x.items[i - 1].firstPublishedAt) ===
              notificationTicks(r.firstPublishedAt) &&
              x.items[i - 1].id > r.id)),
      ) &&
      new Set(x.items.map((r) => r.id)).size === x.items.length &&
      (x.nextCursor === null || x.items.length === 20),
  );
export const cmsBlogPostCommandSchema = z
  .strictObject({
    id,
    postId: id.nullable(),
    input: cmsBlogPostInputSchema,
    previous: cmsBlogPostDetailSchema.nullable(),
  })
  .refine(
    (x) =>
      (x.postId === null) === (x.input.action === 'Create') &&
      (x.postId === null
        ? x.previous === null
        : x.previous?.id === x.postId && x.previous.version === x.input.version),
  )
  .superRefine((x, c) => {
    if (x.input.action === 'Publish')
      try {
        publishedCmsBlogContent(x.previous?.draft);
      } catch {
        c.addIssue({
          code: 'custom',
          message: 'Publication requires the exact complete stored draft',
        });
      }
    if (x.input.action === 'Unpublish' && !x.previous?.published)
      c.addIssue({ code: 'custom', message: 'Article is not published' });
  });
export type CmsBlogContent = z.infer<typeof cmsBlogContentSchema>;
export type CmsBlogPostCommand = z.infer<typeof cmsBlogPostCommandSchema>;
export type CmsBlogPostInput = z.infer<typeof cmsBlogPostInputSchema>;
export type CmsBlogPostDetail = z.infer<typeof cmsBlogPostDetailSchema>;
export type CmsBlogPostResult = z.infer<typeof cmsBlogPostResultSchema>;
export type CmsPublicBlogPost = z.infer<typeof cmsPublicBlogPostSchema>;
export type CmsBlogPublicList = z.infer<typeof cmsBlogPublicListSchema>;
export function cmsBlogPostCommandPath(c: CmsBlogPostCommand) {
  cmsBlogPostCommandSchema.parse(c);
  return '/admin/blog-posts' + (c.postId ? '/' + c.postId : '') + '/commands/' + c.id;
}
export function readCmsBlogPostResult(raw: unknown, command: CmsBlogPostCommand) {
  const c = cmsBlogPostCommandSchema.parse(command),
    r = cmsBlogPostResultSchema.parse(raw),
    p = c.previous,
    publicationChanged = ['Publish', 'Restore', 'Unpublish'].includes(c.input.action);
  if (
    r.commandId !== c.id ||
    r.action !== c.input.action ||
    (c.postId !== null && r.postId !== c.postId) ||
    (p && r.slug !== p.slug) ||
    (c.input.action === 'Create' && r.slug !== c.input.slug) ||
    (p &&
      (r.version === p.version ||
        r.publication !== p.publication + (publicationChanged ? 1 : 0) ||
        (!publicationChanged && r.publishedRevisionId !== p.publishedRevisionId) ||
        (publicationChanged &&
          (r.draftHash !== p.draftHash ||
            r.revisionId === p.publishedRevisionId ||
            (c.input.action === 'Restore' && r.revisionId === c.input.restoreRevisionId)))))
  )
    throw Error('Unrelated article receipt');
  return r;
}
export const emptyCmsBlogContent = (): CmsBlogContent => ({
  body: {
    fa: { title: '', description: '', blocks: [] },
    en: { title: '', description: '', blocks: [] },
  },
  authorKind: null,
  bylineFa: '',
  bylineEn: '',
  cover: null,
  coverAltFa: null,
  coverAltEn: null,
  tags: [],
});
