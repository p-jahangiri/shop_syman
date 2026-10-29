import type { CmsPageContent } from '../../storefront/lib/cms-page-contract';

const issuedImage = /^\/media\/catalog\/[a-f0-9]{32}\/(?:thumb|card|zoom)\.webp$/;

// This changes only the admin preview URL. The persisted CMS image stays canonical.
export function cmsImagePreview(image: string): string {
  return issuedImage.test(image) ? '/api' + image : image;
}

export function cmsPagePreview(content: CmsPageContent['fa']): CmsPageContent['fa'] {
  return {
    ...content,
    blocks: content.blocks.map((block) =>
      block.kind === 'Image' ? { ...block, image: cmsImagePreview(block.image) } : block,
    ),
  };
}

// Multiple image fields can finish independently. A completed upload must not
// unlock Save while another field still has an active upload.
export function createCmsImageUploadTracker() {
  const fields = new Set<string>();
  const listeners = new Set<() => void>();
  const snapshot = () => fields.size > 0;
  return {
    snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(field: string, busy: boolean) {
      const previous = snapshot();
      if (busy) fields.add(field);
      else fields.delete(field);
      if (previous !== snapshot()) listeners.forEach((listener) => listener());
    },
  };
}
