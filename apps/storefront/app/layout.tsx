import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';
import { cookies, headers } from 'next/headers';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import '@sayman/design-tokens/tokens.css';
import './globals.css';
import '../components/catalog/filters.css';
import '@sayman/web-shared/components/support/ticket-workspace.css';
import './storefront-design.css';
import './storefront-motion.css';
import { PwaProvider } from '@/components/offline/pwa-provider';
import { LocaleProvider } from '@/components/navigation/locale-provider';
import { getLocale } from '@/lib/navigation/server-locale';
import { getStorefront } from '@/lib/data/storefront-data';
import { publicOrigin } from '@/lib/seo/seo';
import { translate } from '@/lib/navigation/i18n';
import { AuthProvider } from '@/components/auth/auth-provider';
import { ShopProvider } from '@/components/providers/shop-provider';
import { Header, Footer, MobileNav, CartDrawer, CompareTray } from '@/components/navigation/shell';
import { resolveSiteDesign } from '@sayman/web-shared/lib/content/site-design.ts';
import { storefrontColorVariables } from '@sayman/web-shared/lib/content/brand-colors.ts';
// Constant application code. CMS values are read only from validated attributes.
const storefrontThemeBootstrap = `(() => {
  const root = document.documentElement;
  let saved = root.dataset.themePreference;
  try { saved ||= localStorage.getItem('sayman:theme'); } catch {}
  const preferred = root.dataset.shopTheme;
  root.dataset.theme = saved === 'light' || saved === 'dark' ? saved :
    preferred === 'light' || preferred === 'dark' ? preferred :
      matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();`;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const { site } = await getStorefront(locale);
  const origin = publicOrigin();
  return {
    metadataBase: origin ? new URL(origin) : null,
    title: {
      default: site.seo?.title ?? `${site.name} | ${site.tagline}`,
      template: `%s | ${site.name}`,
    },
    description: site.seo?.description ?? site.about,
    robots: { index: false, follow: false },
    manifest: `/${locale}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: site.name, statusBarStyle: 'default' },
    icons: {
      icon: [
        { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
      ],
      apple: `/pwa/icons/${locale}/180.png`,
    },
  };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#4b6040' };
export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale?: string }>;
}) {
  const { locale: segment } = await params;
  const locale = segment === 'en' ? 'en' : segment === 'fa' ? 'fa' : await getLocale();
  const snapshot = await getStorefront(locale);
  const palette = snapshot.site.palette;
  const { appearance, font, theme } = resolveSiteDesign(snapshot.site);
  const requestHeaders = await headers();
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  const saved = (await cookies()).get('sayman-theme')?.value;
  const preference = saved === 'dark' || saved === 'light' ? saved : undefined;
  const publicBrowse = requestHeaders.get('x-sayman-public-browse') === '1';
  const secureOrigin =
    publicBrowse && requestHeaders.get('x-forwarded-proto') === 'http' ? publicOrigin() : undefined;
  const branding = {
    ...storefrontColorVariables('light', palette),
    ...storefrontColorVariables('dark', palette),
  } as CSSProperties;
  return (
    <html
      style={branding}
      lang={locale}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      data-scroll-behavior="smooth"
      data-shop-surface={appearance.surface}
      data-shop-density={appearance.density}
      data-shop-corners={appearance.corners}
      data-shop-font={font}
      data-shop-public-browse={publicBrowse || undefined}
      data-shop-theme={theme}
      data-theme-preference={preference}
      data-theme={preference ?? (theme === 'system' ? undefined : theme)}
      data-shop-cards={appearance.cards}
      data-shop-navigation={appearance.navigation}
      data-shop-motion={appearance.motion}
      data-shop-motion-preset={appearance.motionPreset}
      data-shop-motion-banners={String(appearance.motionBanners)}
      data-shop-motion-cards={String(appearance.motionCards)}
      data-shop-motion-sidebar={String(appearance.motionSidebar)}
      data-shop-hero={appearance.heroLayout}
      data-shop-sticky={String(appearance.stickyHeader)}
      suppressHydrationWarning
    >
      {nonce && (
        <head>
          <meta
            name="color-scheme"
            content={preference ?? (theme === 'system' ? 'light dark' : theme)}
          />
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: storefrontThemeBootstrap }} />
        </head>
      )}
      <body className="storefront-design">
        <LocaleProvider key={locale} locale={locale} snapshot={snapshot}>
          <PwaProvider
            enabled={
              !publicBrowse &&
              process.env.NODE_ENV === 'production' &&
              process.env.SHOP_PWA_ENABLED !== 'false'
            }
          >
            <AuthProvider enabled={!publicBrowse}>
              <ShopProvider>
                <a className="skip-link" href="#main">
                  {translate('رفتن به محتوای اصلی', locale)}
                </a>
                {publicBrowse && (
                  <div className="public-browse-notice">
                    <span>
                      {locale === 'fa' ? 'نسخهٔ مرور عمومی فروشگاه' : 'Public browsing version'}
                    </span>
                    {secureOrigin && (
                      <a href={`${secureOrigin}/${locale}`}>
                        {locale === 'fa'
                          ? 'ورود، خرید و نصب در نسخهٔ HTTPS'
                          : 'Sign in, shop and install on HTTPS'}
                      </a>
                    )}
                  </div>
                )}
                <Header />
                <main id="main">{children}</main>
                <Footer />
                <MobileNav />
                <CartDrawer />
                <CompareTray />
              </ShopProvider>
            </AuthProvider>
          </PwaProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
