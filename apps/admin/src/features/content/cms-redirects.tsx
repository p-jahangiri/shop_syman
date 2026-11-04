import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { adminCmsRedirectJournal as journal } from '../../state/content/admin-cms-redirect-journal';
import {
  redirectCommandPath,
  redirectDetailSchema,
  redirectHistorySchema,
  redirectInputSchema,
  redirectListSchema,
  redirectPreviewSchema,
  redirectRevisionSchema,
  validRedirectTarget,
  type RedirectCommand,
  type RedirectDetail,
  type RedirectInput,
  type RedirectPreview,
} from '@sayman/web-shared/lib/content/cms-redirect-contract.ts';
import { Check, ErrorBox, Field, Modal } from '../../components/ui';
const uuid = () => crypto.randomUUID().replaceAll('-', '');
export function CmsRedirectCommandGuard({
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
        ? 'فرمان انتقال نشانی در حال ثبت است.'
        : 'نتیجهٔ فرمان انتقال نامعلوم است؛ همان شناسه را پیگیری کنید.'}
      <button type="button" onClick={onOpen}>
        باز کردن مدیریت انتقال نشانی
      </button>
    </div>
  ) : null;
}
type Review = {
  input: RedirectInput;
  source: string;
  target: string;
  status: 301 | 302;
  isDemo: boolean;
  chain?: string[];
};
export function CmsRedirects({ viewerId, writable }: { viewerId: string; writable: boolean }) {
  const client = useQueryClient(),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [before, setBefore] = useState<number | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<Review | null>(null),
    [preview, setPreview] = useState<RedirectPreview | null>(null);
  const entry = useSyncExternalStore(journal.subscribe, () => journal.snapshot(viewerId)),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => () => journal.interrupt(), []);
  const list = useQuery({
    queryKey: ['admin', 'redirects', cursor],
    queryFn: async ({ signal }) =>
      redirectListSchema.parse(
        await api('/admin/redirects' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), {
          signal,
        }),
      ),
  });
  const detail = useQuery({
    queryKey: ['admin', 'redirect', selected],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const d = redirectDetailSchema.parse(await api('/admin/redirects/' + selected, { signal }));
      if (d.id !== selected) throw Error('Unrelated redirect');
      return d;
    },
  });
  const history = useQuery({
    queryKey: ['admin', 'redirect-history', selected, before],
    enabled: !!selected,
    queryFn: async ({ signal }) =>
      redirectHistorySchema.parse(
        await api(
          `/admin/redirects/${selected}/history${before ? '?beforePublication=' + before : ''}`,
          { signal },
        ),
      ),
  });
  async function refresh(id?: string) {
    setPreview(null);
    if (id) {
      setSelected(id);
      setCreating(false);
    }
    await Promise.all(
      ['redirects', 'redirect', 'redirect-history'].map((k) =>
        client.invalidateQueries({ queryKey: ['admin', k] }),
      ),
    );
  }
  async function send(command: RedirectCommand, retry = false) {
    if (!writable || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (retry) journal.retry(viewerId);
      else journal.begin(viewerId, command);
      const raw = await api(redirectCommandPath(command), {
        method: 'POST',
        body: JSON.stringify(command.input),
      });
      if (journal.finish(viewerId, command, raw)) {
        setReview(null);
        setBefore(null);
        await refresh(journal.snapshot(viewerId)?.result?.redirectId);
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
    if (!entry || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const raw = await api(redirectCommandPath(entry.command));
      if (journal.finish(viewerId, entry.command, raw)) {
        setReview(null);
        await refresh(journal.snapshot(viewerId)?.result?.redirectId);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function publication(action: 'Publish' | 'Unpublish', d: RedirectDetail) {
    if (busy || unresolved) return;
    setBusy(true);
    setError(undefined);
    try {
      if (action === 'Publish') {
        const p = redirectPreviewSchema.parse(await api(`/admin/redirects/${d.id}/preview`));
        if (p.redirectId !== d.id || p.version !== d.version || p.sourcePath !== d.sourcePath)
          throw Error('نسخهٔ انتقال تغییر کرده است؛ بازخوانی کنید.');
        setPreview(p);
        if (!p.canPublish || p.draft.targetPath === null || p.draft.status === null) return;
        setReview({
          input: { action, version: p.version, confirmed: false },
          source: p.sourcePath,
          target: p.draft.targetPath,
          status: p.draft.status,
          isDemo: p.isDemo,
          chain: p.chain,
        });
      } else {
        if (!d.published) throw Error('این انتقال منتشر نشده است.');
        setReview({
          input: { action, version: d.version, confirmed: false },
          source: d.sourcePath,
          target: d.published.targetPath,
          status: d.published.status,
          isDemo: d.isDemo,
        });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function restore(revisionId: string) {
    if (!detail.data || busy || unresolved) return;
    const d = detail.data;
    setBusy(true);
    setError(undefined);
    try {
      const r = redirectRevisionSchema.parse(
        await api(`/admin/redirects/${d.id}/revisions/${revisionId}`),
      );
      if (
        r.redirectId !== d.id ||
        r.sourcePath !== d.sourcePath ||
        r.revision.id !== revisionId ||
        r.revision.action === 'Unpublish'
      )
        throw Error('Invalid redirect revision');
      setReview({
        input: {
          action: 'Restore',
          version: d.version,
          restoreRevisionId: revisionId,
          confirmed: false,
        },
        source: r.sourcePath,
        target: r.revision.targetPath,
        status: r.revision.status,
        isDemo: r.isDemo,
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const disabled = !writable || busy || unresolved;
  return (
    <section className="panel cms-redirects-admin">
      <div className="section-heading">
        <div>
          <h2>انتقال نشانی‌های فروشگاه</h2>
          <p>
            انتقال دائمی ۳۰۱ یا موقت ۳۰۲ برای نشانی محصول و صفحه؛ پیش‌نویس با انتشار عمومی مستقل
            است.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setSelected(null);
            setCreating(true);
            setPreview(null);
            setReview(null);
          }}
        >
          انتقال تازه
        </button>
      </div>
      <ErrorBox error={error ?? list.error ?? detail.error ?? history.error} />
      {entry && (
        <div className="notice" role="status">
          <p>
            {entry.state === 'done'
              ? 'فرمان انتقال ثبت شد.'
              : entry.state === 'rejected'
                ? 'فرمان انتقال رد شد.'
                : entry.state === 'pending'
                  ? 'در حال ثبت؛ این صفحه را نبندید.'
                  : 'نتیجه نامعلوم است؛ رسید همین تلاش را پیش از فرمان تازه بخوانید.'}
          </p>
          <code dir="ltr">{entry.command.id}</code>
          {entry.state === 'unknown' && (
            <div className="row-buttons">
              <button disabled={busy || !writable} onClick={() => void receipt()}>
                پیگیری رسید همان انتقال
              </button>
              <button disabled={busy || !writable} onClick={() => void send(entry.command, true)}>
                ارسال مجدد همان انتقال
              </button>
            </div>
          )}
          {['done', 'rejected'].includes(entry.state) && (
            <button onClick={() => journal.clear(viewerId)}>بستن پیام انتقال</button>
          )}
          <small>شناسه فقط در حافظهٔ این نشست است؛ بارگیری کامل صفحه آن را پاک می‌کند.</small>
        </div>
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
          {list.data?.items.map((p) => (
            <tr key={p.id}>
              <td>
                <bdi>{p.sourcePath}</bdi>
              </td>
              <td>{p.publishedRevisionId ? 'منتشرشده' : 'پیش‌نویس / لغو انتشار'}</td>
              <td>{p.isDemo ? 'نمونهٔ توسعه' : '—'}</td>
              <td>
                {' '}
                <button
                  key={p.id}
                  disabled={busy || unresolved}
                  aria-pressed={selected === p.id}
                  onClick={() => {
                    setSelected(p.id);
                    setCreating(false);
                    setBefore(null);
                    setPreview(null);
                  }}
                >
                  <code dir="ltr">{p.sourcePath}</code> ·{' '}
                  {p.publishedRevisionId ? 'منتشر' : 'پیش‌نویس / لغو انتشار'}
                  {p.isDemo ? ' · نمونه' : ''}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </AdminTable>
      {list.isPending && <p role="status">دریافت انتقال‌ها…</p>}
      {list.data?.items.length === 0 && <p>هنوز انتقالی ثبت نشده است.</p>}
      <div className="row-buttons">
        {cursor && (
          <button disabled={busy || unresolved} onClick={() => setCursor(null)}>
            ابتدای انتقال‌ها
          </button>
        )}
        {list.data?.nextCursor && (
          <button disabled={busy || unresolved} onClick={() => setCursor(list.data!.nextCursor)}>
            انتقال‌های بعدی
          </button>
        )}
      </div>
      {creating ? (
        <RedirectEditor
          key="new"
          writable={!disabled}
          onSave={(input) => void send({ id: uuid(), redirectId: null, input })}
        />
      ) : detail.data && selected === detail.data.id ? (
        <>
          <div className="notice">
            <code dir="ltr">{detail.data.sourcePath}</code>
            <p>
              نسخهٔ انتشار {detail.data.publication.toLocaleString('fa-IR')}؛ نشانی مبدأ و علامت
              نمونه ثابت‌اند. بازگردانی، پیش‌نویس را تغییر نمی‌دهد.
            </p>
            {detail.data.published && (
              <p>
                مقصد عمومی فعلی: <code dir="ltr">{detail.data.published.targetPath}</code> ·{' '}
                {detail.data.published.status}
              </p>
            )}
          </div>
          <RedirectEditor
            key={detail.data.id + ':' + detail.data.version}
            detail={detail.data}
            writable={!disabled}
            onSave={(input) => void send({ id: uuid(), redirectId: detail.data!.id, input })}
          />
          <div className="row-buttons">
            <button disabled={disabled} onClick={() => void publication('Publish', detail.data!)}>
              پیش‌نمایش سرور و انتشار انتقال
            </button>
            <button
              disabled={disabled || !detail.data.published}
              onClick={() => void publication('Unpublish', detail.data!)}
            >
              بازبینی لغو انتشار انتقال
            </button>
            <button disabled={busy || unresolved} onClick={() => void refresh()}>
              بازخوانی انتقال از سرور
            </button>
          </div>
          {preview && !preview.canPublish && (
            <div className="error" role="alert">
              انتشار ممکن نیست:{' '}
              {preview.blockers
                .map(
                  (k) =>
                    ({
                      target_required: 'مقصد ذخیره نشده',
                      status_required: 'نوع انتقال انتخاب نشده',
                      cycle: 'زنجیره دارای حلقه است',
                      chain_too_long: 'زنجیره بیش از پنج انتقال می‌شود',
                      history_capacity: 'ظرفیت تاریخچه پر است',
                    })[k],
                )
                .join('؛ ')}
            </div>
          )}
          <h3>تاریخچهٔ انتقال</h3>
          {history.data?.items.map((r) => (
            <div className="notice" key={r.id}>
              <p>
                نسخهٔ {r.publication.toLocaleString('fa-IR')} ·{' '}
                {r.action === 'Unpublish'
                  ? 'لغو انتشار'
                  : r.action === 'Restore'
                    ? 'بازگردانی'
                    : 'انتشار'}{' '}
                · {r.status}
              </p>
              <code dir="ltr">{r.targetPath}</code>
              {r.action !== 'Unpublish' && (
                <button disabled={disabled} onClick={() => void restore(r.id)}>
                  بازبینی بازگردانی انتقال {r.publication.toLocaleString('fa-IR')}
                </button>
              )}
            </div>
          ))}
          <div className="row-buttons">
            {before && <button onClick={() => setBefore(null)}>جدیدترین انتقال‌ها</button>}
            {history.data?.nextBefore && (
              <button onClick={() => setBefore(history.data!.nextBefore)}>
                تاریخچهٔ قدیمی‌تر انتقال
              </button>
            )}
          </div>
        </>
      ) : null}
      {review && (
        <Modal
          title={
            review.input.action === 'Unpublish'
              ? 'لغو انتقال عمومی'
              : review.input.action === 'Restore'
                ? 'انتشار نسخهٔ تاریخی انتقال'
                : 'انتشار انتقال نشانی'
          }
          preventClose={busy || unresolved}
          onClose={() => setReview(null)}
        >
          <p>
            {review.input.action === 'Unpublish'
              ? 'انتقال عمومی برداشته می‌شود؛ پیش‌نویس و سابقه حفظ می‌شوند.'
              : 'مقصد و نوع ذخیره‌شدهٔ زیر منتشر می‌شوند؛ زنجیره در لحظهٔ ثبت دوباره کنترل می‌شود.'}
          </p>
          <Field label="مبدأ">
            <code dir="ltr">{review.source}</code>
          </Field>
          <Field label="مقصد">
            <code dir="ltr">{review.target}</code>
          </Field>
          <p>
            {review.status === 301 ? '۳۰۱ — انتقال دائمی' : '۳۰۲ — انتقال موقت'}
            {review.isDemo ? '؛ نمونه و خارج Development مخفی' : ''}
          </p>
          {review.chain && (
            <ol dir="ltr">
              {review.chain.map((p, i) => (
                <li key={i}>
                  <code>{p}</code>
                </li>
              ))}
            </ol>
          )}
          <Check
            label="مقصد، نوع انتقال و اثر این عملیات را بازبینی کردم"
            checked={review.input.confirmed === true}
            onChange={(e) =>
              setReview({ ...review, input: { ...review.input, confirmed: e.target.checked } })
            }
          />
          <button
            disabled={disabled || !review.input.confirmed}
            onClick={() => void send({ id: uuid(), redirectId: selected, input: review.input })}
          >
            تأیید عملیات انتقال
          </button>
        </Modal>
      )}
    </section>
  );
}
function RedirectEditor({
  detail,
  writable,
  onSave,
}: {
  detail?: RedirectDetail;
  writable: boolean;
  onSave: (input: RedirectInput) => void;
}) {
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(detail?.draft.targetPath ?? ''),
    [status, setStatus] = useState<'' | '301' | '302'>(
      detail?.draft.status ? (String(detail.draft.status) as '301' | '302') : '',
    ),
    [demo, setDemo] = useState(false),
    [error, setError] = useState<unknown>();
  const dirty =
    target !== (detail?.draft.targetPath ?? '') ||
    status !== (detail?.draft.status ? String(detail.draft.status) : '') ||
    (!detail && (!!source || demo));
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      const input = redirectInputSchema.parse({
        action: detail ? 'Save' : 'Create',
        ...(detail ? { version: detail.version } : { sourcePath: source, isDemo: demo }),
        targetPath: target || null,
        status: status ? Number(status) : null,
      });
      if (target && !validRedirectTarget(detail?.sourcePath ?? source, target))
        throw Error('Invalid target');
      onSave(input);
    } catch {
      setError(Error('مبدأ و مقصد عمومیِ هم‌زبان، بدون پارامتر و نوع انتقال را بررسی کنید.'));
    }
  }
  return (
    <form onSubmit={save}>
      <h3>{detail ? 'پیش‌نویس انتقال' : 'ساخت انتقال'}</h3>
      <p role="status">
        {dirty ? 'تغییر ذخیره‌نشده دارید.' : 'فرم با پیش‌نویس برابر است.'} خروج از ویرایشگر تغییر
        ذخیره‌نشده را نگه نمی‌دارد.
      </p>
      <ErrorBox error={error} />
      <fieldset disabled={!writable}>
        {!detail && (
          <>
            <Field
              label="مبدأ ثابت انتقال"
              hint="مثال: /fa/product/old-phone یا /en/pages/old-page"
            >
              <input
                dir="ltr"
                required
                maxLength={192}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </Field>
            <Check
              label="انتقال نمونهٔ توسعه؛ خارج Development مخفی باشد"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
            />
          </>
        )}
        <Field
          label="مقصد پیش‌نویس"
          hint="همان زبان؛ محصول، صفحه، ریشه، catalog، moments یا support. بدون query یا #."
        >
          <input
            dir="ltr"
            maxLength={192}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label="نوع انتقال پیش‌نویس">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">هنوز انتخاب نشده</option>
            <option value="301">۳۰۱ — دائمی</option>
            <option value="302">۳۰۲ — موقت</option>
          </select>
        </Field>
        <button type="submit">{detail ? 'ذخیرهٔ پیش‌نویس انتقال' : 'ساخت پیش‌نویس انتقال'}</button>
      </fieldset>
    </form>
  );
}
