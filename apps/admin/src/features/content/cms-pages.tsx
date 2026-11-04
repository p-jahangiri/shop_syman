import { ImageEditor } from '../media/media';
import { cmsPagePreview } from './cms-image-model';
import { useCmsImageUploads } from './cms-image-uploads';
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
import { adminCmsPageJournal as journal } from '../../state/content/admin-cms-page-journal';
import {
  cmsPageCommandPath,
  cmsPageContentSchema,
  cmsPageDetailSchema,
  cmsPageHistorySchema,
  cmsPageListSchema,
  cmsPageRevisionSchema,
  emptyCmsPageContent,
  publishedCmsPageContent,
  type CmsPageBlock,
  type CmsPageCommand,
  type CmsPageContent,
  type CmsPageDetail,
  type CmsPageInput,
} from '@sayman/web-shared/lib/content/cms-page-contract.ts';
import { CmsPageView } from '@sayman/web-shared/components/content/cms-page-view';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import '@sayman/web-shared/components/content/cms-page.css';
const uuid = () => crypto.randomUUID().replaceAll('-', '');
const storefrontOrigin = (import.meta.env.VITE_STOREFRONT_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const blockLabels = { Text: 'متن', Callout: 'نکتهٔ برجسته', Image: 'تصویر', Links: 'پیوندها' };
export function CmsPageCommandGuard({
  viewerId,
  onOpen,
}: {
  viewerId: string;
  onOpen: () => void;
}) {
  const e = useSyncExternalStore(journal.subscribe, () => journal.snapshot(viewerId)),
    unresolved = e?.state === 'pending' || e?.state === 'unknown';
  useEffect(() => {
    if (!unresolved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);
  return unresolved ? (
    <div className="notice" role="status">
      {e.state === 'pending'
        ? 'فرمان صفحه در حال ثبت است.'
        : 'نتیجهٔ فرمان صفحه نامعلوم است؛ همان شناسه را پیگیری کنید.'}
      <button type="button" onClick={onOpen}>
        باز کردن صفحه‌های محتوایی
      </button>
    </div>
  ) : null;
}
function PagePreview({
  content,
  locale,
  isDemo,
}: {
  content: CmsPageContent;
  locale: 'fa' | 'en';
  isDemo: boolean;
}) {
  return (
    <CmsPageView
      content={cmsPagePreview(content[locale])}
      locale={locale}
      isDemo={isDemo}
      link={(href, label) => (
        <a href={storefrontOrigin + '/' + locale + href} target="_blank" rel="noreferrer">
          {label}
        </a>
      )}
    />
  );
}
export function CmsPages({
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
      input: CmsPageInput;
      content: CmsPageContent;
      isDemo: boolean;
      pageId: string;
    } | null>(null),
    [reviewLocale, setReviewLocale] = useState<'fa' | 'en'>('fa');
  const entry = useSyncExternalStore(journal.subscribe, () => journal.snapshot(viewerId)),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => () => journal.interrupt(), []);
  function check<T>(value: T) {
    if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرد.');
    return value;
  }
  const list = useQuery({
    queryKey: ['admin', 'cms-pages', viewerId, cursor],
    queryFn: async ({ signal }) =>
      check(
        cmsPageListSchema.parse(
          await api('/admin/pages' + (cursor ? '?cursor=' + cursor : ''), { signal }),
        ),
      ),
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: ['admin', 'cms-page', viewerId, selected],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const d = check(cmsPageDetailSchema.parse(await api('/admin/pages/' + selected, { signal })));
      if (d.id !== selected) throw Error('پاسخ مربوط به صفحهٔ انتخاب‌شده نیست.');
      return d;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'cms-page-history', viewerId, selected, before],
    enabled: !!selected,
    queryFn: async ({ signal }) =>
      check(
        cmsPageHistorySchema.parse(
          await api(
            `/admin/pages/${selected}/history${before ? '?beforePublication=' + before : ''}`,
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
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin', 'cms-pages'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cms-page'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cms-page-history'] }),
    ]);
  }
  async function send(command: CmsPageCommand, retry = false) {
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
      const raw = await api(cmsPageCommandPath(command), {
        method: 'POST',
        body: JSON.stringify(command.input),
      });
      if (journal.finish(viewerId, command, raw)) {
        setReview(null);
        setBefore(null);
        await refresh(journal.snapshot(viewerId)?.result?.pageId);
      }
    } catch (e) {
      setReview(null);
      journal.fail(
        viewerId,
        command,
        e instanceof ApiError ? e.status : 0,
        e instanceof ApiError ? e.code : 'unknown',
      );
      setError(e);
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
      const raw = await api(cmsPageCommandPath(entry.command));
      if (journal.finish(viewerId, entry.command, raw)) {
        setReview(null);
        setBefore(null);
        await refresh(journal.snapshot(viewerId)?.result?.pageId);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function restore(id: string) {
    if (!publishable || editor.dirty || !detail.data || busy || uploadBusy || unresolved) return;
    setBusy(true);
    setError(undefined);
    try {
      const d = detail.data;
      const r = check(
        cmsPageRevisionSchema.parse(await api(`/admin/pages/${detail.data.id}/revisions/${id}`)),
      );
      if (
        r.pageId !== d.id ||
        r.slug !== d.slug ||
        r.isDemo !== d.isDemo ||
        r.revision.id !== id ||
        r.revision.action === 'Unpublish'
      )
        throw Error('نسخهٔ دریافتی با صفحهٔ انتخاب‌شده یکسان نیست.');
      setReview({
        input: {
          action: 'Restore',
          version: detail.data.version,
          restoreRevisionId: id,
          confirmed: false,
        },
        content: r.content,
        isDemo: r.isDemo,
        pageId: d.id,
      });
      setReviewLocale('fa');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function publication(action: 'Publish' | 'Unpublish', d: CmsPageDetail) {
    if (!publishable || editor.dirty || busy || uploadBusy || unresolved) return;
    setError(undefined);
    try {
      const content = action === 'Publish' ? publishedCmsPageContent(d.draft) : d.published;
      if (!content) throw Error('صفحه منتشر نشده است.');
      setReview({
        input: { action, version: d.version, confirmed: false },
        content,
        isDemo: d.isDemo,
        pageId: d.id,
      });
      setReviewLocale('fa');
    } catch {
      setError(Error('پیش از انتشار، عنوان و حداقل یک بلوک معتبر در هر دو زبان را ذخیره کنید.'));
    }
  }
  const blocked = busy || uploadBusy || unresolved;
  const mayRecover = !!entry && canRunCmsCommand(entry.command.input.action, writable, publishable);
  const d = detail.data?.id === selected ? detail.data : undefined;
  const ready = !!d && cmsLanguageReady(d.draft.fa) && cmsLanguageReady(d.draft.en);
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
          <h2>صفحه‌های محتوایی</h2>
          <p>صفحه‌های دوزبانه با پیش‌نویس مستقل، بلوک مصوب و تاریخچهٔ انتشار.</p>
        </div>
        <button
          type="button"
          disabled={!writable || blocked || creating}
          className="primary"
          onClick={() => open(null, true)}
        >
          صفحهٔ تازه
        </button>
      </div>
      <ErrorBox error={error ?? list.error ?? detail.error ?? history.error} />
      {entry && (
        <div className="notice" role="status">
          <p>
            {entry.state === 'done'
              ? 'فرمان ثبت شد.'
              : entry.state === 'rejected'
                ? 'فرمان رد شد؛ تغییری با این نتیجه تأیید نشده است.'
                : entry.state === 'pending'
                  ? 'در حال ثبت؛ این صفحه را نبندید.'
                  : 'نتیجه نامعلوم است؛ پیش از فرمان تازه، رسید همان تلاش را بخوانید.'}
          </p>
          <code dir="ltr">{entry.command.id}</code>
          {entry.state === 'unknown' && (
            <div className="row-buttons">
              <button disabled={busy || uploadBusy || !mayRecover} onClick={() => void receipt()}>
                پیگیری رسید همان فرمان
              </button>
              <button
                disabled={busy || uploadBusy || !mayRecover}
                onClick={() => void send(entry.command, true)}
              >
                ارسال مجدد همان فرمان
              </button>
            </div>
          )}
          {['done', 'rejected'].includes(entry.state) && (
            <button onClick={() => journal.clear(viewerId)}>بستن پیام فرمان</button>
          )}
          <small>شناسه فقط در حافظهٔ همین نشست است؛ بازخوانی کامل صفحه آن را پاک می‌کند.</small>
        </div>
      )}
      <CmsContentList
        rows={list.data?.items}
        loading={list.isLoading}
        kind="صفحه"
        selected={selected}
        blocked={blocked}
        onSelect={open}
      />
      <div className="row-buttons">
        {cursor && (
          <button disabled={unresolved || busy || uploadBusy} onClick={() => setCursor(null)}>
            ابتدای فهرست
          </button>
        )}
        {list.data?.nextCursor && (
          <button
            disabled={unresolved || busy || uploadBusy}
            onClick={() => setCursor(list.data!.nextCursor)}
          >
            صفحهٔ بعد فهرست
          </button>
        )}
      </div>
      {(creating || selected) && (
        <CmsEditorHeading
          key={selected ?? 'new'}
          label={creating ? 'صفحهٔ تازه' : 'میز ویرایش صفحه'}
          blocked={blocked}
          onClose={() => open(null)}
        />
      )}
      {creating ? (
        <PageEditor
          key={`new:${editor.epoch}`}
          writable={writable && !unresolved && !busy}
          onUploadBusy={setUploadBusy}
          onDirty={editor.setDirty}
          onSave={(input) => void send({ id: uuid(), pageId: null, input })}
        />
      ) : selected && detail.isPending ? (
        <Busy />
      ) : d ? (
        <>
          <CmsPublicationSummary
            draft={d.draft}
            dirty={editor.dirty}
            publishable={publishable}
            publication={d.publication}
            publishedRevisionId={d.publishedRevisionId}
            publishedLinks={{
              fa: `${storefrontOrigin}/fa/pages/${d.slug}`,
              en: `${storefrontOrigin}/en/pages/${d.slug}`,
            }}
          />
          <div className="row-buttons">
            {publishable && (
              <>
                <button
                  className="primary"
                  disabled={blocked || editor.dirty || !ready}
                  onClick={() => publication('Publish', d)}
                >
                  بازبینی و انتشار پیش‌نویس ذخیره‌شده
                </button>
                <button
                  disabled={blocked || editor.dirty || !d.publishedRevisionId}
                  onClick={() => publication('Unpublish', d)}
                >
                  بازبینی لغو انتشار
                </button>
              </>
            )}
            <button
              disabled={blocked || detail.isFetching}
              onClick={() => editor.navigate(() => void refresh())}
            >
              بازخوانی از سرور
            </button>
          </div>
          <PageEditor
            key={`${d.id}:${d.version}:${editor.epoch}`}
            detail={d}
            writable={writable && !unresolved && !busy}
            onUploadBusy={setUploadBusy}
            onDirty={editor.setDirty}
            onSave={(input) => void send({ id: uuid(), pageId: d.id, input })}
          />
          <details className="cms-editor-history">
            <summary>تاریخچهٔ انتشار</summary>
            {history.isLoading && <Busy />}
            {history.data?.items.length === 0 && <p>برای این صفحه سابقهٔ انتشار ثبت نشده است.</p>}
            {history.data?.items.map((r) => (
              <div className="row-buttons" key={r.id}>
                <span>
                  نسخهٔ {r.publication.toLocaleString('fa-IR')} ·{' '}
                  {r.action === 'Unpublish'
                    ? 'لغو انتشار'
                    : r.action === 'Restore'
                      ? 'بازگردانی'
                      : 'انتشار'}{' '}
                  · <time dateTime={r.at}>{formatCmsWorkspaceDate(r.at)}</time>
                </span>
                {publishable && r.action !== 'Unpublish' && (
                  <button disabled={blocked || editor.dirty} onClick={() => void restore(r.id)}>
                    پیش‌نمایش و بازگردانی نسخهٔ {r.publication.toLocaleString('fa-IR')}
                  </button>
                )}
              </div>
            ))}
            <div className="row-buttons">
              {before && (
                <button disabled={blocked} onClick={() => setBefore(null)}>
                  جدیدترین نسخه‌ها
                </button>
              )}
              {history.data?.nextBefore && (
                <button disabled={blocked} onClick={() => setBefore(history.data!.nextBefore)}>
                  نسخه‌های قدیمی‌تر
                </button>
              )}
            </div>
          </details>
        </>
      ) : null}
      {editor.nextAction && <CmsDiscardDialog discard={editor.discard} cancel={editor.cancel} />}
      {review && publishable && (
        <Modal
          title={
            review.input.action === 'Unpublish'
              ? 'لغو نمایش عمومی صفحه'
              : review.input.action === 'Restore'
                ? 'بازگردانی با انتشار نسخهٔ تازه'
                : 'انتشار دو زبان صفحه'
          }
          preventClose={busy || uploadBusy || unresolved}
          onClose={() => setReview(null)}
        >
          <p>
            {review.input.action === 'Unpublish'
              ? 'این محتوا از هر دو نشانی عمومی برداشته می‌شود؛ پیش‌نویس و سابقه حفظ می‌شوند.'
              : review.input.action === 'Restore'
                ? 'محتوای نسخهٔ تاریخی انتخاب‌شده در هر دو زبان منتشر می‌شود و پیش‌نویس فعلی حفظ می‌شود.'
                : 'پیش‌نویس ذخیره‌شدهٔ زیر در هر دو زبان منتشر می‌شود.'}
          </p>
          <div className="row-buttons">
            <button
              type="button"
              aria-pressed={reviewLocale === 'fa'}
              onClick={() => setReviewLocale('fa')}
            >
              پیش‌نمایش فارسی
            </button>
            <button
              type="button"
              aria-pressed={reviewLocale === 'en'}
              onClick={() => setReviewLocale('en')}
            >
              English preview
            </button>
          </div>
          <PagePreview content={review.content} locale={reviewLocale} isDemo={review.isDemo} />
          <Check
            label="محتوا و اثر این عملیات را بازبینی کردم"
            checked={review.input.confirmed === true}
            onChange={(e) =>
              setReview({ ...review, input: { ...review.input, confirmed: e.target.checked } })
            }
          />
          <button
            disabled={blocked || editor.dirty || !review.input.confirmed}
            onClick={() => void send({ id: uuid(), pageId: review.pageId, input: review.input })}
          >
            تأیید عملیات صفحه
          </button>
        </Modal>
      )}
    </section>
  );
}
export function PageEditor({
  detail,
  writable,
  onSave,
  entityLabel = 'صفحه',
  onUploadBusy,
  onDirty,
}: {
  detail?: CmsPageDetail;
  writable: boolean;
  onSave: (input: CmsPageInput) => void;
  entityLabel?: string;
  onUploadBusy?: (busy: boolean) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState(() =>
      structuredClone(detail?.draft ?? emptyCmsPageContent()),
    ),
    [slug, setSlug] = useState(''),
    [demo, setDemo] = useState(false),
    [locale, setLocale] = useState<'fa' | 'en'>('fa'),
    [preview, setPreview] = useState(false),
    [error, setError] = useState<unknown>();
  const uploads = useCmsImageUploads(onUploadBusy);
  const lang = content[locale],
    dirty =
      JSON.stringify(content) !== JSON.stringify(detail?.draft ?? emptyCmsPageContent()) ||
      (!detail && (!!slug || demo));
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (patch: Partial<typeof lang>) =>
      setContent({ ...content, [locale]: { ...lang, ...patch } }),
    blocks = (value: CmsPageBlock[]) => update({ blocks: value });
  function add(kind: CmsPageBlock['kind']) {
    const base = { id: uuid(), visibility: 'All' as const };
    blocks([
      ...lang.blocks,
      kind === 'Image'
        ? { ...base, kind, image: '', alt: '' }
        : kind === 'Links'
          ? { ...base, kind, heading: '', links: [{ label: '', href: '/catalog' }] }
          : { ...base, kind, heading: '', text: '' },
    ]);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!writable || uploads.isBusy()) return;
    setError(undefined);
    const parsed = cmsPageContentSchema.safeParse(content);
    if (!parsed.success) {
      setError(
        Error(
          'عنوان‌ها، متن و نوع بلوک‌ها، تصویر و پیوندهای داخلی را بررسی کنید؛ هر زبان حداکثر۲۰بلوک دارد.',
        ),
      );
      return;
    }
    onSave(
      detail
        ? { action: 'Save', version: detail.version, content: parsed.data }
        : { action: 'Create', slug, isDemo: demo, content: parsed.data },
    );
  }
  return (
    <form className="cms-page-editor" onSubmit={save}>
      <h3>{detail ? 'ویرایش پیش‌نویس' : 'ایجاد ' + entityLabel}</h3>
      <p role="status">
        {dirty ? 'تغییر ذخیره‌نشده دارید.' : 'فرم با پیش‌نویس ذخیره‌شده برابر است.'} ذخیرهٔ فرم،
        پیش‌نویس هر دو زبان را به‌روز می‌کند.
      </p>
      <ErrorBox error={error} />
      {uploads.busy && (
        <p role="status">آماده‌سازی تصویر در جریان است؛ پس از پایان، پیش‌نویس را ذخیره کنید.</p>
      )}
      {!detail && (
        <fieldset disabled={!writable || uploads.busy}>
          <Field
            label={`نشانی ثابت ${entityLabel}`}
            hint="از حروف کوچک انگلیسی، عدد و خط تیره استفاده کنید. نشانی بعد از ایجاد ثابت است."
          >
            <input
              dir="ltr"
              required
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </Field>
          <Check
            label="محتوای نمونهٔ توسعه؛ در Production مخفی باشد"
            checked={demo}
            onChange={(e) => setDemo(e.target.checked)}
          />
        </fieldset>
      )}
      <div className="row-buttons">
        <button
          type="button"
          disabled={uploads.busy}
          aria-pressed={locale === 'fa'}
          onClick={() => setLocale('fa')}
        >
          فارسی
        </button>
        <button
          type="button"
          disabled={uploads.busy}
          aria-pressed={locale === 'en'}
          onClick={() => setLocale('en')}
        >
          English
        </button>
        <button type="button" onClick={() => setPreview(!preview)}>
          {preview ? 'بستن پیش‌نمایش فرم' : 'پیش‌نمایش تغییرهای فرم'}
        </button>
      </div>
      {preview && <PagePreview content={content} locale={locale} isDemo={detail?.isDemo ?? demo} />}
      <fieldset disabled={!writable || uploads.busy} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <Field
          label={locale === 'fa' ? 'عنوان فارسی' : 'English title'}
          hint={
            locale === 'fa'
              ? 'برای انتشار، هر دو زبان به عنوان و حداقل یک بلوک نیاز دارند.'
              : 'Both languages need a title and at least one block to publish.'
          }
        >
          <input
            maxLength={200}
            value={lang.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </Field>
        <Field
          label={locale === 'fa' ? 'توضیح و خلاصهٔ جست‌وجو' : 'Description and search summary'}
          hint={
            locale === 'fa'
              ? 'اختیاری. در یک یا دو جمله بگویید مخاطب در این محتوا چه پیدا می‌کند.'
              : 'Optional. Summarize what the reader will find.'
          }
        >
          <textarea
            maxLength={400}
            value={lang.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </Field>
        {lang.blocks.map((b, index) => {
          const change = (patch: Partial<CmsPageBlock>) =>
            blocks(
              lang.blocks.map((x, i) => (i === index ? ({ ...x, ...patch } as CmsPageBlock) : x)),
            );
          return (
            <fieldset className="cms-content-block" key={b.id}>
              <legend>
                {index + 1} · {blockLabels[b.kind]}
              </legend>
              <Field label="نمایش در">
                <select
                  value={b.visibility}
                  onChange={(e) =>
                    change({ visibility: e.target.value as CmsPageBlock['visibility'] })
                  }
                >
                  <option value="All">همهٔ دستگاه‌ها</option>
                  <option value="Mobile">فقط موبایل</option>
                  <option value="Desktop">فقط دسکتاپ</option>
                </select>
              </Field>
              {b.kind !== 'Image' && (
                <Field label="عنوان بلوک">
                  <input
                    maxLength={240}
                    value={b.heading}
                    onChange={(e) => change({ heading: e.target.value })}
                  />
                </Field>
              )}
              {b.kind === 'Text' || b.kind === 'Callout' ? (
                <Field label="متن سادهٔ بلوک">
                  <textarea
                    rows={5}
                    maxLength={8000}
                    value={b.text}
                    onChange={(e) => change({ text: e.target.value.replace(/\r\n?/g, '\n') })}
                  />
                </Field>
              ) : b.kind === 'Image' ? (
                <>
                  <ImageEditor
                    label="تصویر عمومی بلوک"
                    max={1}
                    allowExternal={false}
                    disabled={!writable}
                    value={b.image ? [b.image] : []}
                    onBusy={(busy) => uploads.setBusy(locale + ':' + b.id, busy)}
                    onChange={(urls) =>
                      setContent((current) => ({
                        ...current,
                        [locale]: {
                          ...current[locale],
                          blocks: current[locale].blocks.map((block) =>
                            block.id === b.id && block.kind === 'Image'
                              ? { ...block, image: urls[0] ?? '' }
                              : block,
                          ),
                        },
                      }))
                    }
                  />
                  <Field label="توضیح جایگزین تصویر">
                    <input
                      maxLength={240}
                      value={b.alt}
                      onChange={(e) => change({ alt: e.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <>
                  {b.links.map((item, i) => (
                    <div className="form-grid" key={i}>
                      <Field label={`عنوان پیوند ${i + 1}`}>
                        <input
                          value={item.label}
                          maxLength={150}
                          onChange={(e) =>
                            change({
                              links: b.links.map((x, n) =>
                                n === i ? { ...x, label: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field
                        label={`مسیر داخلی پیوند ${i + 1}`}
                        hint="مثال /catalog یا /pages/buying-guide. زبان بر اساس نسخهٔ صفحه اضافه می‌شود."
                      >
                        <input
                          dir="ltr"
                          value={item.href}
                          maxLength={1500}
                          onChange={(e) =>
                            change({
                              links: b.links.map((x, n) =>
                                n === i ? { ...x, href: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </Field>
                      <button
                        type="button"
                        disabled={b.links.length === 1}
                        onClick={() => change({ links: b.links.filter((_, n) => n !== i) })}
                      >
                        حذف پیوند {i + 1}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={b.links.length >= 12}
                    onClick={() => change({ links: [...b.links, { label: '', href: '/catalog' }] })}
                  >
                    افزودن پیوند
                  </button>
                </>
              )}
              <div className="row-buttons">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => {
                    const a = [...lang.blocks];
                    [a[index - 1], a[index]] = [a[index], a[index - 1]];
                    blocks(a);
                  }}
                >
                  بالا
                </button>
                <button
                  type="button"
                  disabled={index === lang.blocks.length - 1}
                  onClick={() => {
                    const a = [...lang.blocks];
                    [a[index + 1], a[index]] = [a[index], a[index + 1]];
                    blocks(a);
                  }}
                >
                  پایین
                </button>
                <button
                  type="button"
                  onClick={() => blocks(lang.blocks.filter((_, i) => i !== index))}
                >
                  حذف بلوک {index + 1}
                </button>
              </div>
            </fieldset>
          );
        })}
        {lang.blocks.length === 0 && (
          <p className="notice">برای شروع یک بلوک متن، نکته، تصویر یا پیوند اضافه کنید.</p>
        )}
        <div className="row-buttons">
          {(['Text', 'Callout', 'Image', 'Links'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={lang.blocks.length >= 20}
              onClick={() => add(kind)}
            >
              افزودن {blockLabels[kind]}
            </button>
          ))}
        </div>
        <button type="submit" className="primary">
          {detail ? 'ذخیرهٔ پیش‌نویس دو زبان' : 'ایجاد پیش‌نویس دو زبان'}
        </button>
      </fieldset>
    </form>
  );
}
