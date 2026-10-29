import { AdminTable } from './admin-table';
import { ImageEditor } from './media';
import { cmsImagePreview, cmsPagePreview } from './cms-image-model';
import { useCmsImageUploads } from './cms-image-uploads';
import '../../storefront/components/blog.css';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { adminViewRevision } from './admin-view-authority';
import { adminCmsBlogPostJournal as journal } from './admin-cms-blog-post-journal';
import { PageEditor } from './cms-pages';
import { Check, ErrorBox, Field, Modal } from './ui';
import { CmsPageView } from '../../storefront/components/cms-page-view';
import {
  cmsBlogContentSchema,
  cmsBlogPostCommandPath,
  cmsBlogPostDetailSchema,
  cmsBlogPostHistorySchema,
  cmsBlogPostListSchema,
  cmsBlogPostRevisionSchema,
  emptyCmsBlogContent,
  publishedCmsBlogContent,
  type CmsBlogContent,
  type CmsBlogPostCommand,
  type CmsBlogPostDetail,
  type CmsBlogPostInput,
} from '../../storefront/lib/cms-blog-post-contract';
import type { CmsPageDetail, CmsPageInput } from '../../storefront/lib/cms-page-contract';
const uuid = () => crypto.randomUUID().replaceAll('-', ''),
  origin = (import.meta.env.VITE_STOREFRONT_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, ''),
  base = '/admin/blog-posts';
export function CmsBlogPostCommandGuard({
  viewerId,
  onOpen,
}: {
  viewerId: string;
  onOpen: () => void;
}) {
  const e = useSyncExternalStore(
    journal.subscribe,
    () => journal.snapshot(viewerId),
    () => null,
  );
  return e && ['pending', 'unknown'].includes(e.state) ? (
    <section className="notice credit-schedule-guard" role="status">
      <p>
        فرمان مقاله هنوز نتیجهٔ قطعی ندارد. شناسه: <bdi>{e.command.id}</bdi>
      </p>
      <button onClick={onOpen}>پیگیری فرمان بلاگ</button>
    </section>
  ) : null;
}
function BlogPreview({
  content,
  locale,
  isDemo,
}: {
  content: CmsBlogContent;
  locale: 'fa' | 'en';
  isDemo: boolean;
}) {
  return (
    <div dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <p>
        {locale === 'fa' ? 'نویسنده: ' : 'By: '}
        {locale === 'fa' ? content.bylineFa : content.bylineEn}
        {content.authorKind ? ' · ' + content.authorKind : ''}
      </p>
      {content.cover && (
        <img
          className="blog-cover"
          src={cmsImagePreview(content.cover)}
          alt={(locale === 'fa' ? content.coverAltFa : content.coverAltEn) ?? ''}
        />
      )}
      <p>{content.tags.map((t) => (locale === 'fa' ? t.nameFa : t.nameEn)).join(' · ')}</p>
      <CmsPageView
        content={cmsPagePreview(content.body[locale])}
        locale={locale}
        isDemo={isDemo}
        link={(href, label) => (
          <a href={origin + '/' + locale + href} target="_blank" rel="noreferrer">
            {label}
          </a>
        )}
      />
    </div>
  );
}
export function CmsBlogPosts({ viewerId, writable }: { viewerId: string; writable: boolean }) {
  const client = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [before, setBefore] = useState<number | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [review, setReview] = useState<{
      input: CmsBlogPostInput;
      content: CmsBlogContent;
      previous: CmsBlogPostDetail;
    } | null>(null),
    [locale, setLocale] = useState<'fa' | 'en'>('fa');
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    ),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => () => journal.interrupt(), []);
  useEffect(() => {
    if (!unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);
  function check<T>(x: T) {
    if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرد.');
    return x;
  }
  const list = useQuery({
    queryKey: ['admin', 'cms-blog-posts', viewerId, cursor],
    queryFn: async ({ signal }) =>
      check(
        cmsBlogPostListSchema.parse(
          await api(base + (cursor ? '?cursor=' + cursor : ''), { signal }),
        ),
      ),
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: ['admin', 'cms-blog-post', viewerId, selected],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const p = check(cmsBlogPostDetailSchema.parse(await api(base + '/' + selected, { signal })));
      if (p.id !== selected) throw Error('مقاله تغییر کرد.');
      return p;
    },
    refetchOnWindowFocus: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'cms-blog-post-history', viewerId, selected, before],
    enabled: !!selected,
    queryFn: async ({ signal }) =>
      check(
        cmsBlogPostHistorySchema.parse(
          await api(
            base + '/' + selected + '/history' + (before ? '?beforePublication=' + before : ''),
            { signal },
          ),
        ),
      ),
    refetchOnWindowFocus: false,
  });
  async function refresh(id?: string) {
    if (id) {
      setCreating(false);
      setSelected(id);
    }
    await Promise.all(
      ['cms-blog-posts', 'cms-blog-post', 'cms-blog-post-history'].map((k) =>
        client.invalidateQueries({ queryKey: ['admin', k] }),
      ),
    );
  }
  async function send(command: CmsBlogPostCommand, retry = false) {
    if (!writable || busy || uploadBusy || authority !== adminViewRevision()) return;
    setBusy(true);
    setError(undefined);
    try {
      if (retry) journal.retry(viewerId);
      else journal.begin(viewerId, command);
      const raw = await api(cmsBlogPostCommandPath(command), {
        method: 'POST',
        body: JSON.stringify(command.input),
      });
      if (journal.finish(viewerId, command, raw)) {
        setReview(null);
        setBefore(null);
        await refresh(journal.snapshot(viewerId)?.result?.postId);
      }
    } catch (err) {
      setReview(null);
      journal.fail(
        viewerId,
        command,
        err instanceof ApiError ? err.status : 0,
        err instanceof ApiError ? err.code : 'unknown',
      );
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function receipt() {
    if (!entry || busy || uploadBusy || authority !== adminViewRevision()) return;
    setBusy(true);
    setError(undefined);
    try {
      const raw = await api(cmsBlogPostCommandPath(entry.command));
      if (journal.finish(viewerId, entry.command, raw)) {
        setReview(null);
        await refresh(journal.snapshot(viewerId)?.result?.postId);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  function publication(action: 'Publish' | 'Unpublish', p: CmsBlogPostDetail) {
    setError(undefined);
    try {
      const content = action === 'Publish' ? publishedCmsBlogContent(p.draft) : p.published;
      if (!content) throw Error();
      setReview({ input: { action, version: p.version, confirmed: false }, content, previous: p });
      setLocale('fa');
    } catch {
      setError(
        Error(
          'عنوان و بلوک معتبر هر دو زبان و نوع و نام عمومی نویسنده را ابتدا در پیش‌نویس ذخیره کنید.',
        ),
      );
    }
  }
  async function restore(id: string) {
    if (!detail.data || busy || uploadBusy || unresolved) return;
    setBusy(true);
    setError(undefined);
    try {
      const p = detail.data,
        r = check(
          cmsBlogPostRevisionSchema.parse(await api(base + '/' + p.id + '/revisions/' + id)),
        );
      if (
        r.postId !== p.id ||
        r.slug !== p.slug ||
        r.isDemo !== p.isDemo ||
        r.revision.id !== id ||
        r.revision.action === 'Unpublish'
      )
        throw Error();
      setReview({
        input: { action: 'Restore', version: p.version, restoreRevisionId: id, confirmed: false },
        content: r.content,
        previous: p,
      });
      setLocale('fa');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const p = detail.data,
    disabled = busy || uploadBusy || unresolved || !writable;
  return (
    <section className="panel cms-pages-admin">
      <div className="section-heading">
        <div>
          <h2>مقاله‌ها و بلاگ</h2>
          <p>
            انتشار مستقل مقالهٔ دوزبانه، نویسندهٔ عمومی و برچسب‌های پویا. هیچ محتوایی با ذخیرهٔ
            پیش‌نویس منتشر نمی‌شود.
          </p>
        </div>
        <button
          disabled={disabled}
          onClick={() => {
            setSelected(null);
            setCreating(true);
            setReview(null);
          }}
        >
          مقالهٔ تازه
        </button>
      </div>
      <ErrorBox error={error ?? list.error ?? detail.error ?? history.error} />
      {entry && (
        <section className="notice" role="status">
          <p>
            {entry.state === 'unknown'
              ? 'نتیجهٔ فرمان مقاله نامعلوم است؛ رسید همان شناسه را بخوانید.'
              : entry.state === 'pending'
                ? 'در حال ثبت فرمان مقاله…'
                : entry.state === 'done'
                  ? 'فرمان مقاله ثبت شد.'
                  : 'فرمان مقاله رد شد.'}
          </p>
          <bdi>{entry.command.id}</bdi>
          {entry.state === 'unknown' && (
            <>
              <button disabled={busy || uploadBusy || !writable} onClick={() => void receipt()}>
                بررسی رسید همان فرمان مقاله
              </button>
              <button
                disabled={busy || uploadBusy || !writable}
                onClick={() => void send(entry.command, true)}
              >
                تلاش دوبارهٔ همان فرمان مقاله
              </button>
            </>
          )}
          {['done', 'rejected'].includes(entry.state) && (
            <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ فرمان مقاله</button>
          )}
        </section>
      )}
      <AdminTable aria-label="فهرست مدیریت محتوا">
        <thead>
          <tr>
            <th>نشانی</th>
            <th>وضعیت انتشار</th>
            <th>دادهٔ توسعه</th>
            <th>عملیات</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((x) => (
            <tr key={x.id}>
              <td>
                <bdi>{x.slug}</bdi>
              </td>
              <td>{x.publishedRevisionId ? 'منتشرشده' : 'پیش‌نویس / لغو انتشار'}</td>
              <td>{x.isDemo ? 'نمونهٔ توسعه' : '—'}</td>
              <td>
                {' '}
                <button
                  key={x.id}
                  disabled={busy || uploadBusy || unresolved}
                  onClick={() => {
                    setSelected(x.id);
                    setCreating(false);
                    setBefore(null);
                    setReview(null);
                  }}
                >
                  {x.slug} · {x.publishedRevisionId ? 'منتشر' : 'پیش‌نویس / لغو انتشار'}
                  {x.isDemo ? ' · نمونه' : ''}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </AdminTable>
      {list.data?.items.length === 0 && <p>هنوز مقاله‌ای ساخته نشده است.</p>}
      {cursor && (
        <button disabled={busy || uploadBusy || unresolved} onClick={() => setCursor(null)}>
          ابتدای فهرست مقاله‌ها
        </button>
      )}
      {list.data?.nextCursor && (
        <button
          disabled={busy || uploadBusy || unresolved}
          onClick={() => setCursor(list.data!.nextCursor)}
        >
          ۵۰ مقالهٔ بعدی
        </button>
      )}
      {creating ? (
        <BlogEditor
          key="new"
          writable={writable && !busy && !unresolved}
          onUploadBusy={setUploadBusy}
          onSave={(input) => void send({ id: uuid(), postId: null, input, previous: null })}
        />
      ) : (
        p &&
        p.id === selected && (
          <>
            <p>
              <bdi>/fa/blog/{p.slug}</bdi> · <bdi>/en/blog/{p.slug}</bdi>
            </p>
            <BlogEditor
              key={p.id + ':' + p.version}
              detail={p}
              writable={writable && !busy && !unresolved}
              onUploadBusy={setUploadBusy}
              onSave={(input) => void send({ id: uuid(), postId: p.id, input, previous: p })}
            />
            <div className="row-buttons">
              <button disabled={disabled} onClick={() => publication('Publish', p)}>
                بازبینی انتشار مقاله
              </button>
              <button
                disabled={disabled || !p.published}
                onClick={() => publication('Unpublish', p)}
              >
                بازبینی لغو انتشار مقاله
              </button>
              <button disabled={busy || uploadBusy || unresolved} onClick={() => void refresh()}>
                بازخوانی مقاله از سرور
              </button>
            </div>
            <h3>تاریخچهٔ انتشار مقاله</h3>
            {history.data?.items.map((r) => (
              <div className="row-buttons" key={r.id}>
                <span>
                  نسخهٔ {r.publication.toLocaleString('fa-IR')} · {r.action}
                </span>
                {r.action !== 'Unpublish' && (
                  <button disabled={disabled} onClick={() => void restore(r.id)}>
                    بازبینی بازگردانی مقالهٔ نسخهٔ {r.publication.toLocaleString('fa-IR')}
                  </button>
                )}
              </div>
            ))}
            {history.data?.nextBefore && (
              <button
                disabled={busy || uploadBusy || unresolved}
                onClick={() => setBefore(history.data!.nextBefore)}
              >
                نسخه‌های قدیمی‌تر مقاله
              </button>
            )}
            {before && (
              <button disabled={busy || uploadBusy || unresolved} onClick={() => setBefore(null)}>
                تازه‌ترین نسخه‌های مقاله
              </button>
            )}
          </>
        )
      )}
      {review && (
        <Modal
          title={
            review.input.action === 'Unpublish'
              ? 'لغو نمایش عمومی مقاله'
              : review.input.action === 'Restore'
                ? 'انتشار نسخهٔ تاریخی مقاله'
                : 'انتشار مقاله در هر دو زبان'
          }
          preventClose={busy || uploadBusy || unresolved}
          onClose={() => setReview(null)}
        >
          <p>
            فقط نسخهٔ ذخیره‌شدهٔ سرور بررسی می‌شود. بازگردانی پیش‌نویس فعلی و تاریخ اولین انتشار را
            تغییر نمی‌دهد؛ لغو انتشار، مقاله را از هر دو زبان و فهرست عمومی برمی‌دارد.
          </p>
          <div className="row-buttons">
            <button onClick={() => setLocale('fa')}>پیش‌نمایش فارسی مقاله</button>
            <button onClick={() => setLocale('en')}>English article preview</button>
          </div>
          <BlogPreview content={review.content} locale={locale} isDemo={review.previous.isDemo} />
          <Check
            label="نویسندهٔ عمومی، محتوای دو زبان و اثر این عملیات مقاله را بازبینی کردم"
            checked={review.input.confirmed === true}
            onChange={(e) =>
              setReview({ ...review, input: { ...review.input, confirmed: e.target.checked } })
            }
          />
          <button
            disabled={disabled || review.input.confirmed !== true}
            onClick={() =>
              void send({
                id: uuid(),
                postId: review.previous.id,
                input: review.input,
                previous: review.previous,
              })
            }
          >
            تأیید عملیات مقاله
          </button>
        </Modal>
      )}
    </section>
  );
}
function BlogEditor({
  detail,
  writable,
  onSave,
  onUploadBusy,
}: {
  detail?: CmsBlogPostDetail;
  writable: boolean;
  onSave: (input: CmsBlogPostInput) => void;
  onUploadBusy: (busy: boolean) => void;
}) {
  const original = detail?.draft ?? emptyCmsBlogContent(),
    [metadata, setMetadata] = useState(() => structuredClone(original)),
    [error, setError] = useState<unknown>();
  const uploads = useCmsImageUploads(onUploadBusy);
  const patch = (x: Partial<CmsBlogContent>) => setMetadata((m) => ({ ...m, ...x })),
    dirty =
      JSON.stringify({ ...metadata, body: null }) !== JSON.stringify({ ...original, body: null });
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const bodyDetail: CmsPageDetail | undefined = detail
    ? {
        id: detail.id,
        slug: detail.slug,
        isDemo: detail.isDemo,
        version: detail.version,
        publication: detail.publication,
        publishedRevisionId: detail.publishedRevisionId,
        draft: detail.draft.body,
        published: detail.published?.body ?? null,
      }
    : undefined;
  function save(input: CmsPageInput) {
    if (!writable || uploads.isBusy()) return;
    setError(undefined);
    try {
      const content = cmsBlogContentSchema.parse({
        ...metadata,
        body: input.content,
        tags: [...metadata.tags].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)),
      });
      onSave({ ...input, content });
    } catch {
      setError(
        Error(
          'نوع و نام عمومی نویسنده، تصویر و متن جایگزین و برچسب‌های متمایز هر دو زبان را بررسی کنید.',
        ),
      );
    }
  }
  return (
    <div className="blog-editor">
      <ErrorBox error={error} />
      <fieldset disabled={!writable || uploads.busy}>
        <legend>اطلاعات عمومی مقاله</legend>
        <p role="status">
          {dirty
            ? 'اطلاعات عمومی مقاله تغییر ذخیره‌نشده دارد.'
            : 'اطلاعات عمومی با پیش‌نویس ذخیره‌شده برابر است.'}
        </p>
        <p>این نام‌ها با انتشار عمومی دیده می‌شوند؛ اطلاعات خصوصی حساب نویسنده خوانده نمی‌شود.</p>
        <Field label="نوع نویسندهٔ عمومی">
          <select
            value={metadata.authorKind ?? ''}
            onChange={(e) =>
              patch({
                authorKind: (e.target.value || null) as CmsBlogContent['authorKind'],
                ...(!e.target.value ? { bylineFa: '', bylineEn: '' } : {}),
              })
            }
          >
            <option value="">هنوز تعیین نشده</option>
            <option value="Person">شخص</option>
            <option value="Organization">سازمان یا تیم</option>
          </select>
        </Field>
        <Field label="نام عمومی نویسنده — فارسی">
          <input
            disabled={metadata.authorKind === null}
            maxLength={120}
            value={metadata.bylineFa}
            onChange={(e) => patch({ bylineFa: e.target.value })}
          />
        </Field>
        <Field label="Public author name — English">
          <input
            disabled={metadata.authorKind === null}
            dir="ltr"
            maxLength={120}
            value={metadata.bylineEn}
            onChange={(e) => patch({ bylineEn: e.target.value })}
          />
        </Field>
        <ImageEditor
          label="تصویر جلد عمومی مقاله — اختیاری"
          max={1}
          allowExternal={false}
          disabled={!writable}
          value={metadata.cover ? [metadata.cover] : []}
          onBusy={(busy) => uploads.setBusy('cover', busy)}
          onChange={(urls) =>
            setMetadata((current) => ({
              ...current,
              cover: urls[0] ?? null,
              ...(!urls.length ? { coverAltFa: null, coverAltEn: null } : {}),
            }))
          }
        />
        {metadata.cover && (
          <>
            <Field label="متن جایگزین جلد — فارسی">
              <input
                value={metadata.coverAltFa ?? ''}
                maxLength={240}
                onChange={(e) => patch({ coverAltFa: e.target.value })}
              />
            </Field>
            <Field label="Cover alt text — English">
              <input
                dir="ltr"
                value={metadata.coverAltEn ?? ''}
                maxLength={240}
                onChange={(e) => patch({ coverAltEn: e.target.value })}
              />
            </Field>
          </>
        )}
        <h4>برچسب‌های مقاله — حداکثر ۸</h4>
        {metadata.tags.map((t, i) => (
          <div className="form-grid" key={i}>
            <Field label={`نشانی برچسب ${i + 1}`}>
              <input
                dir="ltr"
                value={t.slug}
                maxLength={80}
                onChange={(e) =>
                  patch({
                    tags: metadata.tags.map((x, n) =>
                      n === i ? { ...x, slug: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`نام فارسی برچسب ${i + 1}`}>
              <input
                value={t.nameFa}
                maxLength={60}
                onChange={(e) =>
                  patch({
                    tags: metadata.tags.map((x, n) =>
                      n === i ? { ...x, nameFa: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`English tag name ${i + 1}`}>
              <input
                dir="ltr"
                value={t.nameEn}
                maxLength={60}
                onChange={(e) =>
                  patch({
                    tags: metadata.tags.map((x, n) =>
                      n === i ? { ...x, nameEn: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <button
              type="button"
              onClick={() => patch({ tags: metadata.tags.filter((_, n) => n !== i) })}
            >
              حذف برچسب {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={metadata.tags.length >= 8}
          onClick={() => patch({ tags: [...metadata.tags, { slug: '', nameFa: '', nameEn: '' }] })}
        >
          افزودن برچسب مقاله
        </button>
      </fieldset>
      {uploads.busy && (
        <p role="status">آماده‌سازی تصویر در جریان است؛ تا پایان آن ذخیرهٔ مقاله ممکن نیست.</p>
      )}
      <PageEditor
        entityLabel="مقاله"
        detail={bodyDetail}
        writable={writable && !uploads.busy}
        onUploadBusy={(busy) => uploads.setBusy('body', busy)}
        onSave={save}
      />
    </div>
  );
}
