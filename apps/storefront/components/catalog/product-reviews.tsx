'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import { Button } from '../shared/ui';
import { ReviewStarInput, ReviewStars } from '../reviews/review-stars';
import { readReviewPhoto, reviewPhotoPath, ReviewPhotoInput } from '../reviews/review-photo';
import { CartError, type CartFetch } from '@/lib/checkout/cart-client';
import {
  listReviews,
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
  type SaveReviewInput,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
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
export function ProductReviews({ productId }: { productId: string }) {
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
  return <ConnectedReviews key={`${productId}:${locale}`} productId={productId} locale={locale} />;
}
function ConnectedReviews({ productId, locale }: { productId: string; locale: 'fa' | 'en' }) {
  const auth = useCustomerSession();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [page, setPage] = useState<ReviewPage | null>(null),
    [items, setItems] = useState<PublicReview[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(false),
    [epoch, setEpoch] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: string | null) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setError(false);
      if (!cursor) {
        setItems([]);
        setPage(null);
      }
      try {
        const result = await listReviews(productId, cursor, controller.signal);
        if (!controller.signal.aborted) {
          setPage(result);
          setItems((old) =>
            cursor
              ? Array.from(new Map([...old, ...result.items].map((r) => [r.id, r])).values())
              : result.items,
          );
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [productId],
  );
  useEffect(() => {
    void load(null);
    return () => abort.current?.abort();
  }, [epoch, load]);

  const total = page?.ratingCounts.reduce((n, c) => n + c, 0) ?? 0;
  const average =
    page && total
      ? (page.ratingCounts.reduce((n, c, i) => n + c * (i + 1), 0) / total).toLocaleString(
          locale === 'fa' ? 'fa-IR' : 'en-US',
          { maximumFractionDigits: 1 },
        )
      : null;
  return (
    <section
      className="product-reviews"
      aria-label={text('دیدگاه‌های کاربران', 'Customer reviews')}
    >
      <div className="reviews-heading">
        <div>
          <h2>{text('تجربهٔ کاربران', 'Customer experiences')}</h2>
          {page && (
            <p>
              {total.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')}{' '}
              {text('دیدگاه تأییدشده', 'approved reviews')}
              {average && (
                <>
                  {' '}
                  ·{' '}
                  <bdi dir="ltr">
                    {average} / {(5).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')}
                  </bdi>
                </>
              )}
            </p>
          )}
        </div>
        <Button variant="outline" disabled={busy} onClick={() => setEpoch((n) => n + 1)}>
          {text('تازه‌سازی دیدگاه‌ها', 'Refresh reviews')}
        </Button>
      </div>
      <p className="small-note">
        {text(
          'دیدگاه‌ها از کاربران همین فروشگاه‌اند و پس از بررسی منتشر می‌شوند. زبان اصلی متن حفظ می‌شود؛ نشان خریدار فقط از سفارش پرداخت‌شده یا تحویل‌شدهٔ معتبر است.',
          'Reviews come from this store’s users and appear after moderation. Original language is preserved. The buyer badge requires a qualifying paid or fulfilled order.',
        )}
      </p>
      {items.some((r) => r.isDemo) && (
        <p className="small-note">
          {text(
            'دیدگاه‌های دارای نشان «نمونه» برای تمرین‌اند و تجربهٔ خرید واقعی نیستند.',
            'Reviews marked “Demo” are examples and do not represent real purchases.',
          )}
        </p>
      )}
      {busy && <p role="status">{text('در حال دریافت دیدگاه‌ها…', 'Loading reviews…')}</p>}
      {error && (
        <p role="alert">
          {text(
            'دیدگاه‌ها دریافت نشدند؛ دوباره تلاش کنید.',
            'Reviews could not be loaded. Please retry.',
          )}
        </p>
      )}
      {!busy && !error && !items.length && (
        <p>{text('هنوز دیدگاه تأییدشده‌ای ثبت نشده است.', 'No approved reviews yet.')}</p>
      )}
      <div className="review-list">
        {items.map((r) => (
          <article className="review-card" key={`${r.id}:${r.content.revisionId}`}>
            <header>
              <strong dir="auto">{r.content.title}</strong>
              <ReviewStars rating={r.content.rating} locale={locale} />
            </header>
            <p className="review-text" dir="auto">
              {r.content.body}
            </p>
            {r.hasPhoto && (
              <PublicPhoto
                path={reviewPhotoPath(productId, r.id, r.content.revisionId)}
                locale={locale}
              />
            )}
            <div className="review-meta">
              <span dir="auto">{r.content.displayName}</span>
              <time dateTime={r.content.at}>
                {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                  dateStyle: 'medium',
                }).format(new Date(r.content.at))}
              </time>
              <span lang={r.content.locale}>{r.content.locale === 'fa' ? 'فارسی' : 'English'}</span>
              {r.verifiedBuyer && <strong>{text('خریدار این کالا', 'Verified buyer')}</strong>}
              {r.isDemo && (
                <span className="review-demo">{text('دیدگاه نمونه', 'Demo review')}</span>
              )}
            </div>
            {r.reply && (
              <blockquote>
                <strong>{text('پاسخ سایمان', 'Sayman reply')}</strong>
                <p className="review-text" dir="auto">
                  {r.reply}
                </p>
              </blockquote>
            )}
            {auth.status === 'member' && auth.session && (
              <Report
                key={`${auth.session.user.id}:${r.content.revisionId}`}
                item={r}
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
      {auth.status === 'member' && auth.session ? (
        <ReviewEditor
          key={`${productId}:${auth.session.user.id}:${locale}`}
          productId={productId}
          locale={locale}
          fetcher={auth.store.fetch}
          onSaved={() => setEpoch((n) => n + 1)}
        />
      ) : (
        <p role="status">
          {auth.status === 'restoring'
            ? text('در حال بررسی حساب…', 'Checking your account…')
            : text('برای ثبت تجربهٔ خود وارد حساب شوید.', 'Sign in to share your experience.')}{' '}
          {auth.status !== 'restoring' && (
            <Link className="text-link" href="/account">
              {text('ورود به حساب', 'Sign in')}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
function PublicPhoto({ path, locale }: { path: string; locale: 'fa' | 'en' }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <a
      className="review-public-photo"
      href={path}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        locale === 'fa' ? 'باز کردن عکس دیدگاه در زبانهٔ جدید' : 'Open review photo in a new tab'
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Same-origin, pre-resized moderated image; no optimization cache for review media. */}
      <img
        className="review-photo-thumb"
        src={path}
        width={112}
        height={88}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        alt={locale === 'fa' ? 'عکس پیوست دیدگاه' : 'Photo attached to review'}
      />
    </a>
  );
}
function ReviewEditor({
  productId,
  locale,
  fetcher,
  onSaved,
}: {
  productId: string;
  locale: 'fa' | 'en';
  fetcher: CartFetch;
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
    [saved, setSaved] = useState(false);
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
  }, [fetcher, productId]);
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
        setPhotoFile(null);
        setRemovePhoto(false);
        setUncertain(false);
        pending.current = null;
        setSaved(true);
        setFormEpoch((n) => n + 1);
        onSaved();
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      const status = e instanceof CartError ? e.status : 0;
      const scannerUnavailable = e instanceof CartError && e.code === 'media_unavailable';
      if ((status >= 400 && status < 500) || scannerUnavailable) {
        pending.current = null;
        setUncertain(false);
        setError(
          scannerUnavailable
            ? 'photo-unavailable'
            : status === 409
              ? 'conflict'
              : status === 401 || status === 403
                ? 'auth'
                : command.input.photo?.action === 'replace'
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
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || uncertain || !loaded || encodingRef.current) return;
    const data = new FormData(e.currentTarget);
    const value = saveReviewInput.safeParse({
      version: own?.version ?? null,
      locale: own?.content.locale ?? locale,
      rating: Number(data.get('rating')),
      displayName: String(data.get('displayName') ?? '').trim(),
      title: String(data.get('title') ?? '').trim(),
      body: String(data.get('body') ?? '').trim(),
      publishConsent: data.get('consent') === 'on',
    });
    if (!value.success) {
      setError('invalid');
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
    <section className="review-editor">
      <h3>{text('دیدگاه شما', 'Your review')}</h3>
      {own && <p role="status">{states[locale][own.state]}</p>}
      {saved && (
        <p role="status">
          {text(
            'دیدگاه ذخیره شد و برای بررسی ارسال شد.',
            'Your review was saved and submitted for moderation.',
          )}
        </p>
      )}
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
                : error === 'invalid'
                  ? text(
                      'امتیاز، نام عمومی، عنوان، متن حداقل ده نویسه و رضایت انتشار را بررسی کنید.',
                      'Check the rating, public name, title, body of at least ten characters, and publication consent.',
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
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            {text('دریافت وضعیت تازه', 'Reload current state')}
          </Button>
        </div>
      )}
      {busy && <p role="status">{text('در حال بررسی…', 'Checking…')}</p>}
      {loaded && (
        <form key={formEpoch} onSubmit={(e) => void submit(e)}>
          <fieldset
            disabled={busy || encoding || uncertain || error === 'conflict' || error === 'auth'}
          >
            <div className="review-form-grid">
              <label>
                {text('نام عمومی', 'Public display name')}
                <input
                  name="displayName"
                  maxLength={60}
                  required
                  defaultValue={own?.content.displayName ?? ''}
                  autoComplete="off"
                />
              </label>
              <ReviewStarInput initial={own?.content.rating ?? 0} locale={locale} />
            </div>
            <label>
              {text('عنوان', 'Title')}
              <input
                name="title"
                maxLength={100}
                required
                defaultValue={own?.content.title ?? ''}
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
            <label>
              {text('تجربهٔ شما؛ ۱۰ تا ۲۰۰۰ نویسه', 'Your experience; 10–2000 characters')}
              <textarea
                name="body"
                minLength={10}
                maxLength={2000}
                rows={5}
                required
                defaultValue={own?.content.body ?? ''}
              />
            </label>
            <p className="small-note">
              {text(
                'شماره تماس، نشانی، اطلاعات سفارش یا مشخصات شخصی دیگران را در متن ننویسید. ویرایش نظر منتشرشده آن را تا بررسی دوباره پنهان می‌کند.',
                'Do not include contact details, addresses, order details or other people’s personal information. Editing a published review hides it until moderation.',
              )}
            </p>
            <label className="review-consent">
              <input name="consent" type="checkbox" required />
              {text(
                'با انتشار عمومی متن، نام انتخابی و عکس پیوست پس از بررسی موافقم.',
                'I consent to public display of the text, chosen name and attached photo after moderation.',
              )}
            </label>
            <Button type="submit">
              {text(
                own ? 'ذخیرهٔ ویرایش و ارسال برای بررسی' : 'ارسال دیدگاه برای بررسی',
                own ? 'Save edit for moderation' : 'Submit for moderation',
              )}
            </Button>
          </fieldset>
        </form>
      )}
    </section>
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
