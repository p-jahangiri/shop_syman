import { NextResponse, type NextRequest } from 'next/server';
import { fetchCmsRedirect } from './lib/content/cms-redirect-fetch';
import { publicOrigin } from './lib/seo/seo';
import { fetchCmsPage } from './lib/content/cms-page-fetch';
import { fetchProductPresence } from './lib/catalog/product-presence';
import { fetchBlogList, fetchBlogPost } from './lib/content/cms-blog-fetch';
import { storefrontSecurityPolicy, browserPermissionsPolicy } from './lib/config/security-policy';
import {
  isRetiredSourcingHref,
  isRetiredSourcingPath,
} from '@sayman/web-shared/lib/market/retired-sourcing.ts';
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const https = publicOrigin()?.startsWith('https:') === true;
  const policy = storefrontSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === 'development',
    https,
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = await route(request, headers);
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Permissions-Policy', browserPermissionsPolicy);
  response.headers.set('Cache-Control', 'private, no-store');
  if (https) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}
async function route(request: NextRequest, headers: Headers) {
  const match = request.nextUrl.pathname.match(/^\/(en|fa)(?=\/|$)/);
  if (isRetiredSourcingPath(request.nextUrl.pathname))
    return new NextResponse(null, {
      status: 410,
      headers: { 'X-Robots-Tag': 'noindex, nofollow' },
    });
  if (!match) {
    const url = request.nextUrl.clone();
    url.pathname = '/fa' + (url.pathname === '/' ? '' : url.pathname);
    return NextResponse.redirect(url);
  }
  headers.set('x-shop-locale', match[1]);
  const unavailable = () =>
    new NextResponse(
      match[1] === 'fa'
        ? 'انتقال نشانی موقتاً در دسترس نیست. دوباره تلاش کنید.'
        : 'Address resolution is temporarily unavailable. Please try again.',
      {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          'Retry-After': '60',
        },
      },
    );
  const redirect = await fetchCmsRedirect(request.nextUrl.pathname, {
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_API_URL: process.env.SHOP_API_URL,
  });
  if (redirect.status === 'unavailable') return unavailable();
  if (redirect.status === 'ready' && redirect.rule.found) {
    const origin = publicOrigin();
    if (!origin || redirect.rule.targetPath === null || redirect.rule.status === null)
      return unavailable();
    if (isRetiredSourcingHref(redirect.rule.targetPath))
      return new NextResponse(null, {
        status: 410,
        headers: { 'X-Robots-Tag': 'noindex, nofollow' },
      });
    const response = NextResponse.redirect(
      new URL(redirect.rule.targetPath, origin),
      redirect.rule.status,
    );
    response.headers.set('Cache-Control', 'no-store');
    if (redirect.rule.isDemo) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  // Check public CMS existence before a layout starts streaming. Calling
  // notFound() after that point can render a 404 screen with HTTP 200.
  const page = request.nextUrl.pathname.match(/^\/(fa|en)\/pages\/([^/]+)\/?$/);
  if (page) {
    const locale = page[1] as 'fa' | 'en',
      load = await fetchCmsPage(page[2], locale, {
        SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
        SHOP_API_URL: process.env.SHOP_API_URL,
      });
    if (load.status === 'missing') {
      const target = request.nextUrl.clone();
      target.pathname = `/${locale}/__cms-unpublished-page__`;
      target.search = '';
      const response = NextResponse.rewrite(target, { status: 404, request: { headers } });
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return response;
    }
    if (load.status === 'unavailable')
      return new NextResponse(
        locale === 'fa'
          ? 'محتوای صفحه موقتاً در دسترس نیست. دوباره تلاش کنید.'
          : 'Page content is temporarily unavailable. Please try again.',
        {
          status: 503,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            'Retry-After': '60',
          },
        },
      );
  }
  // Resolve product visibility before the parent layout can stream an HTTP 200.
  const product = request.nextUrl.pathname.match(/^\/(fa|en)\/product\/([^/]+)\/?$/);
  if (product) {
    const locale = product[1] as 'fa' | 'en';
    let slug: string;
    try {
      slug = decodeURIComponent(product[2]);
    } catch {
      slug = '';
    }
    const presence = await fetchProductPresence(slug, locale, {
      SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
      SHOP_API_URL: process.env.SHOP_API_URL,
      NODE_ENV: process.env.NODE_ENV,
      SHOP_ENABLE_PREVIEW: process.env.SHOP_ENABLE_PREVIEW,
    });
    if (presence === 'missing') {
      const target = request.nextUrl.clone();
      target.pathname = `/${locale}/__catalog-product-missing__`;
      target.search = '';
      const response = NextResponse.rewrite(target, { status: 404, request: { headers } });
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return response;
    }
    if (presence === 'unavailable')
      return new NextResponse(
        locale === 'fa'
          ? 'اطلاعات کالا موقتاً در دسترس نیست. دوباره تلاش کنید.'
          : 'Product information is temporarily unavailable. Please try again.',
        {
          status: 503,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            'Retry-After': '60',
          },
        },
      );
  }
  const blog = request.nextUrl.pathname.match(/^\/(fa|en)\/blog(?:\/([^/]+))?\/?$/);
  if (blog) {
    const locale = blog[1] as 'fa' | 'en',
      env = { SHOP_DATA_MODE: process.env.SHOP_DATA_MODE, SHOP_API_URL: process.env.SHOP_API_URL };
    let slug: string | undefined;
    try {
      slug = blog[2] === undefined ? undefined : decodeURIComponent(blog[2]);
    } catch {
      slug = '';
    }
    const tag = request.nextUrl.searchParams.getAll('tag'),
      cursor = request.nextUrl.searchParams.getAll('cursor');
    if (slug === undefined && (tag.length > 1 || cursor.length > 1))
      return new NextResponse(
        locale === 'fa'
          ? 'فیلتر فهرست مقاله‌ها معتبر نیست.'
          : 'The article list filter is invalid.',
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
        },
      );
    const load =
      slug === undefined
        ? await fetchBlogList(locale, tag[0], cursor[0], env)
        : await fetchBlogPost(slug, locale, env);
    if (load.status === 'missing') {
      const target = request.nextUrl.clone();
      target.pathname = `/${locale}/__blog-post-missing__`;
      target.search = '';
      const response = NextResponse.rewrite(target, { status: 404, request: { headers } });
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return response;
    }
    if (load.status === 'expired') {
      const origin = publicOrigin();
      if (!origin) return unavailable();
      const params = new URLSearchParams();
      if (tag[0]) params.set('tag', tag[0]);
      const response = NextResponse.redirect(
        new URL(`/${locale}/blog${params.size ? '?' + params : ''}`, origin),
        303,
      );
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return response;
    }
    if (load.status === 'invalid')
      return new NextResponse(
        locale === 'fa'
          ? 'پیوند فهرست مقاله‌ها معتبر نیست؛ فهرست را از ابتدا باز کنید.'
          : 'This article list link is invalid. Open the list from the beginning.',
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
        },
      );
    if (load.status === 'unavailable')
      return new NextResponse(
        locale === 'fa'
          ? 'مقاله‌ها موقتاً در دسترس نیستند. دوباره تلاش کنید.'
          : 'Articles are temporarily unavailable. Please try again.',
        {
          status: 503,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            'Retry-After': '60',
          },
        },
      );
  }
  return NextResponse.next({ request: { headers } });
}
export const config = {
  matcher: [
    '/api/market/:path*',
    '/api/sourcing/:path*',
    '/api/phones/:path*',
    '/api/notifications/phones/:path*',
    '/api/cart/:locale/sourcing/:path*',
    '/((?!api|_next|media/videos/|products|pwa|sw.js|sitemap.xml|sitemap-|sitemaps/|icon.svg|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|webp|svg|woff2)$).*)',
  ],
};
