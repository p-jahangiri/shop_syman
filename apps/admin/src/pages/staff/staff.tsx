import { AdminTable } from '../../components/tables/admin-table';
import { StaffRoleChoices } from '../../features/staff/staff-role-choices';
import { StaffCreate } from '../../features/staff/staff-create';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { useRef, useState } from 'react';
import { ArrowLeft, History, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, save, ApiError } from '../../api/api';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { adminViewRevision } from '../../auth/admin-view-authority';
import '../../styles/staff/staff-security.css';
import {
  emptyStaffFilters,
  staffFiltersSchema,
  staffPath,
  readStaffPage,
  readStaffDetail,
  staffRoleCatalogSchema,
  staffCandidateSchema,
  staffHistorySchema,
  staffHistoryPath,
  staffRolesPayload,
  eligibleStaffCandidate,
  type StaffFilters,
  type StaffRole,
  type StaffRow,
  type StaffCandidate,
} from '../../api/contracts/staff/staff-contract';

const roleName = (id: string, roles: StaffRole[]) => roles.find((r) => r.id === id)?.nameFa ?? id;
const formatDate = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tehran',
});
const number = new Intl.NumberFormat('fa-IR');
const statusFilters = [
  { value: 'all', label: 'همهٔ حساب‌ها' },
  { value: 'true', label: 'فعال' },
  { value: 'false', label: 'غیرفعال' },
] as const;

function staffSignIn(row: StaffRow) {
  if (row.requiresPasswordChange) return { label: 'تغییر رمز اولیه لازم است', ready: false };
  if (row.mfaRecoveryPending) return { label: 'بازیابی نیمه‌تمام', ready: false };
  if (row.twoFactorEnabled) return { label: 'Authenticator فعال', ready: true };
  return { label: 'راه‌اندازی Authenticator لازم است', ready: false };
}

const requiresStaffRefresh = (error: unknown) =>
  !(error instanceof ApiError) ||
  error.status <= 0 ||
  error.status >= 500 ||
  error.status === 409 ||
  error.code === 'staff_candidate_unavailable';
const unknownResult = (error: unknown) =>
  error instanceof ApiError && error.code === 'transaction_conflict'
    ? new Error(
        'عملیات هم‌زمان دیگری انجام شد؛ اطلاعات کارمند را دوباره دریافت و پس از بررسی اعمال کنید.',
      )
    : error instanceof ApiError && error.status > 0 && error.status < 500
      ? error
      : new Error(
          'پاسخ تغییر دسترسی دریافت یا تأیید نشد؛ ممکن است ثبت شده باشد. پیش از ارسال دوباره، اطلاعات تازه را دریافت کنید.',
        );
export function StaffPage({ viewerId, writable }: { viewerId: string; writable: boolean }) {
  const [draft, setDraft] = useState<StaffFilters>(emptyStaffFilters);
  const [filters, setFilters] = useState(emptyStaffFilters);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<unknown>();
  const [creating, setCreating] = useState(false);
  const [creationBusy, setCreationBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>();
  const page = pages.at(-1)!;
  const catalog = useQuery({
    queryKey: ['admin', 'staff-roles'],
    queryFn: async () => {
      const result = staffRoleCatalogSchema.safeParse(
        await api<unknown>('/admin/staff-role-catalog'),
      );
      if (!result.success) throw Error('تعریف نقش‌های کارکنان معتبر نیست.');
      return result.data.roles;
    },
    retry: false,
  });
  const list = useQuery({
    queryKey: ['admin', 'staff-page', generation, filters, page],
    queryFn: async ({ signal }) =>
      readStaffPage(await api<unknown>(staffPath(filters, page), { signal }), filters),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function refresh() {
    setPages([null]);
    setGeneration((v) => v + 1);
  }
  function apply(e: React.FormEvent) {
    e.preventDefault();
    applyFilters(draft);
  }
  function applyFilters(next: StaffFilters) {
    const value = staffFiltersSchema.safeParse(next);
    if (!value.success) {
      setError(new Error('جست‌وجو حداکثر ۱۲۰ نویسه و ۸ واژه است.'));
      return;
    }
    setError(undefined);
    if (
      filters.active === value.data.active &&
      filters.query === value.data.query &&
      filters.role === value.data.role
    )
      return;
    setFilters(value.data);
    refresh();
  }
  const rows = list.data?.items;
  const activeCount = rows?.filter((row) => row.isActive).length;
  const needsSetup = rows?.filter((row) => row.isActive && !staffSignIn(row).ready).length;
  return (
    <section className="staff-page staff-workspace">
      <header className="panel staff-workspace-intro">
        <div className="staff-section-icon" aria-hidden="true">
          <Users size={24} />
        </div>
        <div>
          <h2>کارکنان و دسترسی‌ها</h2>
          <p>وضعیت ورود همکاران را بررسی کنید و نقش هر حساب را براساس وظایف آن تنظیم کنید.</p>
        </div>
        {writable && (
          <button className="primary" disabled={!catalog.data} onClick={() => setCreating(true)}>
            <UserPlus size={18} aria-hidden="true" /> ساخت همکار جدید
          </button>
        )}
      </header>
      {rows && (
        <dl className="staff-workspace-stats" aria-label="خلاصهٔ صفحهٔ فعلی کارکنان">
          <div>
            <dt>حساب در این صفحه</dt>
            <dd>{number.format(rows.length)}</dd>
          </div>
          <div>
            <dt>دسترسی فعال</dt>
            <dd>{number.format(activeCount ?? 0)}</dd>
          </div>
          <div>
            <dt>حساب فعال در انتظار تکمیل ورود</dt>
            <dd>{number.format(needsSetup ?? 0)}</dd>
          </div>
        </dl>
      )}
      <section className="panel staff-roster" aria-label="فهرست کارکنان">
        <div className="section-heading">
          <div>
            <h3>فهرست همکاران</h3>
            <p>جست‌وجو و فیلترهای زیر روی تمام حساب‌های کارکنان اعمال می‌شوند.</p>
          </div>
          <div className="row-buttons">
            <button type="button" onClick={refresh} disabled={list.isFetching}>
              <RefreshCw size={16} aria-hidden="true" /> تازه‌سازی
            </button>
            {writable && (
              <button type="button" disabled={!catalog.data} onClick={() => setSelected(null)}>
                افزودن حساب موجود
              </button>
            )}
          </div>
        </div>
        <ErrorBox error={catalog.error} />
        {catalog.error && (
          <button onClick={() => void catalog.refetch()}>دریافت دوبارهٔ نقش‌ها</button>
        )}
        <AdminFilterForm
          label="فیلتر کارکنان"
          onSubmit={apply}
          inline
          search={
            <Field label="نام یا نام کاربری کارمند">
              <input
                maxLength={120}
                value={draft.query}
                onChange={(e) => setDraft({ ...draft, query: e.target.value })}
              />
            </Field>
          }
          actions={
            <>
              <div className="row-buttons">
                <button className="primary">جست‌وجوی کارکنان</button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(emptyStaffFilters);
                    applyFilters(emptyStaffFilters);
                  }}
                >
                  پاک‌کردن فیلترها
                </button>
              </div>
            </>
          }
          applied={[
            filters.query ? 'جست‌وجو: ' + filters.query : null,
            filters.active === 'all'
              ? null
              : filters.active === 'true'
                ? 'دسترسی فعال'
                : 'دسترسی غیرفعال',
            filters.role === 'all' ? null : roleName(filters.role, catalog.data ?? []),
          ].filter((value): value is string => value !== null)}
        >
          <Field label="نقش کارمند">
            <select
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            >
              <option value="all">همهٔ نقش‌ها</option>
              {catalog.data?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.nameFa}
                </option>
              ))}
            </select>
          </Field>
          <div className="staff-segments" role="group" aria-label="وضعیت دسترسی">
            {statusFilters.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filters.active === value}
                onClick={() => {
                  if (value === filters.active) return;
                  const next = { ...draft, active: value };
                  setDraft(next);
                  applyFilters(next);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </AdminFilterForm>
        <ErrorBox error={error ?? list.error} />
        {list.isPending ? (
          <Busy />
        ) : list.error ? (
          <button onClick={() => void list.refetch()}>تلاش دوباره برای کارکنان</button>
        ) : (
          list.data && (
            <>
              <div
                className="table-wrap"
                role="region"
                aria-label="فهرست کارکنان، قابل پیمایش افقی"
                tabIndex={0}
              >
                <AdminTable searchable={false} aria-label="کارکنان">
                  <thead>
                    <tr>
                      <th>کارمند</th>
                      <th>نقش‌ها</th>
                      <th>دسترسی</th>
                      <th>تأیید دومرحله‌ای</th>
                      <th>ساخت حساب</th>
                      <th data-sortable={false}>جزئیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((row) => {
                      const signIn = staffSignIn(row);
                      return (
                        <tr key={row.id}>
                          <td>
                            <div className="staff-identity">
                              <span className="staff-avatar" aria-hidden="true">
                                {Array.from(row.displayName || row.userName)[0]}
                              </span>
                              <div>
                                <strong>
                                  {row.displayName || row.userName || '—'}
                                  {row.id.toLowerCase() === viewerId.toLowerCase() && (
                                    <span className="staff-self">شما</span>
                                  )}
                                </strong>
                                <small>
                                  <bdi>{row.userName}</bdi>
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="staff-role-tags">
                              {row.roles.map((id) => (
                                <span key={id}>{roleName(id, catalog.data ?? [])}</span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`staff-state ${row.isActive ? 'is-active' : 'is-inactive'}`}
                            >
                              {row.isActive ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`staff-mfa ${signIn.ready ? 'is-ready' : 'needs-attention'}`}
                            >
                              <ShieldCheck size={16} aria-hidden="true" />
                              {signIn.label}
                            </span>
                          </td>
                          <td data-sort-value={row.createdAt}>
                            <time dateTime={row.createdAt}>
                              {formatDate.format(new Date(row.createdAt))}
                            </time>
                          </td>
                          <td>
                            <button
                              className="row-action"
                              onClick={() => setSelected(row.id)}
                              aria-label={'پروندهٔ ' + (row.displayName || row.userName)}
                            >
                              پرونده <ArrowLeft size={15} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {list.data.items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty">
                          کارمندی با این فیلترها پیدا نشد.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </AdminTable>
              </div>
              <div className="pagination">
                <button
                  disabled={pages.length === 1 || list.isFetching}
                  onClick={() => setPages((v) => v.slice(0, -1))}
                >
                  کارکنان قبلی
                </button>
                <span>صفحهٔ {pages.length.toLocaleString('fa-IR')}</span>
                <button
                  disabled={!list.data.nextCursor || list.isFetching}
                  onClick={() => {
                    if (list.data?.nextCursor) setPages((v) => [...v, list.data!.nextCursor]);
                  }}
                >
                  ۵۰ کارمند بعدی
                </button>
              </div>
            </>
          )
        )}
      </section>
      {creating && catalog.data && (
        <Modal
          title="ساخت حساب همکار"
          preventClose={creationBusy}
          onClose={() => setCreating(false)}
        >
          <StaffCreate
            viewerId={viewerId}
            roles={catalog.data}
            onBusy={setCreationBusy}
            onCreated={() => {
              setCreating(false);
              refresh();
            }}
          />
        </Modal>
      )}
      {selected !== undefined && (
        <Modal
          title={selected ? 'دسترسی و رویدادهای کارمند' : 'افزودن کارمند از حساب تأییدشده'}
          preventClose={accessBusy}
          onClose={() => setSelected(undefined)}
        >
          {catalog.data ? (
            selected ? (
              <StaffEditor
                id={selected}
                viewerId={viewerId}
                roles={catalog.data}
                writable={writable}
                onBusy={setAccessBusy}
                onDone={() => {
                  setSelected(undefined);
                  refresh();
                }}
              />
            ) : (
              <StaffGrant
                roles={catalog.data}
                writable={writable}
                onBusy={setAccessBusy}
                onDone={() => {
                  setSelected(undefined);
                  refresh();
                }}
              />
            )
          ) : (
            <Busy />
          )}
        </Modal>
      )}
    </section>
  );
}
function StaffEditor({
  id,
  viewerId,
  roles,
  writable,
  onBusy,
  onDone,
}: {
  id: string;
  viewerId: string;
  roles: StaffRole[];
  writable: boolean;
  onBusy: (busy: boolean) => void;
  onDone: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<'access' | 'history'>('access');
  const detail = useQuery({
    queryKey: ['admin', 'staff-detail', viewerId, id],
    queryFn: async ({ signal }) =>
      readStaffDetail(await api<unknown>(`/admin/staff/${encodeURIComponent(id)}`, { signal }), id),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  return (
    <>
      <div className="staff-segments staff-detail-tabs" role="group" aria-label="بخش پرونده">
        <button type="button" aria-pressed={view === 'access'} onClick={() => setView('access')}>
          <ShieldCheck size={16} aria-hidden="true" /> دسترسی حساب
        </button>
        <button type="button" aria-pressed={view === 'history'} onClick={() => setView('history')}>
          <History size={16} aria-hidden="true" /> تاریخچهٔ دسترسی
        </button>
      </div>
      <div hidden={view !== 'access'}>
        {detail.isPending ? (
          <Busy />
        ) : detail.error ? (
          <>
            <ErrorBox error={detail.error} />
            <button onClick={() => void detail.refetch()}>دریافت دوبارهٔ اطلاعات کارمند</button>
          </>
        ) : detail.data ? (
          <StaffEditForm
            key={detail.data.version + ':' + revision}
            item={detail.data}
            roles={roles}
            writable={writable && id.toLowerCase() !== viewerId.toLowerCase()}
            reloading={detail.isFetching}
            isSelf={id.toLowerCase() === viewerId.toLowerCase()}
            onBusy={onBusy}
            onDone={onDone}
            onReload={() => {
              if (detail.isFetching) return;
              void detail.refetch().then((result) => {
                if (result.isSuccess) setRevision((v) => v + 1);
              });
            }}
          />
        ) : null}
      </div>
      {view === 'history' && <StaffHistory id={id} roles={roles} />}
    </>
  );
}
function StaffEditForm({
  item,
  roles,
  writable,
  reloading,
  isSelf,
  onBusy,
  onDone,
  onReload,
}: {
  item: StaffRow;
  roles: StaffRole[];
  writable: boolean;
  reloading?: boolean;
  isSelf: boolean;
  onBusy: (busy: boolean) => void;
  onDone: () => void;
  onReload: () => void;
}) {
  const [selected, setSelected] = useState(item.roles);
  const [active, setActive] = useState(item.isActive);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [error, setError] = useState<unknown>();
  const locked = useRef(false);
  const client = useQueryClient();
  const added = selected.filter((id) => !item.roles.includes(id));
  const removed = item.roles.filter((id) => !selected.includes(id));
  const changed = active !== item.isActive || added.length > 0 || removed.length > 0;
  const unsupported = selected.some((id) => !roles.some((r) => r.id === id));
  const maySubmit =
    writable && changed && selected.length > 0 && !unsupported && !reloadRequired && !reloading;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!maySubmit || locked.current) return;
    if (!reviewing) {
      setReviewing(true);
      return;
    }
    locked.current = true;
    const view = adminViewRevision();
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      const value = {
        roles: staffRolesPayload(selected, roles),
        isActive: active,
        version: item.version,
      };
      readStaffDetail(
        await save<unknown>(`/admin/staff/${encodeURIComponent(item.id)}`, value, 'PUT'),
        item.id,
      );
      if (adminViewRevision() !== view) return;
      await client.invalidateQueries({ queryKey: ['admin', 'staff-page'] });
      if (adminViewRevision() === view) onDone();
    } catch (error) {
      if (adminViewRevision() !== view) return;
      setError(unknownResult(error));
      if (requiresStaffRefresh(error)) setReloadRequired(true);
    } finally {
      locked.current = false;
      if (adminViewRevision() === view) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  const signIn = staffSignIn(item);
  return (
    <form onSubmit={submit}>
      <div className="staff-account-summary">
        <div>
          <h3>{item.displayName || item.userName}</h3>
          <bdi>{item.userName}</bdi>
        </div>
        <span className={`staff-state ${item.isActive ? 'is-active' : 'is-inactive'}`}>
          {item.isActive ? 'فعال' : 'غیرفعال'}
        </span>
        <span className="staff-mfa">{signIn.label}</span>
      </div>
      {isSelf && <p className="notice">برای تغییر دسترسی حساب شما، مدیر دیگری باید اقدام کند.</p>}
      <ErrorBox error={error} />
      {unsupported && (
        <p role="alert">
          تعریف بعضی نقش‌ها تازه نیست؛ ابتدا نقش‌ها و اطلاعات را دوباره دریافت کنید.
        </p>
      )}
      <StaffRoleChoices
        roles={roles}
        value={selected}
        onChange={setSelected}
        disabled={!writable || busy || reviewing || reloadRequired || reloading}
      />
      <Check
        label="دسترسی کارمند فعال باشد"
        checked={active}
        disabled={!writable || busy || reviewing || reloadRequired || reloading}
        onChange={(e) => setActive(e.target.checked)}
      />
      {writable && (
        <>
          {reviewing && (
            <section className="staff-change-review" aria-label="بازبینی تغییرات دسترسی">
              <h4>تغییرات پیشنهادی</h4>
              <dl>
                {added.length > 0 && (
                  <div>
                    <dt>نقش‌های افزوده</dt>
                    <dd>{added.map((id) => roleName(id, roles)).join('، ')}</dd>
                  </div>
                )}
                {removed.length > 0 && (
                  <div>
                    <dt>نقش‌های برداشته</dt>
                    <dd>{removed.map((id) => roleName(id, roles)).join('، ')}</dd>
                  </div>
                )}
                {active !== item.isActive && (
                  <div>
                    <dt>وضعیت دسترسی</dt>
                    <dd>{active ? 'فعال می‌شود' : 'غیرفعال می‌شود'}</dd>
                  </div>
                )}
              </dl>
              <p>با ثبت تغییرات، نشست‌های قبلی این حساب بسته می‌شوند.</p>
              {!active && item.isActive && (
                <p>غیرفعال‌کردن حساب، ورود همکار به پنل و فروشگاه را می‌بندد.</p>
              )}
            </section>
          )}
          <div className="form-actions">
            <button className="primary" disabled={busy || !maySubmit}>
              {busy
                ? 'در حال اعمال…'
                : reviewing
                  ? 'تأیید و اعمال دسترسی'
                  : 'بازبینی تغییرات دسترسی'}
            </button>
            {reviewing && !reloadRequired && (
              <button type="button" disabled={busy} onClick={() => setReviewing(false)}>
                بازگشت به ویرایش
              </button>
            )}
            <button type="button" disabled={busy || reloading} onClick={onReload}>
              {reloading
                ? 'در حال دریافت…'
                : reloadRequired
                  ? 'دریافت وضعیت تازه'
                  : 'دریافت دوباره و بازنشانی فرم'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
function StaffGrant({
  roles,
  writable,
  onBusy,
  onDone,
}: {
  roles: StaffRole[];
  writable: boolean;
  onBusy: (busy: boolean) => void;
  onDone: () => void;
}) {
  const [identifier, setIdentifier] = useState('');
  const [candidate, setCandidate] = useState<StaffCandidate>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const locked = useRef(false);
  const client = useQueryClient();
  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!writable || locked.current || !identifier.trim()) return;
    locked.current = true;
    const view = adminViewRevision();
    setBusy(true);
    onBusy(true);
    setError(undefined);
    setCandidate(undefined);
    setSelected([]);
    try {
      const result = staffCandidateSchema.safeParse(
        await save<unknown>('/admin/staff-candidate', { identifier: identifier.trim() }),
      );
      if (!result.success) throw Error('پاسخ جست‌وجوی حساب معتبر نیست.');
      if (adminViewRevision() === view) setCandidate(result.data);
    } catch (error) {
      if (adminViewRevision() === view) setError(error);
    } finally {
      locked.current = false;
      if (adminViewRevision() === view) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  async function grant() {
    if (
      !writable ||
      locked.current ||
      !candidate ||
      !eligibleStaffCandidate(candidate) ||
      selected.length === 0
    )
      return;
    locked.current = true;
    const view = adminViewRevision();
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      const value = {
        accountId: candidate.id,
        roles: staffRolesPayload(selected, roles),
        version: candidate.version,
      };
      readStaffDetail(await save<unknown>('/admin/staff', value), candidate.id);
      if (adminViewRevision() !== view) return;
      await client.invalidateQueries({ queryKey: ['admin', 'staff-page'] });
      if (adminViewRevision() === view) onDone();
    } catch (error) {
      if (adminViewRevision() !== view) return;
      setError(unknownResult(error));
      if (requiresStaffRefresh(error)) {
        setCandidate(undefined);
        setSelected([]);
      }
    } finally {
      locked.current = false;
      if (adminViewRevision() === view) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <>
      <p className="notice">
        حساب باید از قبل وجود داشته، رمز ورود داشته و ایمیل یا موبایل آن تأیید شده باشد. این صفحه
        رمز نمی‌سازد و تأیید تماس را تغییر نمی‌دهد؛ ثبت‌نام و دعوت از طریق پیامک/ایمیل به سرویس
        تأیید واقعی وابسته‌اند.
      </p>
      <form onSubmit={lookup}>
        <Field label="نام کاربری یا ایمیل حساب موجود">
          <input
            maxLength={256}
            dir="ltr"
            autoComplete="off"
            disabled={busy || !writable}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setCandidate(undefined);
              setSelected([]);
              setError(undefined);
            }}
            required
          />
        </Field>
        <button disabled={busy || !writable || !identifier.trim()}>جست‌وجوی حساب موجود</button>
      </form>
      <ErrorBox error={error} />
      {candidate && (
        <section className="notice">
          <h3>{candidate.displayName || candidate.userName}</h3>
          <p>
            <bdi>{candidate.userName}</bdi>
          </p>
          {eligibleStaffCandidate(candidate) ? (
            <>
              <StaffRoleChoices
                roles={roles}
                value={selected}
                onChange={setSelected}
                disabled={busy || !writable}
              />
              <p>
                اعمال نقش‌ها، نشست‌های فعلی این حساب را باطل و ورود بعدی این حساب از مسیر پنل و با
                MFA انجام می‌شود.
              </p>
              <button
                className="primary"
                disabled={busy || !writable || selected.length === 0}
                onClick={grant}
              >
                {busy ? 'در حال افزودن…' : 'افزودن به کارکنان و ابطال نشست‌های قبلی'}
              </button>
            </>
          ) : (
            <p role="status">
              {candidate.alreadyStaff
                ? 'این حساب از قبل کارمند است؛ از فهرست کارکنان ویرایش کنید.'
                : !candidate.contactVerified
                  ? 'ایمیل یا موبایل این حساب هنوز تأیید نشده است.'
                  : !candidate.hasPassword
                    ? 'این حساب هنوز رمز ورود ندارد؛ ابتدا خود کاربر باید از مسیر تأییدشده رمز تنظیم کند.'
                    : !candidate.isActive
                      ? 'این حساب غیرفعال است.'
                      : 'این حساب فعلاً برای افزودن به کارکنان آماده نیست.'}
            </p>
          )}
        </section>
      )}
    </>
  );
}
function StaffHistory({ id, roles }: { id: string; roles: StaffRole[] }) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const cursor = pages.at(-1)!;
  const query = useQuery({
    queryKey: ['admin', 'staff-history', id, cursor],
    queryFn: async ({ signal }) => {
      const parsed = staffHistorySchema.safeParse(
        await api<unknown>(staffHistoryPath(id, cursor), { signal }),
      );
      if (!parsed.success) throw Error('پاسخ رویدادهای دسترسی معتبر نیست.');
      return parsed.data;
    },
    gcTime: 0,
    retry: false,
  });
  function label(action: string) {
    if (action.startsWith('STAFF_ROLE_ADDED:'))
      return 'افزودن نقش ' + roleName(action.split(':')[1], roles);
    if (action.startsWith('STAFF_ROLE_REMOVED:'))
      return 'حذف نقش ' + roleName(action.split(':')[1], roles);
    return (
      (
        {
          STAFF_CREATED: 'ساخت حساب توسط مدیر',
          STAFF_INITIAL_PASSWORD_CHANGED: 'تغییر رمز اولیه توسط همکار',
          STAFF_GRANTED: 'افزودن به کارکنان',
          STAFF_ENABLED: 'فعال‌کردن دسترسی',
          STAFF_DISABLED: 'غیرفعال‌کردن دسترسی',
          STAFF_SESSIONS_REVOKED: 'ابطال نشست‌های قبلی',
        } as Record<string, string>
      )[action] ?? action
    );
  }
  return (
    <section className="staff-history">
      <h3>رویدادهای دسترسی این حساب</h3>
      <p>زمان ثبت، انجام‌دهنده و شناسهٔ پیگیری هر تغییر در دسترس است.</p>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <button onClick={() => void query.refetch()}>دریافت دوبارهٔ رویدادها</button>
      ) : (
        query.data && (
          <>
            {query.data.items.length > 0 ? (
              <ol className="staff-event-list">
                {query.data.items.map((event) => (
                  <li key={event.id}>
                    <details>
                      <summary>
                        <strong>{label(event.action)}</strong>
                        <span>{event.actorName || 'بدون نام نمایشی'}</span>
                        <time dateTime={event.at}>{formatDate.format(new Date(event.at))}</time>
                      </summary>
                      <dl>
                        <div>
                          <dt>شناسهٔ رویداد</dt>
                          <dd>
                            <bdi>{event.id}</bdi>
                          </dd>
                        </div>
                        <div>
                          <dt>شناسهٔ انجام‌دهنده</dt>
                          <dd>
                            <bdi>{event.actorId}</bdi>
                          </dd>
                        </div>
                        {event.traceId && (
                          <div>
                            <dt>شناسهٔ پیگیری</dt>
                            <dd>
                              <bdi>{event.traceId}</bdi>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">هنوز رویداد دسترسی برای این حساب ثبت نشده است.</p>
            )}
            <div className="pagination">
              <button
                disabled={pages.length === 1 || query.isFetching}
                onClick={() => setPages((v) => v.slice(0, -1))}
              >
                رویدادهای جدیدتر
              </button>
              <button
                disabled={!query.data.nextCursor || query.isFetching}
                onClick={() => {
                  if (query.data?.nextCursor) setPages((v) => [...v, query.data!.nextCursor]);
                }}
              >
                رویدادهای قدیمی‌تر
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}
