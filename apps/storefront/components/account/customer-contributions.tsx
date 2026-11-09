'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MessageSquareText, Package, PencilLine, Trash2 } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import { Button, groupNavigation, Modal } from '../shared/ui';
import { ReviewStarInput, ReviewStars } from '../reviews/review-stars';
import { ReviewVoteCounts } from '../reviews/review-votes';
import { listContributions, withdrawReview } from '@/lib/reviews/reviews-client';
import { CartError } from '@/lib/checkout/cart-client';
import { publicImageVariant } from '@sayman/web-shared/lib/media/media-paths.ts';
import type {
  AccountProduct,
  ContributionSection,
  ContributionPage,
  PrivateReview,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
import '../catalog/product-reviews.css';
import './customer-contributions.css';

const tabs = [
  { key: 'pending', fa: 'در انتظار دیدگاه', en: 'To review' },
  { key: 'reviews', fa: 'دیدگاه‌های من', en: 'My reviews' },
  { key: 'questions', fa: 'پرسش‌های من', en: 'My questions' },
] as const;
const states = {
  Pending: ['در انتظار بررسی', 'Awaiting review'],
  Approved: ['منتشرشده', 'Published'],
  Rejected: ['ردشده', 'Rejected'],
  Hidden: ['پنهان‌شده', 'Hidden'],
} as const;
const dates = {
  fa: new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }),
};
function productPath(
  product: AccountProduct,
  tab: 'reviews' | 'questions',
  compose = false,
  rating = 0,
) {
  return (
    '/product/' +
    product.slug +
    '?tab=' +
    tab +
    (compose ? '&compose=1' : '') +
    (rating ? '&rating=' + rating : '') +
    '#product-tabs'
  );
}

export function CustomerContributions() {
  const auth = useCustomerSession();
  const { locale } = useI18n();
  const fa = locale === 'fa';
  return (
    <section className="container contribution-page">
      <header className="contribution-heading">
        <div>
          <Link className="text-link" href="/account">
            {fa ? 'حساب من' : 'My account'}
          </Link>
          <h1>{fa ? 'دیدگاه‌ها و پرسش‌های من' : 'My reviews and questions'}</h1>
        </div>
        <MessageSquareText size={30} aria-hidden="true" />
      </header>
      {auth.status === 'member' && auth.session ? (
        <Workspace key={auth.session.user.id + ':' + locale} />
      ) : auth.status === 'restoring' ? (
        <p role="status">{fa ? 'در حال بررسی حساب…' : 'Checking your account…'}</p>
      ) : (
        <Link className="button button-primary" href="/account?returnTo=%2Faccount%2Fcontributions">
          {fa ? 'ورود به حساب' : 'Sign in'}
        </Link>
      )}
    </section>
  );
}

function Workspace() {
  const { locale } = useI18n();
  const [tab, setTab] = useState<ContributionSection>('pending');
  const id = useId();
  return (
    <div className="contribution-workspace">
      <div
        className="product-tabs contribution-tabs"
        role="tablist"
        tabIndex={-1}
        aria-label={locale === 'fa' ? 'دیدگاه‌ها و پرسش‌ها' : 'Reviews and questions'}
        onKeyDown={groupNavigation}
      >
        {tabs.map(({ key, fa, en }) => (
          <button
            key={key}
            id={id + '-' + key}
            type="button"
            role="tab"
            aria-controls={id + '-panel'}
            aria-selected={key === tab}
            className={key === tab ? 'active' : ''}
            tabIndex={key === tab ? 0 : -1}
            onClick={() => setTab(key)}
          >
            {locale === 'fa' ? fa : en}
          </button>
        ))}
      </div>
      <div
        className="contribution-panel"
        id={id + '-panel'}
        role="tabpanel"
        aria-labelledby={id + '-' + tab}
      >
        {tab === 'pending' ? (
          <PendingContributions />
        ) : tab === 'reviews' ? (
          <ReviewContributions />
        ) : (
          <QuestionContributions />
        )}
      </div>
    </div>
  );
}

function useContributionPage<T extends ContributionSection>(section: T) {
  const { store } = useCustomerSession();
  const { locale } = useI18n();
  const [cursors, setCursors] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ContributionPage<T>>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const cursor = cursors.at(-1) ?? null;
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(false);
    void listContributions(store.fetch, section, locale, cursor, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setResult(page);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [store, section, locale, cursor, attempt]);
  return {
    result,
    busy,
    error,
    refresh: () => setAttempt((n) => n + 1),
    previous: cursors.length
      ? () => {
          setBusy(true);
          setCursors((old) => old.slice(0, -1));
        }
      : undefined,
    next: (next: string) => {
      setBusy(true);
      setCursors((old) => [...old, next]);
    },
  };
}

function PageState({
  busy,
  error,
  refresh,
}: {
  busy: boolean;
  error: boolean;
  refresh: () => void;
}) {
  const { locale } = useI18n();
  return busy ? (
    <p role="status">{locale === 'fa' ? 'در حال دریافت…' : 'Loading…'}</p>
  ) : error ? (
    <div role="alert">
      <p>{locale === 'fa' ? 'اطلاعات دریافت نشد.' : 'Could not load this section.'}</p>
      <Button variant="outline" onClick={refresh}>
        {locale === 'fa' ? 'تلاش دوباره' : 'Try again'}
      </Button>
    </div>
  ) : null;
}

function ProductHeader({
  product,
  fallback,
  tab,
}: {
  product?: AccountProduct | null;
  fallback: string;
  tab: 'reviews' | 'questions';
}) {
  const image = product?.image ?? '';
  const local =
    /^\/(?:products|media\/catalog)\/[A-Za-z0-9_./-]+$/.test(image) && !image.includes('..');
  return (
    <div className="contribution-product">
      {local ? (
        // eslint-disable-next-line @next/next/no-img-element -- Same-origin catalogue thumbnail.
        <img
          src={publicImageVariant(image, 'thumb')}
          alt=""
          width={64}
          height={64}
          loading="lazy"
        />
      ) : (
        <span className="contribution-product-placeholder">
          <Package size={23} aria-hidden="true" />
        </span>
      )}
      {product ? (
        <Link href={productPath(product, tab)}>
          <strong dir="auto">{product.name}</strong>
        </Link>
      ) : (
        <strong dir="auto">{fallback}</strong>
      )}
    </div>
  );
}

function PendingContributions() {
  const page = useContributionPage('pending');
  const { locale } = useI18n();
  const fa = locale === 'fa';
  if (page.busy || page.error) return <PageState {...page} />;
  return (
    <>
      <p className="small-note">
        {fa
          ? 'کالاهای خریدهای اخیر که تحویل گرفته‌اید و هنوز درباره‌شان دیدگاه نداده‌اید.'
          : 'Recently delivered items you haven’t reviewed yet.'}
      </p>
      {!page.result?.items.length && (
        <p>{fa ? 'فعلاً کالایی در انتظار دیدگاه نیست.' : 'No items to review yet.'}</p>
      )}
      <div className="contribution-pending-grid">
        {page.result?.items.map((product) => (
          <PendingCard key={product.id} product={product} />
        ))}
      </div>
    </>
  );
}

function PendingCard({ product }: { product: AccountProduct }) {
  const { locale } = useI18n();
  const [rating, setRating] = useState(0);
  return (
    <article className="contribution-card">
      <ProductHeader product={product} fallback={product.name} tab="reviews" />
      <ReviewStarInput
        initial={0}
        locale={locale}
        name={'rating-' + product.id}
        onChange={setRating}
      />
      <Link className="button button-outline" href={productPath(product, 'reviews', true, rating)}>
        {locale === 'fa' ? 'ثبت دیدگاه' : 'Write a review'}
      </Link>
    </article>
  );
}

function Pagination({ previous, next }: { previous?: () => void; next?: () => void }) {
  const { locale } = useI18n();
  if (!previous && !next) return null;
  return (
    <nav className="contribution-actions" aria-label={locale === 'fa' ? 'صفحه‌ها' : 'Pages'}>
      {previous && (
        <Button variant="outline" onClick={previous}>
          {locale === 'fa' ? 'قبلی' : 'Previous'}
        </Button>
      )}
      {next && (
        <Button variant="outline" onClick={next}>
          {locale === 'fa' ? 'بعدی' : 'Next'}
        </Button>
      )}
    </nav>
  );
}

function ReviewContributions() {
  const page = useContributionPage('reviews');
  const { locale } = useI18n();
  const fa = locale === 'fa';
  const [removed, setRemoved] = useState<string[]>([]);
  if (page.busy || page.error) return <PageState {...page} />;
  const items =
    page.result?.items.filter((item) => !removed.includes(item.review.content.revisionId)) ?? [];
  const next = page.result?.nextCursor;
  return (
    <>
      {removed.length > 0 && <p role="status">{fa ? 'دیدگاه حذف شد.' : 'Review removed.'}</p>}
      {!items.length && <p>{fa ? 'در این صفحه دیدگاهی ندارید.' : 'No reviews on this page.'}</p>}
      <div className="contribution-list">
        {items.map(({ review, likes, dislikes, product }) => (
          <article className="contribution-card" key={review.id}>
            <header className="contribution-card-header">
              <ProductHeader
                product={product}
                fallback={fa ? 'کالا در دسترس نیست' : 'Product unavailable'}
                tab="reviews"
              />
              <span className="contribution-status" data-state={review.state}>
                {states[review.state][fa ? 0 : 1]}
              </span>
            </header>
            <div className="contribution-review-meta">
              <ReviewStars rating={review.content.rating} locale={locale} />
              <time dateTime={review.content.at}>
                {dates[locale].format(new Date(review.content.at))}
              </time>
            </div>
            <h3 dir="auto">{review.content.title}</h3>
            <p className="contribution-copy" dir="auto">
              {review.content.body}
            </p>
            {review.reply && (
              <blockquote>
                <strong>{fa ? 'پاسخ سایمان' : 'Sayman reply'}</strong>
                <p dir="auto">{review.reply}</p>
              </blockquote>
            )}
            <footer className="contribution-actions">
              <ReviewVoteCounts likes={likes} dislikes={dislikes} />
              <div className="contribution-actions">
                {product && (
                  <Link
                    className="button button-outline"
                    href={productPath(product, 'reviews', true)}
                  >
                    <PencilLine size={16} />
                    {fa ? 'ویرایش دیدگاه' : 'Edit review'}
                  </Link>
                )}
                <WithdrawButton
                  review={review}
                  onDone={() => setRemoved((rows) => [...rows, review.content.revisionId])}
                />
              </div>
            </footer>
          </article>
        ))}
      </div>
      <Pagination previous={page.previous} next={next ? () => page.next(next) : undefined} />
    </>
  );
}

function WithdrawButton({ review, onDone }: { review: PrivateReview; onDone: () => void }) {
  const { locale } = useI18n();
  const { store } = useCustomerSession();
  const fa = locale === 'fa';
  const trigger = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const command = useRef<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  async function confirm() {
    if (busy) return;
    command.current ??= crypto.randomUUID().replaceAll('-', '');
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      await withdrawReview(store.fetch, review.id, command.current, review.version, abort.signal);
      if (!abort.signal.aborted) {
        setOpen(false);
        onDone();
      }
    } catch (failure) {
      if (abort.signal.aborted) return;
      const known = failure instanceof CartError && failure.status < 500 && failure.status !== 429;
      if (known) command.current = undefined;
      setError(
        known
          ? fa
            ? 'دیدگاه تغییر کرده است. صفحه را تازه کنید.'
            : 'The review changed. Reload this page.'
          : fa
            ? 'نتیجه مشخص نیست. دوباره همان درخواست را پیگیری کنید.'
            : 'The result is unknown. Retry the same request.',
      );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <Button ref={trigger} variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 size={16} />
        {fa ? 'حذف دیدگاه' : 'Remove review'}
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title={fa ? 'حذف دیدگاه' : 'Remove review'}
        restoreFocusRef={trigger}
      >
        <p>
          {fa
            ? 'این دیدگاه از صفحهٔ کالا و فهرست دیدگاه‌های شما برداشته می‌شود.'
            : 'This removes the review from the product page and your review list.'}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="contribution-actions">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            {fa ? 'انصراف' : 'Cancel'}
          </Button>
          <Button disabled={busy} onClick={() => void confirm()}>
            {fa ? 'تأیید حذف' : 'Remove review'}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function QuestionContributions() {
  const page = useContributionPage('questions');
  const { locale, digits } = useI18n();
  const fa = locale === 'fa';
  if (page.busy || page.error) return <PageState {...page} />;
  const next = page.result?.nextCursor;
  return (
    <>
      {!page.result?.items.length && (
        <p>
          {fa ? 'در این صفحه پرسشی دربارهٔ کالا ندارید.' : 'No product questions on this page.'}
        </p>
      )}
      <div className="contribution-list">
        {page.result?.items.map((item) => (
          <article className="contribution-card" key={item.id}>
            <header className="contribution-card-header">
              <ProductHeader product={item.product} fallback={item.name} tab="questions" />
              <span
                className="contribution-status"
                data-state={item.published ? 'Approved' : 'Pending'}
              >
                {item.published
                  ? fa
                    ? 'منتشرشده'
                    : 'Published'
                  : item.state === 'Closed'
                    ? fa
                      ? 'بسته‌شده'
                      : 'Closed'
                    : fa
                      ? 'در حال بررسی'
                      : 'Awaiting review'}
              </span>
            </header>
            <time dateTime={item.createdAt}>{dates[locale].format(new Date(item.createdAt))}</time>
            <h3 className="contribution-copy" dir="auto">
              {item.question}
            </h3>
            {item.replies.map((reply) => (
              <blockquote key={reply.id}>
                <strong dir="auto">
                  {reply.byStore
                    ? fa
                      ? 'پاسخ سایمان'
                      : 'Sayman reply'
                    : reply.displayName || (fa ? 'کاربر سایمان' : 'Sayman customer')}
                </strong>
                <p dir="auto">{reply.body}</p>
              </blockquote>
            ))}
            {item.privateReply && (
              <blockquote>
                <strong>{fa ? 'پاسخ خصوصی فروشگاه' : 'Private store reply'}</strong>
                <p dir="auto">{item.privateReply}</p>
              </blockquote>
            )}
            {!item.replies.length && !item.privateReply && (
              <p className="small-note">{fa ? 'هنوز پاسخی ثبت نشده است.' : 'No replies yet.'}</p>
            )}
            <footer className="contribution-actions">
              {item.product && (
                <Link
                  className="button button-outline"
                  href={productPath(item.product, 'questions')}
                >
                  {item.replyCount > item.replies.length
                    ? fa
                      ? `همهٔ ${digits(item.replyCount)} پاسخ در صفحهٔ کالا`
                      : `All ${item.replyCount} replies on the product page`
                    : fa
                      ? 'دیدن صفحهٔ کالا'
                      : 'View product'}
                </Link>
              )}
              <Link className="text-link" href={'/support/tickets/' + item.id}>
                {fa ? 'پیگیری پرسش' : 'Track question'}
              </Link>
            </footer>
          </article>
        ))}
      </div>
      <Pagination previous={page.previous} next={next ? () => page.next(next) : undefined} />
    </>
  );
}
