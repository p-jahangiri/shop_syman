import { cmsPageSlug } from '@sayman/web-shared/lib/content/cms-page-contract.ts';
import {
  cmsPublicBlogPostSchema,
  cmsBlogPublicListSchema,
  type CmsPublicBlogPost,
  type CmsBlogPublicList,
} from '@sayman/web-shared/lib/content/cms-blog-post-contract.ts';
type Env = { SHOP_DATA_MODE?: string; SHOP_API_URL?: string };
export type BlogPostLoad =
  { status: 'ready'; post: CmsPublicBlogPost } | { status: 'missing' | 'unavailable'; post: null };
export type BlogListLoad =
  | { status: 'ready'; list: CmsBlogPublicList }
  | { status: 'invalid' | 'expired' | 'unavailable'; list: null };
export function blogListInput(tag: unknown, cursor: unknown) {
  if (
    (tag !== null && tag !== undefined && !cmsPageSlug.safeParse(tag).success) ||
    (cursor !== null &&
      cursor !== undefined &&
      (typeof cursor !== 'string' ||
        cursor.length < 1 ||
        cursor.length > 2048 ||
        !/^[A-Za-z0-9_-]+$/.test(cursor)))
  )
    return null;
  return { tag: (tag ?? null) as string | null, cursor: (cursor ?? null) as string | null };
}
async function bytes(response: Response, maximum: number) {
  if (Number(response.headers.get('Content-Length')) > maximum) {
    await response.body?.cancel();
    throw Error('Blog capacity');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty blog response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw Error('Blog capacity');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
}
async function remote(path: string, env: Env, fetcher: typeof fetch) {
  if ((env.SHOP_DATA_MODE ?? (env.SHOP_API_URL ? 'api' : 'preview')) !== 'api' || !env.SHOP_API_URL)
    throw Error('Blog API unavailable');
  const origin = new URL(env.SHOP_API_URL);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  )
    throw Error('API origin required');
  const response = await fetcher(origin.origin + '/api/content/blog/' + path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (response.headers.get('X-Sayman-Blog') !== '1' || response.headers.has('Set-Cookie')) {
    await response.body?.cancel();
    throw Error('Blog API not identified');
  }
  return response;
}
const json = (response: Response) =>
  /^application\/(?:json|problem\+json)(?:\s*;|$)/i.test(
    response.headers.get('Content-Type') ?? '',
  );
export async function fetchBlogPost(
  slug: string,
  locale: 'fa' | 'en',
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<BlogPostLoad> {
  if (!cmsPageSlug.safeParse(slug).success) return { status: 'missing', post: null };
  try {
    const response = await remote(locale + '/' + slug, env, fetcher);
    if (response.status === 404) {
      await response.body?.cancel();
      return { status: 'missing', post: null };
    }
    if (response.status !== 200 || !json(response)) {
      await response.body?.cancel();
      throw Error('Article unavailable');
    }
    const post = cmsPublicBlogPostSchema.parse(await bytes(response, 131072));
    if (post.slug !== slug || post.locale !== locale) throw Error('Unrelated article');
    return { status: 'ready', post };
  } catch {
    return { status: 'unavailable', post: null };
  }
}
export async function fetchBlogList(
  locale: 'fa' | 'en',
  tag: unknown,
  cursor: unknown,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<BlogListLoad> {
  const input = blogListInput(tag, cursor);
  if (!input) return { status: 'invalid', list: null };
  const params = new URLSearchParams();
  if (input.tag) params.set('tag', input.tag);
  if (input.cursor) params.set('cursor', input.cursor);
  try {
    const response = await remote(locale + (params.size ? '?' + params : ''), env, fetcher);
    if (response.status === 400) {
      await response.body?.cancel();
      return { status: 'invalid', list: null };
    }
    if (response.status === 409 && json(response)) {
      const problem = await bytes(response, 4096);
      if (problem?.title === 'cms_blog_cursor_expired_conflict')
        return { status: 'expired', list: null };
      throw Error('Blog conflict');
    }
    if (response.status !== 200 || !json(response)) {
      await response.body?.cancel();
      throw Error('Blog unavailable');
    }
    const list = cmsBlogPublicListSchema.parse(await bytes(response, 262144));
    if (list.locale !== locale || list.tag !== input.tag) throw Error('Unrelated blog filter');
    return { status: 'ready', list };
  } catch {
    return { status: 'unavailable', list: null };
  }
}
