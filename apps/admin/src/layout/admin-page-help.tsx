import { useState } from 'react';
import { CircleHelp, Lightbulb, ArrowLeft, BookOpen } from 'lucide-react';
import { Modal } from '../components/ui';
import { adminGuides, type AdminGuide } from './admin-guides';
import type { Page } from './admin-navigation';

export function AdminPageHelp({ page, title }: { page: Page; title: string }) {
  const [open, setOpen] = useState(false);
  const guide: AdminGuide = adminGuides[page];
  return (
    <>
      <button
        type="button"
        className="page-help-trigger"
        onClick={() => setOpen(true)}
        aria-label={`راهنمای ${title}`}
        aria-haspopup="dialog"
      >
        <CircleHelp size={19} aria-hidden="true" />
        <span>راهنمای این بخش</span>
      </button>
      {open && (
        <Modal title={`راهنمای ${title}`} onClose={() => setOpen(false)}>
          <div className="admin-guide">
            <div className="admin-guide-purpose">
              <BookOpen size={24} aria-hidden="true" />
              <p>{guide.purpose}</p>
            </div>
            <section>
              <h3>از کجا شروع کنم؟</h3>
              <ol>
                {guide.steps.map((step, index) => (
                  <li key={step}>
                    <span aria-hidden="true">{(index + 1).toLocaleString('fa-IR')}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3>این عبارت‌ها یعنی چه؟</h3>
              <dl>
                {guide.terms.map((term) => (
                  <div key={term.label}>
                    <dt>{term.label}</dt>
                    <dd>{term.meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <div className="admin-guide-note">
              <Lightbulb size={21} aria-hidden="true" />
              <p>{guide.note}</p>
            </div>
            {guide.tableHelp !== false && (
              <section>
                <h3>کار با جدول و جست‌وجو</h3>
                <p>
                  جست‌وجوی فهرست‌ها با توقف کوتاه تایپ اعمال می‌شود. در گزارش‌های تاریخ‌دار و
                  فرم‌های دیگر، دکمهٔ اعمال همان بخش را بزنید. در فهرست‌های صفحه‌بندی‌شده، صفحهٔ بعد
                  از سرور جداگانه دریافت می‌شود.
                </p>
                <p>
                  در جدول، عنوان ستون را برای مرتب‌سازی بزنید؛ با نگه‌داشتن Shift چند ستون را مرتب
                  کنید. از منوی «فیلتر ستون‌ها» ردیف‌ها را محدود کنید. منوی «نمایش» برای انتخاب
                  ستون‌ها و فاصلهٔ معمولی یا فشردهٔ ردیف‌هاست.
                </p>
                <p>
                  نوار جست‌وجوی داخل جدول فقط ردیف‌های دریافت‌شده را می‌بیند. «بازنشانی جدول»
                  تنظیمات محلی آن را پاک می‌کند؛ برای دریافت دادهٔ تازه، دکمهٔ تازه‌سازی همان بخش را
                  بزنید.
                </p>
              </section>
            )}
            <button type="button" className="primary" onClick={() => setOpen(false)}>
              متوجه شدم؛ برگشت به کار <ArrowLeft size={17} aria-hidden="true" />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
