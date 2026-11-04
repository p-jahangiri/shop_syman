import { z } from '../config/schema-runtime.ts';
export const redirectId = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((v) => !/^0+$/.test(v));
export const redirectSource = z
  .string()
  .max(192)
  .regex(/^\/(fa|en)\/(product|pages)\/[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine(
    (v) =>
      !/[\s]/.test(v) &&
      (v.split('/')[3]?.length ?? Infinity) <= (v.split('/')[2] === 'pages' ? 80 : 150),
  );
const landing = z
  .string()
  .regex(/^\/(fa|en)(?:\/(catalog|moments|support))?$/)
  .refine((v) => !/[\s]/.test(v));
export const redirectTarget = z.union([redirectSource, landing]);
export const validRedirectTarget = (source: string, target: string) =>
  redirectSource.safeParse(source).success &&
  redirectTarget.safeParse(target).success &&
  source !== target &&
  source.slice(1, 3) === target.slice(1, 3);
const status = z.union([z.literal(301), z.literal(302)]),
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
  publication = z.number().int().min(0).max(10000),
  utc = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const action = z.enum(['Create', 'Save', 'Publish', 'Restore', 'Unpublish']);
export const redirectDraftSchema = z.strictObject({
  targetPath: redirectTarget.nullable(),
  status: status.nullable(),
});
const revision = z.strictObject({
  id: redirectId,
  publication: z.number().int().min(1).max(10000),
  action: z.enum(['Publish', 'Restore', 'Unpublish']),
  targetPath: redirectTarget,
  status,
  at: utc,
});
export const redirectInputSchema = z
  .strictObject({
    action,
    version: version.nullable().optional(),
    sourcePath: redirectSource.nullable().optional(),
    isDemo: z.boolean().nullable().optional(),
    targetPath: redirectTarget.nullable().optional(),
    status: status.nullable().optional(),
    restoreRevisionId: redirectId.nullable().optional(),
    confirmed: z.boolean().optional(),
  })
  .superRefine((v, c) => {
    const fail = () => c.addIssue({ code: 'custom', message: 'Invalid redirect operation' });
    if (v.action === 'Create') {
      if (
        v.sourcePath == null ||
        typeof v.isDemo !== 'boolean' ||
        v.version != null ||
        v.restoreRevisionId != null ||
        v.confirmed ||
        (v.targetPath != null && !validRedirectTarget(v.sourcePath, v.targetPath))
      )
        fail();
    } else if (!v.version || v.sourcePath != null || v.isDemo != null) fail();
    if (v.action === 'Save' && (v.restoreRevisionId != null || v.confirmed)) fail();
    if (
      ['Publish', 'Restore', 'Unpublish'].includes(v.action) &&
      (v.confirmed !== true || v.targetPath != null || v.status != null)
    )
      fail();
    if (v.action === 'Restore' ? !v.restoreRevisionId : v.restoreRevisionId != null) fail();
  });
export const redirectDetailSchema = z
  .strictObject({
    id: redirectId,
    sourcePath: redirectSource,
    isDemo: z.boolean(),
    version,
    publication,
    draft: redirectDraftSchema,
    published: revision.nullable(),
  })
  .refine(
    (v) =>
      (v.draft.targetPath === null || validRedirectTarget(v.sourcePath, v.draft.targetPath)) &&
      (v.published === null ||
        (v.published.action !== 'Unpublish' &&
          v.published.publication === v.publication &&
          validRedirectTarget(v.sourcePath, v.published.targetPath))),
  );
export const redirectListSchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          id: redirectId,
          sourcePath: redirectSource,
          isDemo: z.boolean(),
          version,
          publication,
          publishedRevisionId: redirectId.nullable(),
          updatedAt: utc,
        }),
      )
      .max(50),
    nextCursor: redirectSource.nullable(),
  })
  .refine(
    (v) =>
      new Set(v.items.map((x) => x.id)).size === v.items.length &&
      new Set(v.items.map((x) => x.sourcePath)).size === v.items.length &&
      (v.nextCursor === null || (v.items.length === 50 && v.nextCursor === v.items[49].sourcePath)),
  );
export const redirectHistorySchema = z
  .strictObject({
    items: z.array(revision).max(20),
    nextBefore: z.number().int().min(1).max(10000).nullable(),
  })
  .refine(
    (v) =>
      new Set(v.items.map((x) => x.id)).size === v.items.length &&
      v.items.every((x, i) => i === 0 || v.items[i - 1].publication === x.publication + 1) &&
      (v.nextBefore === null ||
        (v.items.length === 20 && v.nextBefore === v.items[19].publication)),
  );
export const redirectRevisionSchema = z
  .strictObject({ redirectId, sourcePath: redirectSource, isDemo: z.boolean(), revision })
  .refine((v) => validRedirectTarget(v.sourcePath, v.revision.targetPath));
export const redirectPreviewSchema = z
  .strictObject({
    redirectId,
    sourcePath: redirectSource,
    isDemo: z.boolean(),
    version,
    draft: redirectDraftSchema,
    canPublish: z.boolean(),
    blockers: z
      .array(
        z.enum([
          'target_required',
          'status_required',
          'cycle',
          'chain_too_long',
          'history_capacity',
        ]),
      )
      .max(5),
    chain: z.array(redirectTarget).min(1).max(7),
  })
  .refine(
    (v) =>
      v.canPublish === (v.blockers.length === 0) &&
      v.chain[0] === v.sourcePath &&
      new Set(v.blockers).size === v.blockers.length &&
      (v.draft.targetPath === null || validRedirectTarget(v.sourcePath, v.draft.targetPath)) &&
      (!v.canPublish || (v.draft.targetPath !== null && v.draft.status !== null)),
  );
export const redirectResultSchema = z
  .strictObject({
    commandId: redirectId,
    redirectId,
    sourcePath: redirectSource,
    isDemo: z.boolean(),
    version,
    action,
    publication,
    revisionId: redirectId.nullable(),
    publishedRevisionId: redirectId.nullable(),
    draft: redirectDraftSchema,
    replayed: z.boolean(),
  })
  .refine(
    (v) =>
      (v.draft.targetPath === null || validRedirectTarget(v.sourcePath, v.draft.targetPath)) &&
      (['Publish', 'Restore', 'Unpublish'].includes(v.action)
        ? v.revisionId !== null && v.publication > 0
        : v.revisionId === null) &&
      (v.action !== 'Unpublish' || v.publishedRevisionId === null) &&
      (!['Publish', 'Restore'].includes(v.action) || v.revisionId === v.publishedRevisionId) &&
      (v.action !== 'Create' || (v.publication === 0 && v.publishedRevisionId === null)),
  );
export const redirectResolutionSchema = z
  .strictObject({
    version: z.literal(1),
    dataSource: z.literal('api'),
    sourcePath: redirectSource,
    found: z.boolean(),
    isDemo: z.boolean(),
    targetPath: redirectTarget.nullable(),
    status: status.nullable(),
  })
  .refine((v) =>
    v.found
      ? v.targetPath !== null &&
        v.status !== null &&
        validRedirectTarget(v.sourcePath, v.targetPath)
      : v.targetPath === null && v.status === null && !v.isDemo,
  );
export const redirectCommandSchema = z
  .strictObject({ id: redirectId, redirectId: redirectId.nullable(), input: redirectInputSchema })
  .refine((v) => (v.redirectId === null) === (v.input.action === 'Create'));
export type RedirectInput = z.infer<typeof redirectInputSchema>;
export type RedirectDetail = z.infer<typeof redirectDetailSchema>;
export type RedirectPreview = z.infer<typeof redirectPreviewSchema>;
export type RedirectResult = z.infer<typeof redirectResultSchema>;
export type RedirectCommand = z.infer<typeof redirectCommandSchema>;
export type RedirectResolution = z.infer<typeof redirectResolutionSchema>;
export function redirectCommandPath(c: RedirectCommand) {
  redirectCommandSchema.parse(c);
  return `/admin/redirects${c.redirectId ? '/' + c.redirectId : ''}/commands/${c.id}`;
}
export function readRedirectResult(raw: unknown, c: RedirectCommand) {
  const r = redirectResultSchema.parse(raw),
    i = c.input;
  if (
    r.commandId !== c.id ||
    r.action !== i.action ||
    (c.redirectId !== null && r.redirectId !== c.redirectId) ||
    (i.action === 'Create' && (r.sourcePath !== i.sourcePath || r.isDemo !== i.isDemo)) ||
    (['Create', 'Save'].includes(i.action) &&
      (r.draft.targetPath !== (i.targetPath ?? null) || r.draft.status !== (i.status ?? null)))
  )
    throw Error('Unrelated redirect receipt');
  return r;
}
