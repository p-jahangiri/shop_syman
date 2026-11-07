import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';
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
import { resolveAppearance } from '@sayman/web-shared/lib/content/appearance.ts';
import { storefrontColorVariables } from '@sayman/web-shared/lib/content/brand-colors.ts';
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
  const appearance = resolveAppearance(snapshot.site.appearance);
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
      data-shop-font={snapshot.site.font ?? 'vazirmatn'}
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
      <body className="storefront-design">
        <LocaleProvider key={locale} locale={locale} snapshot={snapshot}>
          <PwaProvider
            enabled={
              process.env.NODE_ENV === 'production' && process.env.SHOP_PWA_ENABLED !== 'false'
            }
          >
            <AuthProvider>
              <ShopProvider>
                <a className="skip-link" href="#main">
                  {translate('رفتن به محتوای اصلی', locale)}
                </a>
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
