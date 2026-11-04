import type {
  CmsPageContent,
  CmsPageInput,
} from '@sayman/web-shared/lib/content/cms-page-contract.ts';

export function canRunCmsCommand(
  action: CmsPageInput['action'],
  writable: boolean,
  publishable: boolean,
) {
  return action === 'Create' || action === 'Save' ? writable : publishable;
}

export function cmsPublicationStatus(publication: number, publishedRevisionId: string | null) {
  if (publishedRevisionId) return 'منتشرشده';
  return publication === 0 ? 'پیش‌نویس' : 'لغو انتشار';
}

export function cmsLanguageReady(content: CmsPageContent['fa']) {
  return !!content.title.trim() && content.blocks.length > 0;
}
