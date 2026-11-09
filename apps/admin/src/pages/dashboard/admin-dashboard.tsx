import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChartNoAxesCombined,
  Clock3,
  Globe2,
  LayoutGrid,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Ticket,
  Warehouse,
} from 'lucide-react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Skeleton from '@mui/material/Skeleton';
import {
  readDashboardCheques,
  readDashboardOrders,
  readDashboardStock,
  readDashboardTickets,
} from '../../features/dashboard/admin-dashboard-data';
import { orderDashboardSummary, orderWindow } from '../../features/dashboard/admin-dashboard-model';
import { navigation, navigationGroups, type Page } from '../../layout/admin-navigation';
import { canAccessAdminPage } from '../../auth/admin-page-access';
import {
  adminDashboardShortcuts,
  adminStockLimits,
  defaultAdminDashboardPreferences,
  moveAdminPreference,
  type AdminDashboardPreferences,
  type AdminDashboardShortcut,
  type AdminDashboardWidget,
} from '../../state/admin-ui-preferences';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { moneyLabel } from '../../features/catalog/product-editor-model';
import { ErrorBox } from '../../components/ui';
import '../../styles/dashboard/admin-dashboard.css';

type Props = {
  accountId: string;
  displayName: string;
  permissions: readonly string[];
  preferences: AdminDashboardPreferences;
  onSavePreferences: (value: AdminDashboardPreferences) => void;
  onOpenFinder: () => void;
  onNavigate: (page: Page) => void;
};

const widgetInfo = {
  tickets: { label: 'تیکت‌های پشتیبانی', page: 'tickets', icon: Ticket, tone: 'blue' },
  inventory: { label: 'موجودی رو به اتمام', page: 'inventory', icon: Warehouse, tone: 'amber' },
  cheques: { label: 'چک‌های سررسیدشده', page: 'credit-schedules', icon: Clock3, tone: 'red' },
  orders: {
    label: 'سفارش‌ها و صف تکمیل',
    page: 'orders',
    icon: ChartNoAxesCombined,
    tone: 'olive',
  },
  traffic: { label: 'بازدید فروشگاه', page: null, icon: Globe2, tone: 'blue' },
  shortcuts: { label: 'منتخب‌های من', page: null, icon: Star, tone: 'olive' },
} as const;
const destinations = new Map(navigation.map((item) => [item.id, item]));
const shortcutDescription: Partial<Record<AdminDashboardShortcut, string>> = {
  orders: 'سفارش، رزرو و تحویل',
  products: 'کالا، تنوع و قیمت',
  inventory: 'مانده و گردش کالا',
  returns: 'درخواست‌های مرجوعی',
  tickets: 'پاسخ به مشتریان',
  receiving: 'نگاشت واحدهای هلو',
  'credit-schedules': 'سررسید و وضعیت چک',
  payments: 'پرداخت و تطبیق مالی',
  customers: 'سوابق مشتریان',
  content: 'محتوای فروشگاه',
};

const fa = new Intl.NumberFormat('fa-IR');
const date = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'long', timeZone: 'Asia/Tehran' });
const shortDay = new Intl.DateTimeFormat('fa-IR', {
  month: 'short',
  day: 'numeric',
  timeZone: 'Asia/Tehran',
});
const stateCopy = {
  AwaitingPayment: ['در انتظار پرداخت', 'amber'],
  Paid: ['در انتظار تکمیل', 'blue'],
  CreditApproved: ['تأیید چکی · در صف تکمیل', 'blue'],
  Fulfilled: ['تحویل‌شده', 'olive'],
  Expired: ['منقضی‌شده', 'red'],
  Cancelled: ['لغوشده', 'red'],
} as const;

function canOpen(page: Page, permissions: readonly string[]) {
  const destination = destinations.get(page);
  return !!destination && canAccessAdminPage(destination, permissions);
}

export function AdminDashboard({
  accountId,
  displayName,
  permissions,
  preferences,
  onSavePreferences,
  onOpenFinder,
  onNavigate,
}: Props) {
  const [editing, setEditing] = useState(false);
  const allowedWidgets = preferences.order.filter((widget) => {
    const page = widgetInfo[widget].page;
    return page === null || canOpen(page, permissions);
  });
  const allowedShortcuts = adminDashboardShortcuts.filter((page) => canOpen(page, permissions));
  const visibleWidgets = allowedWidgets.filter(
    (widget): widget is Exclude<AdminDashboardWidget, 'shortcuts'> =>
      widget !== 'shortcuts' && !preferences.hidden.includes(widget),
  );
  const visibleShortcuts = preferences.shortcuts.filter((page) => allowedShortcuts.includes(page));
  const showShortcuts = allowedShortcuts.length > 0 && !preferences.hidden.includes('shortcuts');
  return (
    <div className="dashboard-workspace">
      <header className="dashboard-heading">
        <div>
          <div className="dashboard-kicker">
            عملیات فروشگاه <span aria-hidden="true">·</span> <time>{date.format(new Date())}</time>
          </div>
          <h1>میز کار</h1>
          <p>{displayName}، وضعیت امروز فروشگاه و کارهای نیازمند پیگیری را یکجا ببینید.</p>
        </div>
        <div className="dashboard-heading-actions">
          <Button variant="contained" startIcon={<Search size={17} />} onClick={onOpenFinder}>
            رفتن به بخش
          </Button>
          <Button
            variant="outlined"
            startIcon={<SlidersHorizontal size={17} />}
            onClick={() => setEditing(true)}
          >
            شخصی‌سازی داشبورد
          </Button>
        </div>
      </header>
      {showShortcuts && (
        <section
          className="panel dashboard-widget dashboard-shortcut-widget"
          aria-label="منتخب‌های من"
        >
          <WidgetHeading widget="shortcuts" />
          {visibleShortcuts.length ? (
            <div className="dashboard-shortcut-grid">
              {visibleShortcuts.map((page) => {
                const item = destinations.get(page)!;
                return (
                  <button type="button" key={page} onClick={() => onNavigate(page)}>
                    <span className="dashboard-shortcut-icon">
                      <item.icon size={19} aria-hidden="true" />
                    </span>
                    <span className="dashboard-shortcut-text">
                      <strong>{item.label}</strong>
                      <small>
                        {shortcutDescription[page] ??
                          navigationGroups.find((group) => group.pages.some((id) => id === page))
                            ?.label}
                      </small>
                    </span>
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="dashboard-no-shortcuts">
              <p>میان‌بری انتخاب نشده است.</p>
              <Button onClick={onOpenFinder}>انتخاب بخش‌های پرکاربرد</Button>
            </div>
          )}
        </section>
      )}
      {visibleWidgets.length ? (
        <div className="dashboard-widget-grid">
          {visibleWidgets.map((widget) => (
            <DashboardWidget
              key={widget}
              widget={widget}
              accountId={accountId}
              stockLimit={preferences.stockLimit}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : (
        <section className="panel dashboard-empty">
          <LayoutGrid size={24} aria-hidden="true" />
          <h2>نمایشگری انتخاب نشده است</h2>
          <p>نمایشگرها را از شخصی‌سازی داشبورد فعال کنید.</p>
        </section>
      )}
      {editing && (
        <DashboardPreferencesDialog
          preferences={preferences}
          allowedWidgets={allowedWidgets}
          allowedShortcuts={allowedShortcuts}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            onSavePreferences(next);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

type DataWidget = Exclude<AdminDashboardWidget, 'shortcuts' | 'traffic'>;
function DashboardWidget({
  widget,
  accountId,
  stockLimit,
  onNavigate,
}: {
  widget: Exclude<AdminDashboardWidget, 'shortcuts'>;
  accountId: string;
  stockLimit: number;
  onNavigate: (page: Page) => void;
}) {
  const context = { accountId, onNavigate };
  switch (widget) {
    case 'orders':
      return <OrdersWidget {...context} />;
    case 'tickets':
      return (
        <DataCard
          {...context}
          widget={widget}
          fetcher={readDashboardTickets}
          action="صندوق پشتیبانی"
        >
          {(data) => (
            <Headline
              value={data.open}
              label="نیازمند پاسخ"
              detail={fa.format(data.waiting) + ' در انتظار پاسخ مشتری'}
            />
          )}
        </DataCard>
      );
    case 'inventory':
      return (
        <DataCard {...context} widget={widget} fetcher={readDashboardStock} action="مشاهدهٔ انبار">
          {(data) => {
            const low = data.items.filter(
              (row) => row.available > 0 && row.available <= stockLimit,
            );
            const empty = data.items.filter((row) => row.available === 0).length;
            return (
              <>
                <Headline
                  value={low.length}
                  label="تنوع کم‌موجود"
                  detail={fa.format(empty) + ' تنوع ناموجود · آستانه ' + fa.format(stockLimit)}
                />
                {low.length > 0 && (
                  <ul className="dashboard-stock-list" aria-label="اولویت‌های تأمین موجودی">
                    {low.slice(0, 2).map((row) => (
                      <li key={row.variantId}>
                        <span title={row.name + ' · ' + row.sku}>{row.name}</span>
                        <strong aria-label={fa.format(row.available) + ' واحد آزاد'}>
                          {fa.format(row.available)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            );
          }}
        </DataCard>
      );
    case 'cheques':
      return (
        <DataCard {...context} widget={widget} fetcher={readDashboardCheques} action="گزارش سررسید">
          {(data) => (
            <Headline
              value={data.overdue}
              label="گذشته از سررسید"
              detail={fa.format(data.dueToday) + ' سررسید امروز · بازهٔ ۳۰ روزه'}
            />
          )}
        </DataCard>
      );
    case 'traffic':
      return (
        <section className="panel dashboard-widget dashboard-traffic">
          <WidgetHeading widget="traffic" />
          <div className="dashboard-traffic-body">
            <strong>منبع آمار متصل نیست</strong>
            <p>پس از اتصال ابزار تحلیل بازدید، روند ترافیک فروشگاه در این بخش نمایش داده می‌شود.</p>
          </div>
        </section>
      );
  }
}

function WidgetHeading({ widget, subtitle }: { widget: AdminDashboardWidget; subtitle?: string }) {
  const { label, icon: Icon, tone } = widgetInfo[widget];
  return (
    <div className="dashboard-widget-heading">
      <span className="dashboard-widget-icon" data-tone={tone}>
        <Icon size={19} aria-hidden="true" />
      </span>
      <div>
        <h2>{label}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

function Headline({ value, label, detail }: { value: number; label: string; detail: string }) {
  return (
    <div className="dashboard-headline">
      <div>
        <strong>{fa.format(value)}</strong> <span>{label}</span>
      </div>
      <p>{detail}</p>
    </div>
  );
}

function DataCard<T extends { complete: boolean }>({
  accountId,
  widget,
  fetcher,
  action,
  children,
  onNavigate,
}: {
  accountId: string;
  widget: DataWidget;
  fetcher: (signal: AbortSignal) => Promise<T>;
  action: string;
  children: (data: T) => ReactNode;
  onNavigate: (page: Page) => void;
}) {
  const query = useQuery({
    queryKey: ['admin', 'dashboard', accountId, adminViewRevision(), widget],
    queryFn: ({ signal }) => fetcher(signal),
    staleTime: 60_000,
    refetchInterval: 120_000,
    gcTime: 60_000,
  });
  return (
    <section
      className={'panel dashboard-widget' + (widget === 'orders' ? ' dashboard-orders' : '')}
      aria-label={widgetInfo[widget].label}
    >
      <WidgetHeading
        widget={widget}
        subtitle={widget === 'orders' ? 'ثبت سفارش به تفکیک روز و وضعیت فعلی' : undefined}
      />
      {query.data ? (
        <>
          {children(query.data)}
          {!query.data.complete && (
            <p className="dashboard-scope-note">
              سقف بررسی رسیده است؛ شمارش بر اساس ردیف‌های دریافت‌شده است.
            </p>
          )}
          {query.isRefetchError && (
            <p className="dashboard-scope-note" role="status">
              به‌روزرسانی ناموفق بود؛ آخرین دادهٔ دریافت‌شده نمایش داده می‌شود.
            </p>
          )}
        </>
      ) : query.error ? (
        <div className="dashboard-widget-error">
          <ErrorBox error={query.error} />
          <Button onClick={() => void query.refetch()}>تلاش مجدد</Button>
        </div>
      ) : (
        <div className="dashboard-widget-loading" role="status" aria-label="در حال دریافت آمار">
          <Skeleton variant="rounded" width="48%" height={32} />
          <Skeleton variant="text" width="80%" />
        </div>
      )}
      <Button
        className="dashboard-widget-action"
        size="small"
        endIcon={<ArrowUpRight size={15} />}
        onClick={() => onNavigate(widgetInfo[widget].page)}
      >
        {action}
      </Button>
    </section>
  );
}

function OrdersWidget({ accountId, onNavigate }: Pick<Props, 'accountId' | 'onNavigate'>) {
  const [days, setDays] = useState(7);
  const [list, setList] = useState<'recent' | 'completionQueue' | 'exceptions'>('recent');
  return (
    <DataCard
      accountId={accountId}
      onNavigate={onNavigate}
      widget="orders"
      fetcher={readDashboardOrders}
      action="مدیریت سفارش‌ها"
    >
      {(data) => {
        const summary = orderDashboardSummary(data.items, data.today, days);
        const maximum = Math.max(1, ...summary.series.map((entry) => entry.orders));
        const lists = [
          ['recent', 'اخیر'],
          ['completionQueue', 'صف تکمیل'],
          ['exceptions', 'لغو و انقضا'],
        ] as const;
        const figures = [
          ['کل سفارش‌ها', summary.total, 'olive'],
          ['در انتظار پرداخت', summary.waiting, 'amber'],
          ['در صف تکمیل', summary.ready, 'blue'],
          ['تحویل‌شده', summary.delivered, 'olive'],
          ['لغو یا انقضا', summary.interrupted, 'red'],
        ] as const;
        return (
          <>
            <div className="dashboard-order-toolbar">
              <p>بازه بر اساس تاریخ ثبت سفارش، به وقت تهران</p>
              <div className="dashboard-period" role="group" aria-label="بازهٔ سفارش‌ها">
                {[7, orderWindow].map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={days === size}
                    onClick={() => setDays(size)}
                  >
                    {fa.format(size)} روز
                  </button>
                ))}
              </div>
            </div>
            <dl className="dashboard-order-metrics">
              {figures.map(([label, value, tone]) => (
                <div key={label} data-tone={tone}>
                  <dt>{label}</dt>
                  <dd>{fa.format(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="dashboard-order-split">
              <figure className="dashboard-chart">
                <figcaption>
                  <strong>روند ثبت سفارش</strong>
                  <span className="dashboard-chart-legend">
                    <i /> ثبت‌شده <i /> تأییدشده یا تحویل‌شده
                  </span>
                </figcaption>
                <div className="dashboard-bars" data-dense={days > 7} aria-hidden="true">
                  {summary.series.map(({ day, orders, ready }) => {
                    const label = shortDay.format(new Date(day + 'T12:00:00Z'));
                    return (
                      <div key={day} title={label + ' · ' + fa.format(orders) + ' سفارش'}>
                        <span>{orders ? fa.format(orders) : ''}</span>
                        <svg viewBox="0 0 36 100" preserveAspectRatio="none">
                          <rect
                            x="7"
                            width="22"
                            y={100 - (orders / maximum) * 100}
                            height={(orders / maximum) * 100}
                            rx="3"
                            className="dashboard-chart-total"
                          />
                          <rect
                            x="7"
                            width="22"
                            y={100 - (ready / maximum) * 100}
                            height={(ready / maximum) * 100}
                            rx="3"
                            className="dashboard-chart-ready"
                          />
                        </svg>
                        <small>{label}</small>
                      </div>
                    );
                  })}
                </div>
                {summary.total === 0 && (
                  <p className="dashboard-chart-empty">در این بازه سفارشی ثبت نشده است.</p>
                )}
                <details className="dashboard-chart-details">
                  <summary>اعداد نمودار</summary>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">روز</th>
                        <th scope="col">ثبت‌شده</th>
                        <th scope="col">تأیید یا تحویل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.series.map(({ day, orders, ready }) => (
                        <tr key={day}>
                          <th scope="row">{shortDay.format(new Date(day + 'T12:00:00Z'))}</th>
                          <td>{fa.format(orders)}</td>
                          <td>{fa.format(ready)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </figure>
              <section className="dashboard-recent" aria-label="فهرست سفارش‌ها">
                <h3>فهرست سفارش‌ها</h3>
                <div
                  className="dashboard-period dashboard-list-tabs"
                  role="group"
                  aria-label="نمای فهرست سفارش‌ها"
                >
                  {lists.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={list === key}
                      onClick={() => setList(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {summary[list].length ? (
                  <ul>
                    {summary[list].map((order) => {
                      const [label, tone] = stateCopy[order.state];
                      return (
                        <li key={order.id}>
                          <div>
                            <bdi>{order.reference}</bdi>
                            <small>{shortDay.format(new Date(order.createdAt))}</small>
                          </div>
                          <div>
                            <span className="dashboard-status" data-tone={tone}>
                              {label}
                            </span>
                            <small>{moneyLabel(order.payableTotalRial)}</small>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="dashboard-recent-empty">سفارشی در این گروه و بازه وجود ندارد.</p>
                )}
              </section>
            </div>
          </>
        );
      }}
    </DataCard>
  );
}

function DashboardPreferencesDialog({
  preferences,
  allowedWidgets,
  allowedShortcuts,
  onClose,
  onSave,
}: {
  preferences: AdminDashboardPreferences;
  allowedWidgets: readonly AdminDashboardWidget[];
  allowedShortcuts: readonly AdminDashboardShortcut[];
  onClose: () => void;
  onSave: (value: AdminDashboardPreferences) => void;
}) {
  const title = useId();
  const [draft, setDraft] = useState(preferences);
  const [nextShortcut, setNextShortcut] = useState<AdminDashboardShortcut | ''>('');
  const order = draft.order.filter(
    (widget) => widget !== 'shortcuts' && allowedWidgets.includes(widget),
  );
  const selected = draft.shortcuts.filter((shortcut) => allowedShortcuts.includes(shortcut));
  const available = allowedShortcuts.filter((shortcut) => !selected.includes(shortcut));
  return (
    <Dialog open onClose={onClose} maxWidth="sm" aria-labelledby={title}>
      <DialogTitle id={title}>شخصی‌سازی داشبورد</DialogTitle>
      <DialogContent dividers className="dashboard-preferences">
        <p>
          ترتیب نمایشگرها و دسترسی‌های سریع را تنظیم کنید. انتخاب‌ها برای همین حساب در این مرورگر
          ذخیره می‌شوند.
        </p>
        <fieldset>
          <legend>نمایشگرها</legend>
          <ol>
            {order.map((widget, index) => (
              <li key={widget}>
                <label>
                  <input
                    type="checkbox"
                    checked={!draft.hidden.includes(widget)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setDraft((old) => ({
                        ...old,
                        hidden: checked
                          ? old.hidden.filter((item) => item !== widget)
                          : [...old.hidden, widget],
                      }));
                    }}
                  />
                  {widgetInfo[widget].label}
                </label>
                <MoveButtons
                  name={widgetInfo[widget].label}
                  index={index}
                  count={order.length}
                  onMove={(direction) => {
                    const reordered = moveAdminPreference(order, widget, direction);
                    setDraft((old) => ({
                      ...old,
                      order: [
                        ...reordered,
                        ...old.order.filter((item) => !reordered.includes(item)),
                      ],
                    }));
                  }}
                />
              </li>
            ))}
          </ol>
        </fieldset>
        {allowedWidgets.includes('inventory') && (
          <label className="dashboard-stock-setting">
            آستانهٔ موجودی کم
            <select
              value={draft.stockLimit}
              onChange={(event) =>
                setDraft((old) => ({ ...old, stockLimit: Number(event.target.value) }))
              }
            >
              {adminStockLimits.map((limit) => (
                <option key={limit} value={limit}>
                  {fa.format(limit)} واحد آزاد
                </option>
              ))}
            </select>
          </label>
        )}
        {allowedShortcuts.length > 0 && (
          <fieldset>
            <legend>منتخب‌ها</legend>
            <label className="dashboard-shortcut-setting">
              <input
                type="checkbox"
                checked={!draft.hidden.includes('shortcuts')}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setDraft((old) => ({
                    ...old,
                    hidden: checked
                      ? old.hidden.filter((item) => item !== 'shortcuts')
                      : [...old.hidden, 'shortcuts'],
                  }));
                }}
              />
              نمایش منتخب‌ها بالای داشبورد
            </label>
            <ol>
              {selected.map((page, index) => (
                <li key={page}>
                  <label>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setDraft((old) => ({
                          ...old,
                          shortcuts: old.shortcuts.filter((item) => item !== page),
                        }))
                      }
                    />
                    {destinations.get(page)!.label}
                  </label>
                  <MoveButtons
                    name={destinations.get(page)!.label}
                    index={index}
                    count={selected.length}
                    onMove={(direction) => {
                      const reordered = moveAdminPreference(selected, page, direction);
                      setDraft((old) => ({
                        ...old,
                        shortcuts: [
                          ...reordered,
                          ...old.shortcuts.filter((item) => !reordered.includes(item)),
                        ],
                      }));
                    }}
                  />
                </li>
              ))}
            </ol>
            {available.length > 0 && (
              <div className="dashboard-add-shortcut">
                <select
                  aria-label="انتخاب بخش برای افزودن به منتخب‌ها"
                  value={nextShortcut}
                  onChange={(event) =>
                    setNextShortcut(available.find((item) => item === event.target.value) ?? '')
                  }
                >
                  <option value="">یک بخش را انتخاب کنید</option>
                  {available.map((page) => (
                    <option key={page} value={page}>
                      {destinations.get(page)!.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outlined"
                  startIcon={<Plus size={14} />}
                  disabled={!nextShortcut || !available.includes(nextShortcut)}
                  onClick={() => {
                    if (!nextShortcut || !available.includes(nextShortcut)) return;
                    setDraft((old) => ({ ...old, shortcuts: [...old.shortcuts, nextShortcut] }));
                    setNextShortcut('');
                  }}
                >
                  افزودن
                </Button>
              </div>
            )}
          </fieldset>
        )}
      </DialogContent>
      <DialogActions className="dashboard-preferences-footer">
        <Button onClick={() => setDraft(defaultAdminDashboardPreferences())}>بازنشانی</Button>
        <Button onClick={onClose}>انصراف</Button>
        <Button variant="contained" onClick={() => onSave(draft)}>
          ذخیره تنظیمات
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MoveButtons({
  name,
  index,
  count,
  onMove,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="dashboard-order-controls">
      <button
        type="button"
        className="icon"
        aria-label={'بالا بردن ' + name}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={16} />
      </button>
      <button
        type="button"
        className="icon"
        aria-label={'پایین بردن ' + name}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={16} />
      </button>
    </div>
  );
}
