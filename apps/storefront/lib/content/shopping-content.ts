import 'server-only';
import { cache } from 'react';
import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';

const question = z.object({ question: z.string().max(240), answer: z.string().max(1200) });
const help = z.object({
  development: z.boolean(),
  configured: z.boolean(),
  questionsIsDemo: z.boolean(),
  accessoriesIsDemo: z.boolean(),
  accessoryIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(8),
  questions: z.array(question).max(10),
  publishedAnswers: z
    .array(question.extend({ publishedAt: z.iso.datetime({ offset: true }) }))
    .max(50)
    .default([]),
});
const news = z.object({
  development: z.boolean(),
  feed: z.object({
    items: z
      .array(
        z.object({
          title: z.string().max(240),
          url: z
            .string()
            .regex(
              /^https:\/\/(?:www\.apple\.com\/newsroom\/|www\.zoomit\.ir\/|digiato\.com\/|www\.mobile\.ir\/news\/view-|gadgetnews\.net\/|itresan\.com\/)[^\s]+$/,
            ),
          source: z
            .enum([
              'Apple Newsroom',
              'زومیت',
              'دیجیاتو',
              'مرجع موبایل ایران',
              'گجت‌نیوز',
              'آی‌تی‌رسان',
            ])
            .optional(),
          summary: z.string().max(281).nullish(),
          imageUrl: z
            .string()
            .max(1000)
            .regex(
              /^https:\/\/(?:s\.mobile\.ir\/Static\/cache\/newsthumbs\/|gadgetnews\.net\/wp-content\/uploads\/)[^\s?#]+\.(?:jpe?g|png|webp)$/i,
            )
            .nullish(),
          publishedAt: z.iso.datetime({ offset: true }),
        }),
      )
      .max(20),
    refreshedAt: z.iso.datetime({ offset: true }).nullish(),
    stale: z.boolean(),
  }),
});

async function read(path: string, timeout = 1600): Promise<unknown> {
  if (process.env.SHOP_DATA_MODE !== 'api' || !process.env.SHOP_API_URL) return null;
  try {
    const response = await fetch(new URL('/api/content/' + path, process.env.SHOP_API_URL), {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export const getProductHelp = cache(async (locale: 'fa' | 'en', id: string) => {
  const result = help.safeParse(
    await read('product-help/' + locale + '/' + encodeURIComponent(id)),
  );
  return result.success ? result.data : null;
});

export async function developmentExamples() {
  return (await getProductHelp('fa', 'examples'))?.development === true;
}

export async function getOfficialNews(locale: 'fa' | 'en') {
  const result = news.safeParse(await read(locale === 'fa' ? 'news/fa' : 'news', 7200));
  return result.success ? result.data : null;
}
