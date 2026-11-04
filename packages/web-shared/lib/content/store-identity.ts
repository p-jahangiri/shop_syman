import { z } from '../config/schema-runtime.ts';

export const socialPlatforms = ['instagram', 'telegram', 'whatsapp', 'aparat', 'linkedin'] as const;
export type SocialPlatform = (typeof socialPlatforms)[number];
const hosts: Record<SocialPlatform, readonly string[]> = {
  instagram: ['instagram.com', 'www.instagram.com'],
  telegram: ['t.me'],
  whatsapp: ['wa.me'],
  aparat: ['aparat.com', 'www.aparat.com'],
  linkedin: ['linkedin.com', 'www.linkedin.com'],
};

export const socialLabels: Record<SocialPlatform, { fa: string; en: string; hint: string }> = {
  instagram: { fa: 'اینستاگرام', en: 'Instagram', hint: 'https://www.instagram.com/your_store' },
  telegram: { fa: 'تلگرام', en: 'Telegram', hint: 'https://t.me/your_store' },
  whatsapp: { fa: 'واتساپ', en: 'WhatsApp', hint: 'https://wa.me/989123456789' },
  aparat: { fa: 'آپارات', en: 'Aparat', hint: 'https://www.aparat.com/your_store' },
  linkedin: { fa: 'لینکدین', en: 'LinkedIn', hint: 'https://www.linkedin.com/company/your_store' },
};

export function publicHttpsUrl(value: string): URL | null {
  // Reject browser URL normalization, credentials, local destinations and executable input.
  if (
    value.length > 1500 ||
    !/^https:\/\/[a-z0-9.-]+(?:\/|$)/.test(value) ||
    // eslint-disable-next-line no-control-regex -- Reject URL and bidi controls before browser normalization.
    /[\s\\<>\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !url.hostname.includes('.') ||
      /^(?:\d+\.){3}\d+$/.test(url.hostname) ||
      /\.(?:localhost|local|internal)$/.test(url.hostname)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function isSocialUrl(platform: SocialPlatform, value: string): boolean {
  const url = publicHttpsUrl(value);
  if (!url || !hosts[platform].includes(url.hostname) || url.search) return false;
  if (platform === 'whatsapp') return /^\/[1-9][0-9]{7,14}\/?$/.test(url.pathname);
  if (platform === 'linkedin')
    return /^\/(?:company|in)\/[a-zA-Z0-9_-]{1,100}\/?$/.test(url.pathname);
  if (!/^\/[a-zA-Z0-9_.]{1,100}\/?$/.test(url.pathname)) return false;
  // These service endpoints are not public store profiles.
  return ![
    'accounts',
    'login',
    'explore',
    'reels',
    'p',
    'share',
    'addstickers',
    'addlist',
    'proxy',
    'socks',
    'iv',
    'login',
    'joinchat',
  ].includes(url.pathname.split('/')[1].toLowerCase());
}

export function normalizeSocialInput(platform: SocialPlatform, value: string): string {
  const input = value.trim();
  if (platform !== 'linkedin') return input;
  // LinkedIn's copy-link action may append tracking parameters. Keep only the public profile.
  const [profile] = input.split(/[?#]/, 1);
  return isSocialUrl(platform, profile) ? profile : input;
}

export function isEnamadUrl(value: string): boolean {
  return publicHttpsUrl(value)?.hostname === 'trustseal.enamad.ir';
}
export function isBadgeImage(kind: 'enamad' | 'license', value: string): boolean {
  if (kind === 'enamad') return isEnamadUrl(value);
  return /^\/media\/catalog\/[a-f0-9]{32}\/(?:thumb|card|zoom)\.webp$/.test(value);
}
export function isPolicyPath(value: string): boolean {
  return value.length <= 500 && /^\/(?:support|pages\/[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(value);
}
const title = z
  .string()
  .max(100)
  .refine(
    (v) =>
      // eslint-disable-next-line no-control-regex -- Titles are public plain text without display controls.
      !/[<>\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(v),
  );
const social = z
  .object({
    platform: z.enum(socialPlatforms),
    url: z.string().max(1500),
    enabled: z.boolean(),
  })
  .strict()
  .refine((v) => (!v.enabled && !v.url) || isSocialUrl(v.platform, v.url), {
    message: 'آدرس صفحه یا شمارهٔ بین‌المللی واتساپ معتبر نیست.',
  });
const badge = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    kind: z.enum(['enamad', 'license']),
    title,
    verificationUrl: z.string().max(1500),
    imageUrl: z.string().max(1500).optional(),
    enabled: z.boolean(),
  })
  .strict()
  .refine((v) => !v.enabled || Boolean(v.title.trim() && v.verificationUrl), {
    message: 'برای نمایش مجوز، عنوان و لینک استعلام واقعی لازم است.',
  })
  .refine(
    (v) =>
      !v.verificationUrl ||
      (v.kind === 'enamad'
        ? isEnamadUrl(v.verificationUrl)
        : Boolean(publicHttpsUrl(v.verificationUrl))),
    { message: 'لینک استعلام باید HTTPS باشد؛ اینماد فقط از trustseal.enamad.ir پذیرفته می‌شود.' },
  )
  .refine((v) => v.imageUrl === undefined || isBadgeImage(v.kind, v.imageUrl), {
    message: 'تصویر اینماد از میزبان رسمی و تصویر سایر مجوزها از رسانهٔ آمادهٔ فروشگاه انتخاب شود.',
  });
const policy = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    title,
    href: z.string().max(500),
    enabled: z.boolean(),
  })
  .strict()
  .refine((v) => !v.enabled || Boolean(v.title.trim() && v.href), {
    message: 'عنوان و مسیر صفحهٔ راهنما لازم است.',
  })
  .refine((v) => !v.href || isPolicyPath(v.href), {
    message: 'مسیر /support یا /pages/page-slug وارد کنید.',
  });
export const storeIdentitySchema = z
  .object({
    demonstration: z.boolean().optional(),
    socialLinks: z.array(social).max(5).optional(),
    badges: z.array(badge).max(6).optional(),
    policyLinks: z.array(policy).max(6).optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.socialLinks?.map((s) => s.platform)).size === (v.socialLinks?.length ?? 0),
    { message: 'هر شبکهٔ اجتماعی فقط یک‌بار قابل افزودن است.' },
  )
  .refine(
    (v) =>
      new Set(v.badges?.map((b) => b.id)).size === (v.badges?.length ?? 0) &&
      (v.badges?.filter((b) => b.kind === 'enamad').length ?? 0) <= 1,
    { message: 'مجوز تکراری است.' },
  )
  .refine((v) => new Set(v.policyLinks?.map((p) => p.id)).size === (v.policyLinks?.length ?? 0), {
    message: 'صفحهٔ راهنمای تکراری است.',
  });
export type StoreIdentity = z.infer<typeof storeIdentitySchema>;

// A malformed stored section fails closed without taking the rest of the shop offline.
export function visibleStoreIdentity(value: unknown): StoreIdentity {
  const parsed = storeIdentitySchema.safeParse(value);
  if (!parsed.success) return {};
  return {
    demonstration: parsed.data.demonstration,
    socialLinks: parsed.data.socialLinks?.filter((v) => v.enabled),
    badges: parsed.data.demonstration ? undefined : parsed.data.badges?.filter((v) => v.enabled),
    policyLinks: parsed.data.policyLinks?.filter((v) => v.enabled),
  };
}
