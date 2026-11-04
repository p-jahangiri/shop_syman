export const cmsWorkspaceSections = {
  articles: { label: 'مقاله‌ها', description: 'راهنماهای خرید و مطالب آموزشی بلاگ' },
  pages: { label: 'صفحه‌ها', description: 'صفحه‌های مستقل و قابل پیوند از منو' },
  settings: { label: 'تنظیمات فروشگاه', description: 'برند، راه‌های تماس، صفحهٔ اصلی و پشتیبانی' },
  history: { label: 'تاریخچهٔ تنظیمات', description: 'نسخه‌های عمومی و بازگردانی' },
  redirects: { label: 'تغییر مسیرها', description: 'انتقال نشانی‌های قدیمی و حفظ پیوندها' },
} as const;

export type CmsWorkspaceSection = keyof typeof cmsWorkspaceSections;
