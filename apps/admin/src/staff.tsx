import { AdminTable } from './admin-table';
import { StaffRoleChoices } from './staff-role-choices';
import { StaffCreate } from './staff-create';
import { AdminFilterForm } from './admin-filters';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, save, ApiError } from './api';
import { Busy, Check, ErrorBox, Field, Modal } from './ui';
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
} from './staff-contract';

const roleName = (id: string, roles: StaffRole[]) => roles.find((r) => r.id === id)?.nameFa ?? id;
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
    const value = staffFiltersSchema.safeParse(draft);
    if (!value.success) {
      setError(new Error('جست‌وجو حداکثر ۱۲۰ نویسه و ۸ واژه است.'));
      return;
    }
    setError(undefined);
    setFilters(value.data);
    refresh();
  }
  return (
    <section className="panel staff-page">
      <div className="section-heading">
        <div>
          <h2>کارکنان و دسترسی‌ها</h2>
          <p>
            نقش‌ها و وضعیت دسترسی کارکنان؛ تغییر هر حساب، نشست‌های قبلی همان حساب را باطل می‌کند.
          </p>
        </div>
        <div className="row-buttons">
          <button onClick={refresh} disabled={list.isFetching}>
            تازه‌سازی کارکنان
          </button>
          {writable && (
            <button className="primary" disabled={!catalog.data} onClick={() => setCreating(true)}>
              ساخت همکار جدید
            </button>
          )}
          {writable && (
            <button disabled={!catalog.data} onClick={() => setSelected(null)}>
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
                  setFilters(emptyStaffFilters);
                  setError(undefined);
                  refresh();
                }}
              >
                پاک‌کردن جست‌وجو
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
        <Field label="وضعیت دسترسی">
          <select
            value={draft.active}
            onChange={(e) =>
              setDraft({ ...draft, active: e.target.value as StaffFilters['active'] })
            }
          >
            <option value="all">همه</option>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </Field>
        <Field label="نقش کارمند">
          <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
            <option value="all">همهٔ نقش‌ها</option>
            {catalog.data?.map((role) => (
              <option key={role.id} value={role.id}>
                {role.nameFa}
              </option>
            ))}
          </select>
        </Field>
      </AdminFilterForm>
      <ErrorBox error={error ?? list.error} />
      {list.isPending ? (
        <Busy />
      ) : list.error ? (
        <button onClick={() => void list.refetch()}>تلاش دوباره برای کارکنان</button>
      ) : (
        list.data && (
          <>
            <p role="status">{list.data.items.length.toLocaleString('fa-IR')} کارمند در این صفحه</p>
            <div
              className="table-wrap"
              role="region"
              aria-label="فهرست کارکنان، قابل پیمایش افقی"
              tabIndex={0}
            >
              <AdminTable searchable={false}>
                <thead>
                  <tr>
                    <th>کارمند</th>
                    <th>نقش‌ها</th>
                    <th>دسترسی</th>
                    <th>تأیید دومرحله‌ای</th>
                    <th>جزئیات</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((row) => (
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
                          className={`staff-mfa ${row.twoFactorEnabled && !row.mfaRecoveryPending ? 'is-ready' : ''}`}
                        >
                          <ShieldCheck size={16} aria-hidden="true" />
                          {row.requiresPasswordChange
                            ? 'در انتظار تغییر رمز اولیه'
                            : row.mfaRecoveryPending
                              ? 'بازیابی ناتمام'
                              : row.twoFactorEnabled
                                ? 'فعال'
                                : 'نیازمند راه‌اندازی'}
                        </span>
                      </td>
                      <td>
                        <button className="row-action" onClick={() => setSelected(row.id)}>
                          دسترسی و رویدادها
                        </button>
                      </td>
                    </tr>
                  ))}
                  {list.data.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty">
                        کارمندی با این جست‌وجو پیدا نشد.
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
          onClose={() => setSelected(undefined)}
        >
          {catalog.data ? (
            selected ? (
              <StaffEditor
                id={selected}
                viewerId={viewerId}
                roles={catalog.data}
                writable={writable}
                onDone={() => {
                  setSelected(undefined);
                  refresh();
                }}
              />
            ) : (
              <StaffGrant
                roles={catalog.data}
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
  onDone,
}: {
  id: string;
  viewerId: string;
  roles: StaffRole[];
  writable: boolean;
  onDone: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const detail = useQuery({
    queryKey: ['admin', 'staff-detail', id],
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
          onDone={onDone}
          onReload={() => {
            void detail.refetch().then((result) => {
              if (result.isSuccess) setRevision((v) => v + 1);
            });
          }}
        />
      ) : null}
      <StaffHistory id={id} roles={roles} />
    </>
  );
}
function StaffEditForm({
  item,
  roles,
  writable,
  onDone,
  onReload,
}: {
  item: StaffRow;
  roles: StaffRole[];
  writable: boolean;
  onDone: () => void;
  onReload: () => void;
}) {
  const [selected, setSelected] = useState(item.roles);
  const [active, setActive] = useState(item.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const client = useQueryClient();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!writable) return;
    setBusy(true);
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
      await client.invalidateQueries({ queryKey: ['admin', 'staff-page'] });
      onDone();
    } catch (error) {
      setError(unknownResult(error));
    } finally {
      setBusy(false);
    }
  }
  const unsupported = selected.some((id) => !roles.some((r) => r.id === id));
  return (
    <form onSubmit={submit}>
      <h3>{item.displayName || item.userName}</h3>
      <p>
        <bdi>{item.userName}</bdi>
      </p>
      <p className="notice">
        پس از اعمال، نشست‌های قبلی این کارمند خارج می‌شوند و ورود بعدی با MFA انجام می‌شود.
        غیرفعال‌کردن، کل حساب و ورود به فروشگاه و پنل را می‌بندد. برای تغییر دسترسی حساب خودتان،
        مدیر دیگری باید اقدام کند.
      </p>
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
        disabled={!writable || busy}
      />
      <Check
        label="دسترسی کارمند فعال باشد"
        checked={active}
        disabled={!writable || busy}
        onChange={(e) => setActive(e.target.checked)}
      />
      {writable && (
        <div className="form-actions">
          <button className="primary" disabled={busy || selected.length === 0 || unsupported}>
            {busy ? 'در حال اعمال…' : 'اعمال دسترسی و ابطال نشست‌ها'}
          </button>
          <button type="button" disabled={busy} onClick={onReload}>
            دریافت اطلاعات تازه؛ کنارگذاشتن تغییرات
          </button>
        </div>
      )}
    </form>
  );
}
function StaffGrant({ roles, onDone }: { roles: StaffRole[]; onDone: () => void }) {
  const [identifier, setIdentifier] = useState('');
  const [candidate, setCandidate] = useState<StaffCandidate>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const client = useQueryClient();
  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setCandidate(undefined);
    setSelected([]);
    try {
      const result = staffCandidateSchema.safeParse(
        await save<unknown>('/admin/staff-candidate', { identifier: identifier.trim() }),
      );
      if (!result.success) throw Error('پاسخ جست‌وجوی حساب معتبر نیست.');
      setCandidate(result.data);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function grant() {
    if (!candidate || !eligibleStaffCandidate(candidate)) return;
    setBusy(true);
    setError(undefined);
    try {
      const value = {
        accountId: candidate.id,
        roles: staffRolesPayload(selected, roles),
        version: candidate.version,
      };
      readStaffDetail(await save<unknown>('/admin/staff', value), candidate.id);
      await client.invalidateQueries({ queryKey: ['admin', 'staff-page'] });
      onDone();
    } catch (error) {
      setError(unknownResult(error));
    } finally {
      setBusy(false);
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
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setCandidate(undefined);
            }}
            required
          />
        </Field>
        <button disabled={busy || !identifier.trim()}>جست‌وجوی حساب موجود</button>
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
                disabled={busy}
              />
              <p>
                اعمال نقش‌ها، نشست‌های فعلی این حساب را باطل و ورود بعدی این حساب از مسیر پنل و با
                MFA انجام می‌شود.
              </p>
              <button className="primary" disabled={busy || selected.length === 0} onClick={grant}>
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
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <button onClick={() => void query.refetch()}>دریافت دوبارهٔ رویدادها</button>
      ) : (
        query.data && (
          <>
            <div className="audit-list">
              {query.data.items.map((event) => (
                <div key={event.id}>
                  <strong>{label(event.action)}</strong>
                  <small>{event.actorName}</small>
                  <time>
                    {new Intl.DateTimeFormat('fa-IR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(event.at))}
                  </time>
                </div>
              ))}
              {query.data.items.length === 0 && (
                <p className="empty">هنوز رویداد دسترسی برای این حساب ثبت نشده است.</p>
              )}
            </div>
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
