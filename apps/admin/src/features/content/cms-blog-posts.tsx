import { ImageEditor } from '../media/media';
import { cmsImagePreview, cmsPagePreview } from './cms-image-model';
import { useCmsImageUploads } from './cms-image-uploads';
import '@sayman/web-shared/components/content/blog.css';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { canRunCmsCommand, cmsLanguageReady } from './cms-editor-model';
import {
  CmsContentList,
  CmsDiscardDialog,
  CmsEditorHeading,
  CmsPublicationSummary,
  formatCmsWorkspaceDate,
  useCmsEditorNavigation,
} from './cms-editor-workspace';
import { adminCmsBlogPostJournal as journal } from '../../state/content/admin-cms-blog-post-journal';
import { PageEditor } from './cms-pages';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { CmsPageView } from '@sayman/web-shared/components/content/cms-page-view';
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
} from '@sayman/web-shared/lib/content/cms-blog-post-contract.ts';
import type {
  CmsPageDetail,
  CmsPageInput,
} from '@sayman/web-shared/lib/content/cms-page-contract.ts';
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
export function CmsBlogPosts({
  viewerId,
  writable,
  publishable = writable,
}: {
  viewerId: string;
  writable: boolean;
  publishable?: boolean;
}) {
  const editor = useCmsEditorNavigation();
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
    refetchOnReconnect: false,
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
    if (
      !canRunCmsCommand(command.input.action, writable, publishable) ||
      busy ||
      uploadBusy ||
      authority !== adminViewRevision()
    )
      return;
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
    if (
      !entry ||
      !canRunCmsCommand(entry.command.input.action, writable, publishable) ||
      busy ||
      uploadBusy ||
      authority !== adminViewRevision()
    )
      return;
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
    if (!publishable || editor.dirty || busy || uploadBusy || unresolved) return;
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
    if (!publishable || editor.dirty || !detail.data || busy || uploadBusy || unresolved) return;
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
  const p = detail.data?.id === selected ? detail.data : undefined;
  const blocked = busy || uploadBusy || unresolved;
  const mayRecover = !!entry && canRunCmsCommand(entry.command.input.action, writable, publishable);
  const authorReady = !!p?.draft.authorKind && !!p.draft.bylineFa && !!p.draft.bylineEn;
  const ready =
    !!p && authorReady && cmsLanguageReady(p.draft.body.fa) && cmsLanguageReady(p.draft.body.en);
  const publicationDisabled = blocked || editor.dirty;
  function open(next: string | null, create = false) {
    editor.navigate(() => {
      setSelected(next);
      setCreating(create);
      setBefore(null);
      setReview(null);
      setError(undefined);
    });
  }
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
          type="button"
          disabled={blocked || !writable || creating}
          className="primary"
          onClick={() => open(null, true)}
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
              <button disabled={busy || uploadBusy || !mayRecover} onClick={() => void receipt()}>
                بررسی رسید همان فرمان مقاله
              </button>
              <button
                disabled={busy || uploadBusy || !mayRecover}
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
      <CmsContentList
        rows={list.data?.items}
        loading={list.isLoading}
        kind="مقاله"
        selected={selected}
        blocked={blocked}
        onSelect={open}
      />
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
      {(creating || selected) && (
        <CmsEditorHeading
          key={selected ?? 'new'}
          label={creating ? 'مقالهٔ تازه' : 'میز ویرایش مقاله'}
          blocked={blocked}
          onClose={() => open(null)}
        />
      )}
      {creating ? (
        <BlogEditor
          key={`new:${editor.epoch}`}
          writable={writable && !busy && !unresolved}
          onUploadBusy={setUploadBusy}
          onDirty={editor.setDirty}
          onSave={(input) => void send({ id: uuid(), postId: null, input, previous: null })}
        />
      ) : selected && detail.isPending ? (
        <Busy />
      ) : p ? (
        <>
          <CmsPublicationSummary
            draft={p.draft.body}
            authorReady={authorReady}
            dirty={editor.dirty}
            publishable={publishable}
            publication={p.publication}
            publishedRevisionId={p.publishedRevisionId}
            publishedLinks={{
              fa: `${origin}/fa/blog/${p.slug}`,
              en: `${origin}/en/blog/${p.slug}`,
            }}
          />
          <div className="row-buttons">
            {publishable && (
              <>
                <button
                  className="primary"
                  disabled={publicationDisabled || !ready}
                  onClick={() => publication('Publish', p)}
                >
                  بازبینی انتشار مقاله
                </button>
                <button
                  disabled={publicationDisabled || !p.published}
                  onClick={() => publication('Unpublish', p)}
                >
                  بازبینی لغو انتشار مقاله
                </button>
              </>
            )}
            <button
              disabled={blocked || detail.isFetching}
              onClick={() => editor.navigate(() => void refresh())}
            >
              بازخوانی مقاله از سرور
            </button>
          </div>
          <BlogEditor
            key={`${p.id}:${p.version}:${editor.epoch}`}
            detail={p}
            writable={writable && !busy && !unresolved}
            onUploadBusy={setUploadBusy}
            onDirty={editor.setDirty}
            onSave={(input) => void send({ id: uuid(), postId: p.id, input, previous: p })}
          />
          <details className="cms-editor-history">
            <summary>تاریخچهٔ انتشار مقاله</summary>
            {history.isLoading && <Busy />}
            {history.data?.items.length === 0 && <p>برای این مقاله سابقهٔ انتشار ثبت نشده است.</p>}
            {history.data?.items.map((r) => (
              <div className="row-buttons" key={r.id}>
                <span>
                  نسخهٔ {r.publication.toLocaleString('fa-IR')} ·{' '}
                  {r.action === 'Publish'
                    ? 'انتشار'
                    : r.action === 'Restore'
                      ? 'بازگردانی'
                      : 'لغو انتشار'}
                  {' · '}
                  <time dateTime={r.at}>{formatCmsWorkspaceDate(r.at)}</time>
                </span>
                {publishable && r.action !== 'Unpublish' && (
                  <button disabled={publicationDisabled} onClick={() => void restore(r.id)}>
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
          </details>
        </>
      ) : null}
      {editor.nextAction && <CmsDiscardDialog discard={editor.discard} cancel={editor.cancel} />}
      {review && publishable && (
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
            {review.input.action === 'Unpublish'
              ? 'مقاله از هر دو نشانی و فهرست عمومی برداشته می‌شود. پیش‌نویس و سابقه باقی می‌مانند.'
              : review.input.action === 'Restore'
                ? 'محتوای نسخهٔ انتخابی در هر دو زبان منتشر می‌شود. پیش‌نویس فعلی و تاریخ اولین انتشار حفظ می‌شوند.'
                : 'محتوای پیش‌نویس ذخیره‌شده در هر دو زبان منتشر می‌شود.'}
          </p>
          <div className="row-buttons">
            <button type="button" aria-pressed={locale === 'fa'} onClick={() => setLocale('fa')}>
              پیش‌نمایش فارسی مقاله
            </button>
            <button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>
              English article preview
            </button>
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
            disabled={publicationDisabled || review.input.confirmed !== true}
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
  onDirty,
}: {
  detail?: CmsBlogPostDetail;
  writable: boolean;
  onSave: (input: CmsBlogPostInput) => void;
  onUploadBusy: (busy: boolean) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const original = detail?.draft ?? emptyCmsBlogContent(),
    [metadata, setMetadata] = useState(() => structuredClone(original)),
    [bodyDirty, setBodyDirty] = useState(false),
    [error, setError] = useState<unknown>();
  const uploads = useCmsImageUploads(onUploadBusy);
  const patch = (x: Partial<CmsBlogContent>) => setMetadata((m) => ({ ...m, ...x })),
    dirty =
      JSON.stringify({ ...metadata, body: null }) !== JSON.stringify({ ...original, body: null });
  useEffect(() => onDirty(dirty || bodyDirty), [bodyDirty, dirty, onDirty]);
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
        onDirty={setBodyDirty}
        onSave={save}
      />
    </div>
  );
}
