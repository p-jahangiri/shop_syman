import type { SiteContent } from '../shared/types.ts';

export function homeSearchText(site: Pick<SiteContent, 'name' | 'tagline' | 'about' | 'seo'>) {
  const title = site.seo?.title;
  const description = site.seo?.description;
  return {
    title: (typeof title === 'string' && title.trim()) || site.tagline,
    description: ((typeof description === 'string' && description.trim()) || site.about).slice(
      0,
      400,
    ),
    name: site.name,
  };
}
