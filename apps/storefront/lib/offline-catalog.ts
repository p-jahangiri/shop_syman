import { isProcessedImage, publicImageVariant } from './media-paths.ts';
import type { Locale, StorefrontSnapshot } from './types.ts';

// Deliberate allowlist: this DTO cannot contain prices, stock, payment rules or user data.
export function offlineCatalog(
  snapshot: StorefrontSnapshot,
  locale: Locale,
  generatedAt = new Date().toISOString(),
  limit = 200,
) {
  const take = Math.min(500, Math.max(1, Number.isInteger(limit) ? limit : 200));
  const localImage = (url: string) =>
    isProcessedImage(url)
      ? publicImageVariant(url, 'thumb')
      : /^\/products\/[a-zA-Z0-9/_-]+\.svg$/.test(url)
        ? url
        : undefined;
  return {
    version: 1,
    locale,
    generatedAt,
    isPreview: snapshot.isPreview,
    site: {
      name: snapshot.site.name.slice(0, 250),
      tagline: snapshot.site.tagline.slice(0, 800),
      primary: snapshot.site.palette?.primaryLight,
    },
    categories: snapshot.categories
      .slice(0, 500)
      .map((c) => ({ key: c.key, name: c.name, description: c.description.slice(0, 800) })),
    products: snapshot.products.slice(0, take).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description.slice(0, 800),
      image: localImage(p.image),
    })),
    truncated: snapshot.products.length > take,
  };
}
