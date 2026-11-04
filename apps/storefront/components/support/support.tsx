'use client';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import { ReturnsPolicy } from '../orders/returns-policy';
import { useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  Plus,
  Headphones,
  MessageCircle,
  Send,
  ShieldCheck,
  PackageCheck,
  CreditCard,
} from 'lucide-react';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { Button, Modal } from '../shared/ui';
import type { SupportContentLoad } from '@/lib/content/support-content-fetch';
import { isPurchaseContentEnabled, isPurchaseKindEnabled } from '@/lib/catalog/purchasing';
import { visibleStoreIdentity } from '@sayman/web-shared/lib/content/store-identity.ts';
import { StoreSocialLinks } from '../content/store-identity-footer';
const faqs = [
  {
    q: 'این نسخه امکان خرید واقعی دارد؟',
    a: 'این نسخه برای بررسی طراحی و تجربهٔ فروشگاه است. ثبت سفارش، پیامک و پرداخت واقعی هنوز فعال نیستند.',
  },
  {
    purchaseMethodKind: 'cheque' as const,
    q: 'شرایط خرید چکی چگونه است؟',
    a: 'در خرید چکی، مدت، درصد و پیش‌پرداخت توسط مدیر فروشگاه تعیین می‌شود. محاسبه‌گر فعلی نمونه است؛ خرید نهایی به بررسی و تأیید چک و مدارک نیاز دارد.',
  },
  {
    q: 'هزینهٔ ارسال چطور محاسبه می‌شود؟',
    a: 'هزینه، روش و زمان تحویل هنوز تعیین نشده‌اند. پس از تعیین شرایط فروشگاه، پیش از پرداخت به‌طور شفاف نمایش داده می‌شوند.',
  },
  {
    q: 'گارانتی و مرجوعی چه شرایطی دارند؟',
    a: 'فروشگاه خدمات گارانتی و مرجوعی دارد. جزئیات مدت، موارد مشمول و مراحل درخواست باید از سوی فروشگاه تکمیل شود. اطلاعات فعلی کالاها صرفاً نمونه‌اند.',
  },
  {
    q: 'قیمت‌ها و موجودی قابل اتکا هستند؟',
    a: 'قیمت‌ها و موجودی فعلی داده‌های نمونهٔ طراحی هستند. پس از اتصال API، قیمت و موجودی معتبر از سرور خوانده و هنگام سفارش دوباره بررسی می‌شوند.',
  },
  {
    q: 'چطور محصولات را مقایسه کنم؟',
    a: 'در کارت هر محصول روی علامت مقایسه بزنید. دو تا چهار محصول از یک دسته را انتخاب کنید و از نوار مقایسه، جدول مشخصات را ببینید.',
  },
  {
    q: 'علاقه‌مندی و سبد خرید ذخیره می‌شوند؟',
    a: 'در این پیش‌نمایش، علاقه‌مندی‌ها و سبد در مرورگر همین دستگاه نگه داشته می‌شوند. همگام‌سازی با حساب واقعی در مرحلهٔ اتصال فعال می‌شود.',
  },
];
type Message = {
  role: 'guide' | 'user';
  text: string;
};
export function Support({ contentLoad }: { contentLoad?: SupportContentLoad }) {
  const { t, locale } = useI18n();
  const { dataSource, purchaseMethods, site } = useStorefront();
  const chequeEnabled = isPurchaseKindEnabled(purchaseMethods, 'cheque');
  const copy = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const connected = dataSource === 'api';
  const published = connected && contentLoad?.status === 'ready' ? contentLoad.page.content : null;
  const content = published && !published.isDemo ? published : null;
  const socialLinks = visibleStoreIdentity(site.storeIdentity).socialLinks ?? [];
  const currentFaqs = connected
    ? (content?.faqs
        .filter((f) => isPurchaseContentEnabled(f, purchaseMethods))
        .map((f) => ({ id: f.id, q: f.question, a: f.answer })) ?? [])
    : faqs
        .filter((f) => isPurchaseContentEnabled(f, purchaseMethods))
        .map((f, index) => ({ id: String(index), q: t(f.q), a: t(f.a) }));
  const ticketsAction =
    content?.ticketsAction ??
    copy('ثبت و پیگیری درخواست پشتیبانی', 'Send and track a support request');
  const [chat, setChat] = useState(false),
    [text, setText] = useState(''),
    [messages, setMessages] = useState<Message[]>([
      {
        role: 'guide',
        text: chequeEnabled
          ? t(
              'سلام! این راهنمای نمایشی سایمان است. دربارهٔ خرید چکی، ارسال، گارانتی یا مقایسه سؤال دارید؟',
            )
          : copy(
              'سلام! دربارهٔ ارسال، گارانتی یا مقایسهٔ کالاها راهنمایی می‌خواهید؟',
              'Hello! Do you need help with delivery, warranty or product comparison?',
            ),
      },
    ]);
  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const q = normalizePersian(text);
    const answer =
      chequeEnabled && (q.includes('چک') || q.includes('قسط'))
        ? faqs[1].a
        : q.includes('ارسال') || q.includes('تحویل')
          ? faqs[2].a
          : q.includes('گارانتی') || q.includes('مرجوع')
            ? faqs[3].a
            : q.includes('مقایسه')
              ? faqs[5].a
              : t(
                  'این راهنما نمایشی است و به پشتیبان متصل نیست. پرسش‌های متداول این صفحه، راهنمای بخش‌های فعلی فروشگاه‌اند.',
                );
    setMessages((old) => [
      ...old,
      { role: 'user', text: text.trim().slice(0, 500) },
      { role: 'guide', text: answer },
    ]);
    setText('');
  }
  return (
    <div className="container support-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <span>{t('راهنما و پشتیبانی')}</span>
        </div>
      </div>
      <section className="support-intro">
        <div className="support-intro-copy">
          <span className="support-intro-icon">
            <Headphones size={30} aria-hidden="true" />
          </span>
          {(content?.eyebrow || !connected) && (
            <span className="eyebrow">{content?.eyebrow ?? t('کنار هر انتخاب، یک همراه خوب')}</span>
          )}
          <h1>
            {content?.title ??
              (connected
                ? copy('راهنما و پشتیبانی', 'Help and support')
                : t('چطور می‌تونیم کمکت کنیم؟'))}
          </h1>
          <p className="support-plain-text">
            {content?.description ??
              (connected
                ? copy(
                    'سفارشتان را پیگیری کنید، شرایط مرجوعی را بخوانید یا با سایمان در ارتباط باشید.',
                    'Track an order, read the returns policy or get in touch with Sayman.',
                  )
                : t('از انتخاب محصول تا شناخت شرایط خرید، جواب‌ها را اینجا پیدا کن.'))}
          </p>
          {socialLinks.length > 0 && (
            <nav
              className="support-social-links"
              aria-label={copy('شبکه‌های اجتماعی سایمان', 'Sayman social media')}
            >
              <StoreSocialLinks links={socialLinks} locale={locale} />
            </nav>
          )}
        </div>
        {connected && (
          <div className="support-ticket-entry">
            <Link href="/support/tickets">{ticketsAction}</Link>
          </div>
        )}
      </section>
      <div className="support-cards">
        {chequeEnabled && (
          <Link href="/installments">
            <CreditCard />
            <h2>{t('خرید چکی')}</h2>
            <p>
              {connected
                ? copy('شرایط طرح‌ها و مراحل بررسی', 'Plan terms and review steps')
                : t('محاسبهٔ نمونه و مسیر تأیید چک')}
            </p>
            <ArrowLeft size={17} />
          </Link>
        )}
        <Link href={connected ? '/support/tickets' : '#faq'}>
          <ShieldCheck />
          <h2>{t('گارانتی و مرجوعی')}</h2>
          <p>
            {connected
              ? copy('ارسال درخواست برای بررسی', 'Send a request for review')
              : t('اطلاعات و شرایط قابل تکمیل فروشگاه')}
          </p>
          <ArrowLeft size={17} />
        </Link>
        <Link href={connected ? '/orders' : '/account?tab=orders'}>
          <PackageCheck />
          <h2>{t('پیگیری سفارش')}</h2>
          <p>
            {connected
              ? copy('پیگیری سفارش‌های حساب', 'Track your account’s orders')
              : t('پیش‌نمایش بخش سفارش‌های من')}
          </p>
          <ArrowLeft size={17} />
        </Link>
      </div>
      {connected && <ReturnsPolicy />}
      {connected && (!contentLoad || contentLoad.status === 'unavailable') && (
        <p className="notice" role="status">
          {copy(
            'راهنمای منتشرشده موقتاً خوانده نشد. برای پیگیری موضوع خود می‌توانید درخواست پشتیبانی ثبت کنید.',
            'Published help content is temporarily unavailable. You can still send and track a support request.',
          )}
        </p>
      )}
      {currentFaqs.length > 0 && (
        <section className="faq-section" id="faq">
          <div>
            <h2>{content?.faqTitle ?? t('پرسش‌های پرتکرار')}</h2>
            {(content?.faqDescription || !connected) && (
              <p className="support-plain-text">
                {content?.faqDescription ??
                  t('پاسخ سؤال شما اینجا نیست؟ مسیر راهنمای نمایشی را هم ببینید.')}
              </p>
            )}
            {connected ? (
              <Link href="/support/tickets" className="button button-outline">
                {ticketsAction}
              </Link>
            ) : (
              <Button variant="outline" onClick={() => setChat(true)}>
                {t('راهنمای گفت‌وگویی')}
                <MessageCircle size={18} />
              </Button>
            )}
          </div>
          <div className="faq-list">
            {currentFaqs.map((faq) => (
              <details key={faq.id}>
                <summary>
                  {faq.q}
                  <Plus size={17} />
                </summary>
                <p className="support-plain-text">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
      <div className="notice support-notice">
        {connected
          ? copy(
              'برای پیگیری موضوع مربوط به خرید خود، درخواست پشتیبانی ثبت کنید. پاسخ‌ها در همان گفت‌وگو نمایش داده می‌شوند.',
              'Send a support request to follow up on your purchase. Replies appear in the same conversation.',
            )
          : t(
              'اطلاعات تماس واقعی و متن کامل سیاست گارانتی، مرجوعی، ارسال و مالیات پس از دریافت از فروشگاه اضافه می‌شود. این نسخه به پشتیبان انسانی متصل نیست.',
            )}
      </div>
      {!connected && (
        <Modal
          open={chat}
          onOpenChange={setChat}
          title={t('راهنمای نمایشی سایمان')}
          description={t('پاسخ‌های آماده برای بررسی تجربهٔ گفت‌وگو؛ متصل به پشتیبان نیست.')}
        >
          <div className="chat-messages" aria-live="polite">
            {messages.map((message, index) => (
              <p className={`chat-message ${message.role}`} key={index}>
                {t(message.text)}
              </p>
            ))}
          </div>
          <form className="chat-form" onSubmit={send}>
            <input
              aria-label={t('پیام برای راهنمای نمایشی')}
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                chequeEnabled
                  ? t('مثلاً شرایط چک را بگو')
                  : copy('مثلاً دربارهٔ گارانتی راهنمایی کن', 'For example, help me with warranty')
              }
            />
            <button
              type="submit"
              className="icon-button"
              aria-label={t('فرستادن پیام نمایشی')}
              disabled={!text.trim()}
            >
              <Send size={19} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
