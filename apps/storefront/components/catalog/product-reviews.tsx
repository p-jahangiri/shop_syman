'use client';
import { BadgeCheck, ChevronDown, Image as ImageIcon, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import { Button, Modal } from '../shared/ui';
import { ReviewVoteBar } from '../reviews/review-votes';
import { ReviewStarInput, ReviewStars } from '../reviews/review-stars';
import { readReviewPhoto, reviewPhotoPath, ReviewPhotoInput } from '../reviews/review-photo';
import { CartError, type CartFetch } from '@/lib/checkout/cart-client';
import {
  listReviews,
  readVotes,
  readOwnReview,
  submitReview,
  reportReview,
} from '@/lib/reviews/reviews-client';
import {
  saveReviewInput,
  reviewPhotoMime,
  type PublicReview,
  type PrivateReview,
  type ReviewPage,
  type VoteValue,
  type SaveReviewInput,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
import '../shared/product-community.css';
import './product-reviews.css';
const states = {
  fa: { Pending: 'در انتظار بررسی', Approved: 'منتشرشده', Rejected: 'ردشده', Hidden: 'پنهان‌شده' },
  en: {
    Pending: 'Awaiting moderation',
    Approved: 'Published',
    Rejected: 'Rejected',
    Hidden: 'Hidden',
  },
};
export function ProductReviews({
  productId,
  productName,
  slug,
  compose = false,
  initialRating = 0,
}: {
  productId: string;
  productName: string;
  slug?: string;
  compose?: boolean;
  initialRating?: number;
}) {
  const { locale } = useI18n();
  const source = useStorefront().dataSource;
  if (source !== 'api')
    return (
      <p>
        {locale === 'fa'
          ? 'دیدگاه‌ها پس از اتصال سرویس در دسترس‌اند؛ نظر نمونه نمایش داده نمی‌شود.'
          : 'Reviews require the connected service. No sample testimonials are displayed.'}
      </p>
    );
  return (
    <ConnectedReviews
      key={`${productId}:${locale}`}
      productId={productId}
      productName={productName}
      slug={slug}
      compose={compose}
      initialRating={initialRating}
      locale={locale}
    />
  );
}
function ConnectedReviews({
  productId,
  productName,
  slug,
  compose,
  initialRating,
  locale,
}: {
  productId: string;
  productName: string;
  slug?: string;
  compose: boolean;
  initialRating: number;
  locale: 'fa' | 'en';
}) {
  const auth = useCustomerSession();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [page, setPage] = useState<ReviewPage | null>(null),
    [items, setItems] = useState<PublicReview[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(false);
  const [sort, setSort] = useState<'newest' | 'helpful'>('newest');
  const [voteState, setVoteState] = useState<{
    owner: string;
    values: Record<string, VoteValue>;
  }>();
  const [voteReadFailed, setVoteReadFailed] = useState(false);
  const [voteAttempt, setVoteAttempt] = useState(0);
  const [ownId, setOwnId] = useState<string>();
  const owner = auth.status === 'member' ? auth.session?.user.id : undefined;
  const memberFetch = owner ? auth.store.fetch : undefined;
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: string | null, quiet = false) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      if (!quiet) setBusy(true);
      setError(false);
      try {
        const result = await listReviews(productId, cursor, controller.signal, sort);
        if (!controller.signal.aborted) {
          setPage(result);
          setItems((old) =>
            cursor
              ? Array.from(new Map([...old, ...result.items].map((r) => [r.id, r])).values())
              : result.items,
          );
        }
      } catch {
        if (!controller.signal.aborted && !quiet) setError(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [productId, sort],
  );
  useEffect(() => {
    void load(null);
    let stamp: string | undefined;
    const watch = new EventSource(`/api/reviews/products/${encodeURIComponent(productId)}/watch`);
    watch.onmessage = ({ data }) => {
      if (stamp === data) return;
      stamp = data;
      if (data === 'unpublished') {
        abort.current?.abort();
        setItems([]);
        setPage(null);
        setBusy(false);
        return;
      }
      if (!document.hidden) void load(null, true);
    };
    const refresh = () => {
      if (!document.hidden) void load(null, true);
    };
    document.addEventListener('visibilitychange', refresh);
    const fallback = window.setInterval(() => {
      if (watch.readyState !== EventSource.OPEN) refresh();
    }, 15000);
    return () => {
      watch.close();
      window.clearInterval(fallback);
      document.removeEventListener('visibilitychange', refresh);
      abort.current?.abort();
    };
  }, [load, productId]);

  const reviewRevisions = items.map((item) => item.content.revisionId).join(',');
  useEffect(() => {
    if (!owner || !memberFetch || !reviewRevisions) return;
    const controller = new AbortController();
    const ids = reviewRevisions.split(',');
    const groups = Array.from({ length: Math.ceil(ids.length / 20) }, (_, i) =>
      ids.slice(i * 20, i * 20 + 20),
    );
    setVoteReadFailed(false);
    void Promise.all(
      groups.map((group) => readVotes(memberFetch, productId, group, controller.signal)),
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        const values: Record<string, VoteValue> = Object.fromEntries(ids.map((id) => [id, 0]));
        Object.assign(values, ...results);
        setVoteState({ owner, values });
      })
      .catch(() => {
        if (!controller.signal.aborted) setVoteReadFailed(true);
      });
    return () => controller.abort();
  }, [owner, memberFetch, productId, reviewRevisions, voteAttempt]);

  const [buyersOnly, setBuyersOnly] = useState(false);
  const [photoId, setPhotoId] = useState<string>();
  const photoTrigger = useRef<HTMLButtonElement>(null);
  const numberFormat = locale === 'fa' ? 'fa-IR' : 'en-US';
  const total = page?.ratingCounts.reduce((n, c) => n + c, 0) ?? 0;
  const average =
    page && total ? page.ratingCounts.reduce((n, c, i) => n + c * (i + 1), 0) / total : null;
  const visible = buyersOnly ? items.filter((item) => item.verifiedBuyer) : items;
  const photos = items.filter((item) => item.hasPhoto);
  const photoIndex = photos.findIndex((item) => item.content.revisionId === photoId);
  const photo = photos[photoIndex];
  const productReturn = slug ? `/product/${slug}?tab=reviews#product-tabs` : '';
  const signIn =
    '/account' + (productReturn ? '?returnTo=' + encodeURIComponent(productReturn) : '');
  const photoPath = (item: PublicReview) =>
    reviewPhotoPath(productId, item.id, item.content.revisionId);
  function openPhoto(item: PublicReview, trigger: HTMLButtonElement) {
    photoTrigger.current = trigger;
    setPhotoId(item.content.revisionId);
  }

  return (
    <section className="product-reviews" aria-labelledby="product-reviews-title">
      <h2 className="product-community-heading" id="product-reviews-title">
        {text('امتیاز و دیدگاه کاربران', 'Ratings and reviews')}
      </h2>
      <aside className="review-summary">
        {average !== null && (
          <div className="review-score">
            <div>
              <strong>{average.toLocaleString(numberFormat, { maximumFractionDigits: 1 })}</strong>{' '}
              {text('از ۵', 'out of 5')}
            </div>
            <ReviewStars rating={Math.round(average)} locale={locale} />
          </div>
        )}
        {page && (
          <p className="review-count">
            {total.toLocaleString(numberFormat)} {text('دیدگاه', 'reviews')}
          </p>
        )}
        {auth.status === 'member' && auth.session ? (
          <ReviewEditor
            key={`${productId}:${auth.session.user.id}:${locale}`}
            productId={productId}
            productName={productName}
            locale={locale}
            fetcher={auth.store.fetch}
            profileName={auth.session.user.displayName}
            autoOpen={compose}
            initialRating={initialRating}
            onOwn={setOwnId}
            onSaved={() => void load(null, true)}
          />
        ) : auth.status === 'restoring' ? (
          <p role="status">{text('در حال بررسی حساب…', 'Checking your account…')}</p>
        ) : (
          <>
            <p>
              {text(
                'تجربهٔ خود را دربارهٔ این کالا بنویسید.',
                'Share your experience with this product.',
              )}
            </p>
            <Link className="button button-outline" href={signIn}>
              {text('ورود و ثبت دیدگاه', 'Sign in to review')}
            </Link>
          </>
        )}
      </aside>
      <div className="review-feed">
        {owner && voteReadFailed && (
          <p role="status">
            {text('رأی‌های شما دریافت نشد.', 'Your votes could not be loaded.')}{' '}
            <button
              className="product-community-link"
              type="button"
              onClick={() => setVoteAttempt((n) => n + 1)}
            >
              {text('تلاش دوباره', 'Try again')}
            </button>
          </p>
        )}
        {photos.length > 0 && (
          <section
            className="review-photo-gallery"
            aria-label={text('عکس‌های کاربران', 'Customer photos')}
          >
            <div className="review-gallery-title">
              <ImageIcon size={18} aria-hidden="true" />
              <h3>{text('عکس‌های کاربران', 'Customer photos')}</h3>
            </div>
            <div className="review-photo-strip">
              {photos.slice(0, 6).map((item) => (
                <ReviewPhotoButton
                  key={item.content.revisionId}
                  path={photoPath(item)}
                  locale={locale}
                  onOpen={(trigger) => openPhoto(item, trigger)}
                />
              ))}
            </div>
          </section>
        )}
        {items.length > 0 && (
          <div className="product-community-toolbar">
            <div
              className="product-community-options"
              role="group"
              aria-label={text('نمایش دیدگاه‌ها', 'Filter reviews')}
            >
              <button type="button" aria-pressed={!buyersOnly} onClick={() => setBuyersOnly(false)}>
                {text('جدیدترین', 'Newest')}
              </button>
              <button
                type="button"
                aria-pressed={!buyersOnly && sort === 'helpful'}
                onClick={() => {
                  setBuyersOnly(false);
                  setSort('helpful');
                }}
              >
                {text('مفیدترین', 'Most helpful')}
              </button>
              <button type="button" aria-pressed={buyersOnly} onClick={() => setBuyersOnly(true)}>
                {text('دیدگاه خریداران', 'Verified buyers')}
              </button>
            </div>
            <small>
              {(buyersOnly ? visible.length : total).toLocaleString(numberFormat)}{' '}
              {text('دیدگاه', 'reviews')}
              {buyersOnly && page?.nextCursor && text(' در موارد نمایش‌داده‌شده', ' loaded')}
            </small>
          </div>
        )}
        {busy && <p role="status">{text('در حال دریافت دیدگاه‌ها…', 'Loading reviews…')}</p>}
        {error && (
          <p role="alert">
            {text('دیدگاه‌ها دریافت نشدند.', 'Reviews could not be loaded.')}{' '}
            <Button variant="outline" onClick={() => void load(null)}>
              {text('تلاش دوباره', 'Try again')}
            </Button>
          </p>
        )}
        {!busy && !error && visible.length === 0 && (
          <p className="review-empty">
            {buyersOnly
              ? page?.nextCursor
                ? text(
                    'در دیدگاه‌های نمایش‌داده‌شده خرید تأییدشده‌ای نیست. دیدگاه‌های بیشتری را ببینید.',
                    'No verified buyers in the loaded reviews. Load more to keep looking.',
                  )
                : text(
                    'هنوز دیدگاهی از خریداران این کالا ثبت نشده است.',
                    'There are no verified buyer reviews yet.',
                  )
              : text(
                  'هنوز دیدگاهی ثبت نشده است. اولین تجربه را بنویسید.',
                  'No reviews yet. Share the first experience.',
                )}
          </p>
        )}
        <div className="review-list">
          {visible.map((item) => (
            <article className="review-card" key={`${item.id}:${item.content.revisionId}`}>
              <header className="review-card-header">
                <div className="review-byline">
                  <span className="review-avatar" aria-hidden="true">
                    <UserRound size={18} />
                  </span>
                  <bdi>
                    <strong>{item.content.displayName}</strong>
                  </bdi>
                  {item.verifiedBuyer && (
                    <span className="review-buyer">
                      <BadgeCheck size={14} aria-hidden="true" />
                      {text('خریدار', 'Verified buyer')}
                    </span>
                  )}
                  {item.isDemo && <span className="review-demo">{text('نمونه', 'Demo')}</span>}
                </div>
                <time dateTime={item.content.at}>
                  {reviewDates[locale].format(new Date(item.content.at))}
                </time>
              </header>
              <ReviewStars rating={item.content.rating} locale={locale} />
              {!reviewTitles.includes(item.content.title) && <h3>{item.content.title}</h3>}
              <ReviewText body={item.content.body} locale={locale} />
              {item.hasPhoto && (
                <ReviewPhotoButton
                  path={photoPath(item)}
                  locale={locale}
                  onOpen={(trigger) => openPhoto(item, trigger)}
                />
              )}
              {item.reply && (
                <blockquote>
                  <strong>{text('پاسخ سایمان', 'Sayman reply')}</strong>
                  <p className="review-text" dir="auto">
                    {item.reply}
                  </p>
                </blockquote>
              )}
              <ReviewVoteBar
                key={'vote:' + (owner ?? 'guest')}
                id={item.id}
                revisionId={item.content.revisionId}
                likes={item.likes ?? 0}
                dislikes={item.dislikes ?? 0}
                own={!!owner && item.id === ownId}
                current={
                  owner && voteState?.owner === owner
                    ? voteState.values[item.content.revisionId]
                    : undefined
                }
                fetcher={memberFetch}
                signIn={auth.status === 'guest' ? signIn : undefined}
                onVoted={(value, likes, dislikes) => {
                  if (!owner) return;
                  setVoteState((state) =>
                    state?.owner === owner
                      ? { owner, values: { ...state.values, [item.content.revisionId]: value } }
                      : state,
                  );
                  setItems((rows) =>
                    rows.map((row) =>
                      row.content.revisionId === item.content.revisionId
                        ? { ...row, likes, dislikes }
                        : row,
                    ),
                  );
                  if (sort === 'helpful') void load(null, true);
                }}
              />
              {auth.status === 'member' && auth.session && (
                <Report
                  key={'report:' + auth.session.user.id}
                  item={item}
                  locale={locale}
                  fetcher={auth.store.fetch}
                />
              )}
            </article>
          ))}
        </div>
        {page?.nextCursor && (
          <Button variant="outline" disabled={busy} onClick={() => void load(page.nextCursor)}>
            {text('دیدگاه‌های بیشتر', 'More reviews')}
          </Button>
        )}
      </div>
      <Modal
        open={!!photo}
        onOpenChange={(open) => {
          if (!open) setPhotoId(undefined);
        }}
        title={text('عکس‌های دیدگاه‌ها', 'Review photos')}
        className="community-dialog review-gallery-dialog"
        restoreFocusRef={photoTrigger}
      >
        {photo && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- Pre-resized same-origin review photo. */}
            <img
              className="review-gallery-image"
              src={photoPath(photo)}
              alt={text('عکس پیوست دیدگاه', 'Photo attached to review')}
            />
            <div className="review-gallery-navigation">
              <Button
                variant="outline"
                disabled={photoIndex === 0}
                onClick={() => setPhotoId(photos[photoIndex - 1]?.content.revisionId)}
              >
                {text('قبلی', 'Previous')}
              </Button>
              <span role="status">
                {(photoIndex + 1).toLocaleString(numberFormat)} /{' '}
                {photos.length.toLocaleString(numberFormat)}
              </span>
              <Button
                variant="outline"
                disabled={photoIndex + 1 >= photos.length}
                onClick={() => setPhotoId(photos[photoIndex + 1]?.content.revisionId)}
              >
                {text('بعدی', 'Next')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

const reviewTitles = ['دیدگاه دربارهٔ کالا', 'Product review'];
const reviewDates = {
  fa: new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }),
};

function ReviewText({ body, locale }: { body: string; locale: 'fa' | 'en' }) {
  const [expanded, setExpanded] = useState(false);
  const letters = Array.from(body);
  if (letters.length <= 360)
    return (
      <p className="review-text" dir="auto">
        {body}
      </p>
    );
  const preview = letters.slice(0, 360).join('').trimEnd();
  const lastWord = Math.max(preview.lastIndexOf(' '), preview.lastIndexOf('\n'));
  const excerpt = (lastWord >= 300 ? preview.slice(0, lastWord) : preview) + '…';
  return (
    <p className="review-text review-body-copy" dir="auto">
      {expanded ? body : excerpt}{' '}
      <button
        className="review-read-more"
        type="button"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {locale === 'fa'
          ? expanded
            ? 'نمایش کمتر'
            : 'ادامهٔ دیدگاه'
          : expanded
            ? 'Show less'
            : 'Read more'}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </p>
  );
}
function ReviewPhotoButton({
  path,
  locale,
  onOpen,
}: {
  path: string;
  locale: 'fa' | 'en';
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <button
      type="button"
      className="review-public-photo"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={locale === 'fa' ? 'بزرگ‌نمایی عکس دیدگاه' : 'Enlarge review photo'}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Pre-resized same-origin review photo. */}
      <img
        className="review-photo-thumb"
        src={path}
        width={80}
        height={80}
        loading="lazy"
        decoding="async"
        alt=""
        onError={() => setBroken(true)}
      />
    </button>
  );
}

function ReviewEditor({
  productId,
  productName,
  locale,
  fetcher,
  profileName,
  autoOpen = false,
  initialRating = 0,
  onOwn,
  onSaved,
}: {
  productId: string;
  productName: string;
  locale: 'fa' | 'en';
  fetcher: CartFetch;
  profileName?: string;
  autoOpen?: boolean;
  initialRating?: number;
  onOwn?: (id: string | undefined) => void;
  onSaved: () => void;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [own, setOwn] = useState<PrivateReview | null>(null),
    [busy, setBusy] = useState(true),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [encoding, setEncoding] = useState(false),
    [photoFile, setPhotoFile] = useState<File | null>(null),
    [removePhoto, setRemovePhoto] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [formEpoch, setFormEpoch] = useState(0),
    [saved, setSaved] = useState(false),
    [open, setOpen] = useState(autoOpen);
  const editButton = useRef<HTMLButtonElement>(null);
  const pending = useRef<{ id: string; input: SaveReviewInput } | null>(null),
    abort = useRef<AbortController | null>(null),
    encodingRef = useRef(false);
  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setLoaded(false);
    setError('');
    try {
      const result = await readOwnReview(fetcher, productId, controller.signal);
      if (!controller.signal.aborted) {
        setOwn(result);
        onOwn?.(result?.id);
        setPhotoFile(null);
        setRemovePhoto(false);
        setLoaded(true);
        setUncertain(false);
        pending.current = null;
        setFormEpoch((n) => n + 1);
      }
    } catch {
      if (!controller.signal.aborted) setError('read');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [fetcher, productId, onOwn]);
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);

  async function run(command: { id: string; input: SaveReviewInput }) {
    if (busy) return;
    pending.current = command;
    setBusy(true);
    setError('');
    setSaved(false);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await submitReview(
        fetcher,
        productId,
        command.id,
        command.input,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setOwn(result.review);
        onOwn?.(result.review?.id);
        setPhotoFile(null);
        setRemovePhoto(false);
        setUncertain(false);
        pending.current = null;
        setSaved(true);
        setOpen(false);
        setFormEpoch((n) => n + 1);
        onSaved();
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      const status = e instanceof CartError ? e.status : 0;
      const scannerUnavailable = e instanceof CartError && e.code === 'media_unavailable';
      if ((status >= 400 && status < 500 && status !== 429) || scannerUnavailable) {
        pending.current = null;
        setUncertain(false);
        setError(
          scannerUnavailable
            ? 'photo-unavailable'
            : status === 409
              ? 'conflict'
              : status === 401 || status === 403
                ? 'auth'
                : status === 413 ||
                    (e instanceof CartError && ['invalid_image', 'image_rejected'].includes(e.code))
                  ? 'photo'
                  : 'invalid',
        );
      } else {
        setUncertain(true);
        setError('uncertain');
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const candidateName = profileName?.trim() ?? '';
  const publicName =
    candidateName.length > 0 &&
    candidateName.length <= 60 &&
    !/@|[\u202a-\u202e\u2066-\u2069]|\p{Cc}/u.test(candidateName) &&
    candidateName.replace(/[^\p{Nd}]/gu, '').length < 5
      ? candidateName
      : '';
  const anonymousName = text('کاربر سایمان', 'Sayman customer');
  const previousName = own?.content.displayName;
  const previousCustom =
    previousName && previousName !== 'کاربر سایمان' && previousName !== 'Sayman customer';
  const defaultIdentity = previousCustom
    ? previousName === publicName
      ? 'profile'
      : 'previous'
    : 'anonymous';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || uncertain || !loaded || encodingRef.current) return;
    const data = new FormData(e.currentTarget);
    const value = saveReviewInput.safeParse({
      version: own?.version ?? null,
      locale: own?.content.locale ?? locale,
      rating: Number(data.get('rating')),
      displayName:
        data.get('identity') === 'profile' && publicName
          ? publicName
          : data.get('identity') === 'previous' && previousCustom
            ? previousName
            : anonymousName,
      title:
        String(data.get('title') ?? '').trim() ||
        reviewTitles[(own?.content.locale ?? locale) === 'fa' ? 0 : 1],
      body: String(data.get('body') ?? '').trim(),
      publishConsent: true,
    });
    if (!value.success) {
      const field = value.error.issues[0]?.path[0];
      setError(
        field === 'rating' || field === 'body' || field === 'title' ? `field-${field}` : 'invalid',
      );
      if (typeof field === 'string')
        e.currentTarget.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }
    if (photoFile) {
      const session = abort.current;
      encodingRef.current = true;
      setEncoding(true);
      try {
        const data = await readReviewPhoto(photoFile);
        if (session?.signal.aborted) return;
        value.data.photo = {
          action: 'replace',
          name: photoFile.name,
          contentType: reviewPhotoMime.parse(photoFile.type),
          data,
        };
      } catch {
        setError('photo');
        return;
      } finally {
        encodingRef.current = false;
        setEncoding(false);
      }
    } else if (removePhoto) value.data.photo = { action: 'remove' };
    void run({ id: crypto.randomUUID().replaceAll('-', ''), input: value.data });
  }
  return (
    <div className="review-editor-launch">
      {!own && (
        <p>
          {text(
            'تجربهٔ خود را دربارهٔ این کالا بنویسید.',
            'Share your experience with this product.',
          )}
        </p>
      )}
      {own && <p role="status">{states[locale][own.state]}</p>}
      {saved && (
        <p role="status">
          {own?.state === 'Approved'
            ? text('دیدگاه ذخیره و منتشر شد.', 'Your review was saved and published.')
            : text(
                'ویرایش ذخیره شد و منتظر بررسی است.',
                'Your edit was saved and is awaiting review.',
              )}
        </p>
      )}
      {loaded && (
        <Button
          ref={editButton}
          variant="outline"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          {own ? text('ویرایش دیدگاه', 'Edit review') : text('ثبت دیدگاه', 'Write a review')}
        </Button>
      )}
      {busy && !open && (
        <p role="status">{text('در حال دریافت دیدگاه شما…', 'Loading your review…')}</p>
      )}
      {error === 'read' && !open && (
        <Button variant="outline" onClick={() => void load()}>
          {text('دریافت دوبارهٔ دیدگاه من', 'Retry loading your review')}
        </Button>
      )}
      <Modal
        className="review-editor review-editor-dialog community-dialog"
        title={own ? text('ویرایش دیدگاه', 'Edit review') : text('ثبت دیدگاه', 'Write a review')}
        open={open}
        onOpenChange={(value) => {
          if (!busy && !encoding && !uncertain) setOpen(value);
        }}
        restoreFocusRef={editButton}
      >
        <div className="community-dialog-context">
          <bdi>{productName}</bdi>
        </div>
        {error && error !== 'photo' && error !== 'photo-unavailable' && (
          <div className="notice" role="alert">
            <p>
              {error === 'uncertain'
                ? text(
                    'نتیجه دریافت نشد. تلاش دوباره همان شناسه و بدنه را می‌فرستد. دریافت وضعیت تازه فرم را بازنشانی می‌کند؛ نتیجه را بررسی کنید.',
                    'The result was not received. Retry sends the same id and body. Reloading resets this form; check the current result.',
                  )
                : error === 'conflict'
                  ? text(
                      'دیدگاه تغییر کرده است؛ وضعیت تازه را دریافت کنید.',
                      'The review changed. Reload its current state.',
                    )
                  : error === 'field-rating'
                    ? text(
                        'امتیاز یک تا پنج ستاره را انتخاب کنید.',
                        'Choose a rating from one to five stars.',
                      )
                    : error === 'field-title'
                      ? text(
                          'عنوان باید حداکثر ۱۰۰ نویسه باشد.',
                          'The title must be at most 100 characters.',
                        )
                      : error === 'field-body'
                        ? text(
                            'متن دیدگاه باید ۱۰ تا ۲۰۰۰ نویسه باشد.',
                            'Enter a review between 10 and 2,000 characters.',
                          )
                        : error === 'invalid'
                          ? text(
                              'امتیاز، عنوان و متن را بررسی کنید.',
                              'Check the rating, title and review text.',
                            )
                          : text(
                              'وضعیت حساب یا دیدگاه دریافت نشد؛ دوباره بررسی کنید.',
                              'Your account or review could not be verified. Please retry.',
                            )}
            </p>
            {uncertain && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (pending.current) void run(pending.current);
                }}
              >
                {text('پیگیری همان درخواست', 'Retry the same request')}
              </Button>
            )}
            {['uncertain', 'conflict', 'auth', 'read'].includes(error) && (
              <Button variant="outline" disabled={busy} onClick={() => void load()}>
                {text('دریافت وضعیت تازه', 'Reload current state')}
              </Button>
            )}
          </div>
        )}
        {busy && <p role="status">{text('در حال بررسی…', 'Checking…')}</p>}
        {loaded && (
          <form key={formEpoch} noValidate onSubmit={(e) => void submit(e)}>
            <fieldset
              disabled={busy || encoding || uncertain || error === 'conflict' || error === 'auth'}
            >
              <ReviewStarInput initial={own?.content.rating ?? initialRating} locale={locale} />
              <label className="review-identity">
                {text('نامی که کنار دیدگاه نمایش داده می‌شود', 'Name shown next to your review')}
                <select name="identity" defaultValue={defaultIdentity}>
                  <option value="anonymous">{text('ارسال ناشناس', 'Post anonymously')}</option>
                  {publicName && (
                    <option value="profile">
                      {text('ارسال با نام شما', 'Post with your name')} · {publicName}
                    </option>
                  )}
                  {previousCustom && previousName !== publicName && (
                    <option value="previous">
                      {text('همان نام قبلی', 'Keep previous name')} · {previousName}
                    </option>
                  )}
                </select>
              </label>
              <label>
                {text('تجربهٔ شما؛ ۱۰ تا ۲۰۰۰ نویسه', 'Your experience; 10–2000 characters')}
                <textarea
                  name="body"
                  aria-invalid={error === 'field-body' || undefined}
                  minLength={10}
                  maxLength={2000}
                  rows={5}
                  required
                  defaultValue={own?.content.body ?? ''}
                />
              </label>
              <label>
                {text('عنوان (اختیاری)', 'Title (optional)')}
                <input
                  name="title"
                  aria-invalid={error === 'field-title' || undefined}
                  maxLength={100}
                  defaultValue={
                    own && !reviewTitles.includes(own.content.title) ? own.content.title : ''
                  }
                />
              </label>
              <ReviewPhotoInput
                locale={locale}
                fetcher={fetcher}
                file={photoFile}
                remove={removePhoto}
                path={
                  own?.hasPhoto ? reviewPhotoPath(productId, own.id, own.content.revisionId) : null
                }
                onFile={(file, remove) => {
                  setPhotoFile(file);
                  setRemovePhoto(remove);
                  if (error === 'photo' || error === 'photo-unavailable') setError('');
                }}
              />
              {error === 'photo' && (
                <small className="review-photo-error" role="alert">
                  {text(
                    'عکس پذیرفته نشد. یک تصویر سالم و بدون انیمیشن انتخاب کنید یا دیدگاه را بدون عکس بفرستید.',
                    'The photo was not accepted. Choose a valid still image or submit the review without a photo.',
                  )}
                </small>
              )}
              {error === 'photo-unavailable' && (
                <small className="review-photo-error" role="alert">
                  {text(
                    'بررسی عکس فعلاً در دسترس نیست. دوباره تلاش کنید یا دیدگاه را بدون عکس بفرستید.',
                    'Photo scanning is temporarily unavailable. Retry or submit the review without a photo.',
                  )}
                </small>
              )}
              <p className="small-note">
                {text(
                  'دیدگاه شما عمومی است. شماره، نشانی و جزئیات سفارش را در متن یا عکس وارد نکنید.',
                  'Your review is public. Leave contact, address and order details out of your text and photo.',
                )}
              </p>
              <Button type="submit">
                {own ? text('ذخیرهٔ ویرایش', 'Save edit') : text('ثبت دیدگاه', 'Publish review')}
              </Button>
            </fieldset>
          </form>
        )}
      </Modal>
    </div>
  );
}
function Report({
  item,
  locale,
  fetcher,
}: {
  item: PublicReview;
  locale: 'fa' | 'en';
  fetcher: CartFetch;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState<'spam' | 'abuse' | 'personal_data' | 'unrelated'>('spam'),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState(false);
  const command = useRef<{ id: string; reason: typeof reason } | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  async function send() {
    if (busy) return;
    command.current ??= { id: crypto.randomUUID().replaceAll('-', ''), reason };
    const current = command.current;
    setBusy(true);
    setError(false);
    try {
      await reportReview(fetcher, item.id, current.id, {
        revisionId: item.content.revisionId,
        reason: current.reason,
      });
      if (alive.current) setDone(true);
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (done)
    return (
      <small role="status">
        {text('گزارش برای بررسی ثبت شد.', 'Report submitted for moderation.')}
      </small>
    );
  return (
    <div className="review-report">
      {!open ? (
        <button type="button" className="text-link" onClick={() => setOpen(true)}>
          {text('گزارش دیدگاه', 'Report review')}
        </button>
      ) : (
        <>
          <label>
            {text('دلیل گزارش', 'Reason')}
            <select
              disabled={busy || !!command.current}
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              {[
                ['spam', 'هرزنامه', 'Spam'],
                ['abuse', 'توهین', 'Abuse'],
                ['personal_data', 'اطلاعات شخصی', 'Personal data'],
                ['unrelated', 'نامرتبط', 'Unrelated'],
              ].map(([id, fa, en]) => (
                <option key={id} value={id}>
                  {text(fa, en)}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" disabled={busy} onClick={() => void send()}>
            {text(
              error ? 'پیگیری همان گزارش' : 'ثبت گزارش',
              error ? 'Retry same report' : 'Submit report',
            )}
          </Button>
          {error && (
            <p role="alert">
              {text(
                'نتیجه دریافت نشد یا دیدگاه تغییر کرده است؛ تلاش دوباره همین گزارش را پیگیری می‌کند.',
                'Result unavailable or review changed; retry follows the same report.',
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
