import { adminRmaJournal } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import { RmaCommandGuard } from '@sayman/web-shared/components/orders/rma-command-guard';
import { AdminDashboard } from '../pages/dashboard/admin-dashboard';
import type { HolooSource } from '../api/contracts/accounting/accounting-reconciliation-contract';
import type { CmsWorkspaceSection } from '../features/content/cms-workspace-sections';
import { navigation, type Page } from '../layout/admin-navigation';
import { AdminModuleHeader } from '../layout/admin-module-header';
import { AdminNavigation } from '../layout/admin-navigation-view';
import { AdminQuickAccess } from '../layout/admin-quick-access';
import { useAdminColorMode } from '../hooks/admin-color-mode';
import {
  readAdminDashboardPreferences,
  readCompactNavigation,
  rememberAdminPage,
  writeAdminDashboardPreferences,
  writeCompactNavigation,
  type AdminDashboardPreferences,
} from '../state/admin-ui-preferences';
import { orderParcelJournal } from '../state/orders/order-parcel-journal';
import { orderDigitalJournal } from '../state/orders/order-digital-journal';
import { DigitalCommandGuard } from '../features/orders/order-digital-guard';
import { ParcelCommandGuard } from '../features/orders/order-parcels';
import { CmsBlogPostCommandGuard } from '../features/content/cms-blog-posts';
import { adminCmsBlogPostJournal } from '../state/content/admin-cms-blog-post-journal';
import { adminCreditReminderPolicyJournal } from '../state/finance/admin-credit-reminder-policy-journal';
import { adminCreditReminderJournal } from '../state/finance/admin-credit-reminder-journal';
import { adminCreditClearanceJournal } from '../state/finance/admin-credit-clearance-journal';
import { adminReviewHoldPolicyJournal } from '../state/finance/admin-review-hold-policy-journal';
import { adminChequeApprovalJournal } from '../state/finance/admin-cheque-approval-journal';
import { adminCreditUpfrontJournal } from '../state/finance/admin-credit-upfront-journal';
import { adminCmsRedirectJournal } from '../state/content/admin-cms-redirect-journal';
import { CmsRedirectCommandGuard } from '../features/content/cms-redirects';
import { connectAdminLogoutSync } from '../auth/admin-logout-sync';
import { adminCmsPageJournal } from '../state/content/admin-cms-page-journal';
import { CmsPageCommandGuard } from '../features/content/cms-pages';
import { adminChequeLedgerJournal } from '../state/finance/admin-cheque-ledger-journal';
import { CreditScheduleCommandGuard } from '../features/finance/credit-schedule-command-guard';
import { adminCreditScheduleJournal } from '../state/finance/admin-credit-schedule-journal';
import { adminCreditScopeJournal } from '@sayman/web-shared/lib/credit/credit-purchase-scope-journal.ts';
import { adminCreditReviewJournal } from '@sayman/web-shared/lib/credit/credit-review-journal.ts';
import { adminCreditRequirementsJournal } from '../state/finance/credit-requirements-journal';
import { adminTicketJournal } from '../state/support/ticket-journal';
import { ShipmentCommandGuard } from '../features/orders/order-shipment';
import {
  clearShipmentJournal,
  interruptShipmentCommand,
} from '../state/orders/order-shipment-journal';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  RefreshCw,
  Menu,
  Moon,
  Sun,
  PanelRightClose,
  PanelRightOpen,
  Search,
} from 'lucide-react';
import { clearMarketPhoneJournal } from '../state/market/market-phone-journal';
import { clearMarketImportJournal } from '../state/market/market-import-journal';
import { clearSourceJournal } from '../state/market/market-source-journal';
import { clearSourceCsvJournal } from '../state/market/market-source-csv-journal';
import { clearWarehouseJournal } from '../state/accounting/accounting-warehouse-journal';
import {
  clearStockJournal,
  interruptStockCommand,
} from '../state/accounting/accounting-stock-journal';
import { api, save, setToken, setAccessRenewal } from '../api/api';
import type { Session, Catalog, PurchaseMethod, ChequePlan, Content } from '../types/types';
import { Busy, ErrorBox, PageBoundary } from '../components/ui';
import { Login } from '../pages/auth/login';
import {
  acceptAdminAuthorization,
  adminAuthFailure,
  isVerifiedAdminSession,
  preserveAdminJournal,
  type AdminAuthFailure,
} from '../auth/admin-auth-boundary';
import { SessionUnavailable } from '../auth/session-access';
import { allowedAdminPage } from '../auth/admin-page-access';
const ReturnsPage = lazy(() => import('../pages/orders/returns'));
const AuditPage = lazy(() => import('../pages/audit/audit'));
const SourcingReceivingPage = lazy(() =>
  import('../pages/market/sourcing-receiving').then((module) => ({
    default: module.SourcingReceivingPage,
  })),
);
const AccountingPage = lazy(() =>
  import('../pages/accounting/accounting').then((module) => ({ default: module.AccountingPage })),
);
const CustomersPage = lazy(() =>
  import('../pages/customers/customers').then((module) => ({ default: module.CustomersPage })),
);
const StaffPage = lazy(() =>
  import('../pages/staff/staff').then((module) => ({ default: module.StaffPage })),
);
const SecurityPage = lazy(() =>
  import('../pages/staff/mfa-recovery').then((module) => ({ default: module.SecurityPage })),
);
const SmsSettingsPage = lazy(() =>
  import('../pages/settings/sms-workspace').then((module) => ({
    default: module.SmsWorkspacePage,
  })),
);
const ProductsPage = lazy(() =>
  import('../pages/catalog/products').then((module) => ({ default: module.ProductsPage })),
);
const CatalogPage = lazy(() =>
  import('../pages/catalog/catalog-metadata').then((module) => ({
    default: module.CatalogPage,
  })),
);
const InventoryPage = lazy(() =>
  import('../pages/inventory/inventory').then((module) => ({ default: module.InventoryPage })),
);
const CreditSchedulesPage = lazy(() =>
  import('../pages/finance/credit-schedules').then((module) => ({
    default: module.CreditSchedulesPage,
  })),
);
const CreditRequirementsPage = lazy(() =>
  import('../pages/finance/credit-requirements').then((module) => ({
    default: module.CreditRequirementsPage,
  })),
);
const CreditApplicationsPage = lazy(() =>
  import('../pages/finance/credit-applications').then((module) => ({
    default: module.CreditApplicationsPage,
  })),
);
const TicketsPage = lazy(() =>
  import('../pages/support/tickets').then((module) => ({ default: module.TicketsPage })),
);
const PaymentsPage = lazy(() =>
  import('../pages/finance/payments').then((module) => ({ default: module.PaymentsPage })),
);
const FinancePage = lazy(() =>
  import('../pages/finance/finance').then((module) => ({ default: module.FinancePage })),
);
const UsedItemsPage = lazy(() =>
  import('../pages/catalog/used-items').then((module) => ({ default: module.UsedItemsPage })),
);
const ReviewsPage = lazy(() =>
  import('../pages/reviews/reviews').then((module) => ({ default: module.ReviewsPage })),
);
const ContentPage = lazy(() =>
  import('../pages/content/operations').then((module) => ({ default: module.ContentPage })),
);
const ChargesPage = lazy(() =>
  import('../pages/finance/charges').then((module) => ({ default: module.ChargesPage })),
);
const OrdersPage = lazy(() => import('../pages/orders/orders'));
const storefrontUrl = (import.meta.env.VITE_STOREFRONT_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
let initialRefresh: Promise<Session> | null = null;
function refreshSession() {
  const run = async () => {
    const value = await save<unknown>('/auth/refresh', {});
    if (!isVerifiedAdminSession(value)) throw new SessionUnavailable();
    return value;
  };
  return (initialRefresh ??= run().finally(() => {
    initialRefresh = null;
  }));
}
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [verificationUnavailable, setVerificationUnavailable] = useState(false),
    [useLogin, setUseLogin] = useState(false);
  const [page, setPage] = useState<Page>('dashboard');
  const [cmsSection, setCmsSection] = useState<CmsWorkspaceSection>('articles');
  const [unitSource, setUnitSource] = useState<HolooSource>();
  const [menu, setMenu] = useState(false);
  const [finderOwner, setFinderOwner] = useState<string | null>(null);
  const finderOpener = useRef<HTMLElement | null>(null);
  const [savedPreferences, setSavedPreferences] = useState<{
    ownerId: string;
    value: AdminDashboardPreferences;
  } | null>(null);
  const [compact, setCompact] = useState(readCompactNavigation);
  const { mode, toggle: toggleColorMode } = useAdminColorMode();
  const client = useQueryClient();
  const logoutSync = useRef<ReturnType<typeof connectAdminLogoutSync> | null>(null);
  const account = useRef<string | null>(null),
    verifiedPermissions = useRef<readonly string[] | null>(null);
  const generation = useRef(0);
  const [permissionRevision, setPermissionRevision] = useState(0);
  const lockAuth = useCallback(
    (kind: AdminAuthFailure) => {
      adminChequeApprovalJournal.interrupt();
      adminCreditReminderJournal.interrupt();
      adminCreditReminderPolicyJournal.interrupt();
      adminCreditClearanceJournal.interrupt();
      orderParcelJournal.interrupt();
      orderDigitalJournal.interrupt();
      adminRmaJournal.interrupt();
      adminReviewHoldPolicyJournal.interrupt();
      adminCreditUpfrontJournal.interrupt();
      adminChequeLedgerJournal.interrupt();
      adminCmsRedirectJournal.interrupt();
      adminCmsPageJournal.interrupt();
      adminCmsBlogPostJournal.interrupt();
      adminCreditScheduleJournal.interrupt();
      adminCreditScopeJournal.interrupt();
      adminCreditReviewJournal.interrupt();
      adminCreditRequirementsJournal.interrupt();
      adminTicketJournal.interrupt();
      interruptShipmentCommand();
      interruptStockCommand();
      generation.current++;
      setToken('');
      setAccessRenewal(null);
      preserveAdminJournal(client, account.current, kind);
      if (kind === 'invalid') {
        adminChequeApprovalJournal.bind(null);
        adminCreditReminderJournal.bind(null);
        adminCreditReminderPolicyJournal.bind(null);
        adminCreditClearanceJournal.bind(null);
        orderParcelJournal.bind(null);
        orderDigitalJournal.bind(null);
        adminRmaJournal.bind(null);
        adminReviewHoldPolicyJournal.bind(null);
        adminCreditUpfrontJournal.bind(null);
        adminChequeLedgerJournal.bind(null);
        adminCmsRedirectJournal.bind(null);
        adminCmsPageJournal.bind(null);
        adminCmsBlogPostJournal.bind(null);
        adminCreditScheduleJournal.bind(null);
        adminCreditScopeJournal.bind(null);
        adminCreditReviewJournal.bind(null);
        adminCreditRequirementsJournal.bind(null);
        adminTicketJournal.bind(null);
        clearMarketImportJournal();
        clearSourceJournal();
        clearSourceCsvJournal();
        clearMarketPhoneJournal();
        clearWarehouseJournal();
        clearStockJournal();
        clearShipmentJournal();
        account.current = null;
        verifiedPermissions.current = null;
        setPage('dashboard');
      }
      setSession(null);
      setFinderOwner(null);
      setVerificationUnavailable(kind === 'unavailable');
      setUseLogin(false);
      setRestoring(false);
    },
    [client],
  );
  const accept = useCallback(
    (value: Session) => {
      if (!isVerifiedAdminSession(value)) {
        lockAuth('unavailable');
        return;
      }
      generation.current++;
      const nextPermissions = value.user.permissions ?? [];
      const boundary = acceptAdminAuthorization(
        client,
        account.current,
        value.user.id,
        verifiedPermissions.current,
        nextPermissions,
      );
      adminChequeApprovalJournal.bind(value.user.id);
      adminCreditReminderJournal.bind(value.user.id);
      adminCreditReminderPolicyJournal.bind(value.user.id);
      adminCreditClearanceJournal.bind(value.user.id);
      orderParcelJournal.bind(value.user.id);
      orderDigitalJournal.bind(value.user.id);
      adminRmaJournal.bind(value.user.id);
      adminReviewHoldPolicyJournal.bind(value.user.id);
      adminCreditUpfrontJournal.bind(value.user.id);
      adminChequeLedgerJournal.bind(value.user.id);
      adminCmsRedirectJournal.bind(value.user.id);
      adminCmsPageJournal.bind(value.user.id);
      adminCmsBlogPostJournal.bind(value.user.id);
      adminCreditScheduleJournal.bind(value.user.id);
      adminCreditScopeJournal.bind(value.user.id);
      adminCreditReviewJournal.bind(value.user.id);
      adminCreditRequirementsJournal.bind(value.user.id);
      adminTicketJournal.bind(value.user.id);
      if (boundary.permissionsChanged) {
        orderParcelJournal.bind(null);
        orderDigitalJournal.bind(null);
        adminRmaJournal.redactForPermissionsChange();
        orderParcelJournal.bind(value.user.id);
        orderDigitalJournal.bind(value.user.id);
        adminChequeApprovalJournal.interrupt();
        adminCreditReminderJournal.interrupt();
        adminCreditReminderPolicyJournal.interrupt();
        adminCreditClearanceJournal.interrupt();
        orderParcelJournal.interrupt();
        orderDigitalJournal.interrupt();
        adminRmaJournal.interrupt();
        adminReviewHoldPolicyJournal.interrupt();
        adminCreditUpfrontJournal.interrupt();
        adminChequeLedgerJournal.interrupt();
        adminCmsRedirectJournal.interrupt();
        adminCmsPageJournal.interrupt();
        adminCmsBlogPostJournal.interrupt();
        adminCreditScheduleJournal.interrupt();
        adminCreditScopeJournal.interrupt();
        adminCreditReviewJournal.interrupt();
        adminCreditRequirementsJournal.interrupt();
        adminTicketJournal.interrupt();
      }
      if (boundary.ownerChanged) {
        clearMarketImportJournal();
        clearSourceJournal();
        clearSourceCsvJournal();
        clearMarketPhoneJournal();
      }
      if (boundary.ownerChanged || boundary.permissionsChanged) {
        clearWarehouseJournal();
        clearStockJournal();
        clearShipmentJournal();
        setMenu(false);
        setPermissionRevision((current) => current + 1);
      }
      setPage((current) =>
        boundary.ownerChanged
          ? 'dashboard'
          : allowedAdminPage(current, navigation, nextPermissions, 'dashboard'),
      );
      account.current = value.user.id;
      verifiedPermissions.current = [...nextPermissions];
      setToken(value.accessToken, value.expiresIn);
      setVerificationUnavailable(false);
      setUseLogin(false);
      setSession(value);
    },
    [client, lockAuth],
  );
  const hasSession = session !== null;
  useEffect(() => {
    const sync = connectAdminLogoutSync(() => lockAuth('invalid'));
    logoutSync.current = sync;
    return () => {
      if (logoutSync.current === sync) logoutSync.current = null;
      sync.close();
    };
  }, [client, lockAuth]);
  useEffect(() => {
    let cancelled = false;
    const expected = generation.current;
    refreshSession()
      .then((s) => {
        if (!cancelled && generation.current === expected) accept(s);
      })
      .catch((error) => {
        if (!cancelled && generation.current === expected) lockAuth(adminAuthFailure(error));
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accept, lockAuth]);
  useEffect(() => {
    const expire = (event: Event) =>
      lockAuth(
        event instanceof CustomEvent && event.detail?.kind === 'invalid'
          ? 'invalid'
          : 'unavailable',
      );
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, [client, lockAuth]);
  useEffect(() => {
    if (!hasSession) return;
    setAccessRenewal(async () => {
      const value = await refreshSession();
      return {
        token: value.accessToken,
        expiresIn: value.expiresIn,
        accepted: () => accept(value),
      };
    });
    return () => setAccessRenewal(null);
  }, [hasSession, accept]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const expected = generation.current;
    const timer = window.setTimeout(
      () => {
        refreshSession()
          .then((value) => {
            if (!cancelled && generation.current === expected) accept(value);
          })
          .catch((error) => {
            if (!cancelled && generation.current === expected) lockAuth(adminAuthFailure(error));
          });
      },
      (session.expiresIn - 60) * 1000,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session, accept, lockAuth]);
  const permissions = session?.user.permissions ?? [];
  const can = (p: string) => permissions.includes(p);
  const canReadEditorial = can('cms.read') || can('cms.editor');
  function openCms(section: CmsWorkspaceSection) {
    setCmsSection(section);
    setPage('content');
  }
  const enabled = !!session;
  const visiblePage = allowedAdminPage(page, navigation, permissions, 'dashboard');
  const ownerId = session?.user.id;
  const storedPreferences = useMemo(
    () => (ownerId ? readAdminDashboardPreferences(ownerId) : null),
    [ownerId],
  );
  const preferences =
    savedPreferences && savedPreferences.ownerId === ownerId
      ? savedPreferences.value
      : storedPreferences;
  function savePreferences(value: AdminDashboardPreferences) {
    if (!ownerId) return;
    setSavedPreferences({ ownerId, value });
    writeAdminDashboardPreferences(ownerId, value);
  }
  const openFinder = useCallback(() => {
    if (!ownerId) return;
    finderOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFinderOwner(ownerId);
  }, [ownerId]);
  const finderOpen = !!ownerId && finderOwner === ownerId;
  function closeFinder() {
    setFinderOwner(null);
    requestAnimationFrame(() => finderOpener.current?.focus({ preventScroll: true }));
  }
  function navigate(next: Page) {
    setUnitSource(undefined);
    setPage(allowedAdminPage(next, navigation, permissions, visiblePage));
    setMenu(false);
  }
  useEffect(() => {
    if (!ownerId || visiblePage === 'dashboard') return;
    rememberAdminPage(ownerId, visiblePage);
  }, [ownerId, visiblePage]);
  useEffect(() => {
    if (!ownerId || menu || finderOpen) return;
    function openWithShortcut(event: KeyboardEvent) {
      if (
        event.code !== 'KeyK' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector('[aria-modal="true"], dialog[open]')
      )
        return;
      event.preventDefault();
      openFinder();
    }
    window.addEventListener('keydown', openWithShortcut);
    return () => window.removeEventListener('keydown', openWithShortcut);
  }, [finderOpen, menu, openFinder, ownerId]);
  const previousPage = useRef(visiblePage);
  useEffect(() => {
    if (previousPage.current === visiblePage) return;
    previousPage.current = visiblePage;
    if (!hasSession) return;
    const { hash, pathname, search } = window.location;
    if (hash.startsWith('#holoo-') || hash.startsWith('#cms-site-'))
      window.history.replaceState(window.history.state, '', pathname + search);
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('admin-main')?.focus({ preventScroll: true });
  }, [hasSession, visiblePage]);
  const viewingCmsSettings =
    visiblePage === 'content' && (cmsSection === 'settings' || cmsSection === 'history');
  const catalog = useQuery({
    queryKey: ['admin', 'catalog'],
    queryFn: () => api<Catalog>('/admin/catalog?metadataOnly=true'),
    enabled:
      enabled &&
      can('catalog.read') &&
      (viewingCmsSettings ||
        ['products', 'categories', 'attributes', 'brands', 'finance'].includes(visiblePage)),
  });
  const methods = useQuery({
    queryKey: ['admin', 'methods'],
    queryFn: () => api<PurchaseMethod[]>('/admin/purchase-methods'),
    enabled: enabled && can('finance.read') && visiblePage === 'products',
  });
  const plans = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api<ChequePlan[]>('/admin/cheque-plans'),
    enabled: enabled && can('finance.read') && visiblePage === 'products',
  });
  const content = useQuery({
    queryKey: ['admin', 'content'],
    queryFn: () => api<Content>('/admin/content'),
    enabled: enabled && can('cms.read') && viewingCmsSettings,
  });
  async function logout() {
    setFinderOwner(null);
    logoutSync.current?.publish();
    adminChequeApprovalJournal.bind(null);
    adminCreditReminderJournal.bind(null);
    adminCreditReminderPolicyJournal.bind(null);
    adminCreditClearanceJournal.bind(null);
    orderParcelJournal.bind(null);
    orderDigitalJournal.bind(null);
    adminRmaJournal.bind(null);
    adminReviewHoldPolicyJournal.bind(null);
    adminCreditUpfrontJournal.bind(null);
    adminChequeLedgerJournal.bind(null);
    adminCmsRedirectJournal.bind(null);
    adminCmsPageJournal.bind(null);
    adminCmsBlogPostJournal.bind(null);
    adminCreditScheduleJournal.bind(null);
    adminCreditScopeJournal.bind(null);
    adminCreditReviewJournal.bind(null);
    adminCreditRequirementsJournal.bind(null);
    adminTicketJournal.bind(null);
    generation.current++;
    const expected = generation.current;
    clearMarketImportJournal();
    clearSourceJournal();
    clearSourceCsvJournal();
    clearMarketPhoneJournal();
    clearWarehouseJournal();
    clearStockJournal();
    clearShipmentJournal();
    preserveAdminJournal(client, account.current, 'logout');
    account.current = null;
    verifiedPermissions.current = null;
    setToken('');
    setAccessRenewal(null);
    setSession(null);
    setVerificationUnavailable(false);
    setUseLogin(false);
    setPage('dashboard');
    setRestoring(true);
    try {
      await api('/auth/logout', { method: 'POST', body: '{}', signal: AbortSignal.timeout(10000) });
    } catch {
      /* Local logout remains authoritative even if the server is unavailable. */
    } finally {
      if (generation.current === expected) setRestoring(false);
    }
  }
  async function verifyAgain() {
    const expected = generation.current;
    setRestoring(true);
    try {
      const value = await refreshSession();
      if (generation.current === expected) accept(value);
    } catch (error) {
      if (generation.current === expected) lockAuth(adminAuthFailure(error));
    } finally {
      setRestoring(false);
    }
  }
  const journalGuard = account.current ? (
    <>
      <DigitalCommandGuard viewerId={account.current} />
      <RmaCommandGuard journal={adminRmaJournal} actor={null} unverified />
    </>
  ) : null;
  const loginGeneration = generation.current;
  if (restoring)
    return (
      <>
        {journalGuard}
        <div className="loading-screen">
          <Busy />
        </div>
      </>
    );
  if (!session && verificationUnavailable && !useLogin)
    return (
      <>
        {journalGuard}
        <main className="loading-screen">
          <section className="panel" style={{ maxWidth: 560, margin: 20 }}>
            <h1>تأیید نشست در دسترس نیست</h1>
            <p className="notice">
              اطلاعات خصوصی و عملیات پنل تا تأیید دوباره بسته‌اند. اگر فرمان تأمین یا پیشنهاد در
              انتظار دارید، شناسه و بدنهٔ همان تلاش در حافظهٔ همین تب و فقط برای حساب قبلی
              محفوظ‌اند.
            </p>
            <div className="row-buttons">
              <button className="primary" onClick={() => void verifyAgain()}>
                تلاش دوباره برای تأیید نشست
              </button>
              <button
                onClick={() => {
                  generation.current++;
                  setUseLogin(true);
                }}
              >
                تأیید حساب با ورود دوباره
              </button>
            </div>
          </section>
        </main>
      </>
    );
  if (!session || !preferences)
    return (
      <>
        {journalGuard}
        {verificationUnavailable && (
          <div className="notice">
            <p>
              پس از تأیید همین حساب، فرمان محفوظ ادامه پیدا می‌کند. ورود با حساب دیگر، فرمان حساب
              قبلی را پاک می‌کند.
            </p>
            <button
              onClick={() => {
                generation.current++;
                setToken('');
                setUseLogin(false);
              }}
            >
              بازگشت به بررسی نشست
            </button>
          </div>
        )}
        <Login
          onSession={(value) => {
            if (generation.current === loginGeneration) accept(value);
          }}
        />
      </>
    );
  const current = navigation.find((n) => n.id === visiblePage)!;
  return (
    <div className={compact ? 'app admin-shell admin-shell-compact' : 'app admin-shell'}>
      {can('cms.read') && (
        <CmsRedirectCommandGuard viewerId={session.user.id} onOpen={() => openCms('redirects')} />
      )}
      {canReadEditorial && (
        <CmsBlogPostCommandGuard viewerId={session.user.id} onOpen={() => openCms('articles')} />
      )}
      {canReadEditorial && (
        <CmsPageCommandGuard viewerId={session.user.id} onOpen={() => openCms('pages')} />
      )}
      {visiblePage !== 'credit-schedules' && can('finance.read') && (
        <CreditScheduleCommandGuard
          viewerId={session.user.id}
          onOpen={() => setPage('credit-schedules')}
        />
      )}
      <RmaCommandGuard
        journal={adminRmaJournal}
        actor={session.user.id}
        unverified={!can('sales.read')}
        onOpen={can('sales.read') ? () => setPage('returns') : undefined}
      />
      <ShipmentCommandGuard viewerId={session.user.id} />
      <DigitalCommandGuard
        viewerId={session.user.id}
        onOpen={can('sales.read') && can('inventory.read') ? () => setPage('orders') : undefined}
      />
      <ParcelCommandGuard
        viewerId={session.user.id}
        writable={can('sales.write') && can('inventory.write')}
      />
      <a className="skip-link" href="#admin-main">
        رفتن به محتوای صفحه
      </a>
      <AdminNavigation
        selected={visiblePage}
        permissions={permissions}
        open={menu}
        compact={compact}
        onClose={() => setMenu(false)}
        displayName={session.user.displayName ?? 'مدیر فروشگاه'}
        onLogout={() => void logout()}
        onNavigate={navigate}
      />
      {finderOpen && (
        <AdminQuickAccess
          key={session.user.id}
          accountId={session.user.id}
          permissions={permissions}
          selected={visiblePage}
          pins={preferences.shortcuts}
          onTogglePin={(next) => {
            if (allowedAdminPage(next, navigation, permissions, 'dashboard') !== next) return;
            savePreferences({
              ...preferences,
              shortcuts: preferences.shortcuts.includes(next)
                ? preferences.shortcuts.filter((item) => item !== next)
                : [...preferences.shortcuts, next],
            });
          }}
          onNavigate={(next) => {
            setFinderOwner(null);
            navigate(next);
            requestAnimationFrame(() =>
              document.getElementById('admin-main')?.focus({ preventScroll: true }),
            );
          }}
          onClose={closeFinder}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="admin-topbar-location">
            <button
              className="icon menu-toggle"
              onClick={() => setMenu(!menu)}
              aria-label="نمایش منو"
              aria-expanded={menu}
              aria-controls="admin-navigation"
            >
              <Menu size={21} />
            </button>
            <button
              type="button"
              className="icon admin-nav-toggle"
              onClick={() => {
                setCompact(!compact);
                writeCompactNavigation(!compact);
              }}
              aria-label={compact ? 'گسترش فهرست کناری' : 'جمع کردن فهرست کناری'}
              title={compact ? 'گسترش فهرست کناری' : 'جمع کردن فهرست کناری'}
              aria-expanded={!compact}
              aria-controls="admin-desktop-navigation"
            >
              {compact ? <PanelRightOpen size={19} /> : <PanelRightClose size={19} />}
            </button>
            <nav aria-label="مسیر فعلی" className="admin-breadcrumb">
              <button type="button" onClick={() => setPage('dashboard')}>
                مدیریت
              </button>
              <span aria-hidden="true">/</span>
              <strong aria-current="page">{current.label}</strong>
            </nav>
          </div>
          <div className="admin-topbar-actions">
            <button
              type="button"
              className="admin-finder-trigger"
              aria-label="رفتن به بخش"
              aria-haspopup="dialog"
              aria-keyshortcuts="Alt+K"
              onClick={openFinder}
            >
              <Search size={19} aria-hidden="true" />
              <span>رفتن به بخش</span>
              <kbd dir="ltr" aria-hidden="true">
                Alt + K
              </kbd>
            </button>
            <span className="environment">محیط محلی</span>
            <button
              type="button"
              className="icon"
              onClick={toggleColorMode}
              aria-label={mode === 'dark' ? 'فعال کردن تم روشن' : 'فعال کردن تم تاریک'}
              title={mode === 'dark' ? 'تم روشن' : 'تم تاریک'}
            >
              {mode === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              className="icon"
              aria-label="تازه‌سازی اطلاعات"
              title="تازه‌سازی اطلاعات"
              onClick={() => client.invalidateQueries({ queryKey: ['admin'] })}
            >
              <RefreshCw size={17} />
            </button>
            <a
              className="view-store"
              href={`${storefrontUrl}/fa`}
              target="_blank"
              rel="noreferrer"
              aria-label="مشاهده فروشگاه در زبانهٔ تازه"
            >
              مشاهده فروشگاه <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </div>
        </header>
        <main className="page" id="admin-main" tabIndex={-1}>
          {visiblePage !== 'dashboard' && (
            <AdminModuleHeader
              key={visiblePage}
              page={visiblePage}
              permissions={permissions}
              onNavigate={navigate}
            />
          )}
          <PageBoundary key={`${visiblePage}:${session.user.id}:${permissionRevision}`}>
            <Suspense fallback={<Busy />}>
              {visiblePage === 'dashboard' ? (
                <AdminDashboard
                  accountId={session.user.id}
                  displayName={session.user.displayName ?? 'مدیر فروشگاه'}
                  permissions={permissions}
                  preferences={preferences}
                  onSavePreferences={savePreferences}
                  onOpenFinder={openFinder}
                  onNavigate={navigate}
                />
              ) : visiblePage === 'used-items' ? (
                <UsedItemsPage
                  writable={can('catalog.write') && can('inventory.write')}
                  viewerId={session.user.id}
                  onProducts={() => setPage('products')}
                  onInventory={can('inventory.read') ? () => setPage('inventory') : undefined}
                />
              ) : visiblePage === 'accounting' ? (
                <AccountingPage
                  writable={can('catalog.write')}
                  inventoryReadable={can('inventory.read')}
                  inventoryWritable={can('inventory.write')}
                  viewerId={session.user.id}
                  onManageUnits={(source) => {
                    setUnitSource(source);
                    setPage('receiving');
                  }}
                />
              ) : visiblePage === 'products' ? (
                catalog.isPending ? (
                  <Busy />
                ) : catalog.error ? (
                  <ErrorBox error={catalog.error} />
                ) : (
                  <ProductsPage
                    data={catalog.data!}
                    methods={methods.data ?? []}
                    plans={plans.data ?? []}
                    writable={can('catalog.write')}
                    viewerId={session.user.id}
                    onInventory={can('inventory.read') ? () => setPage('inventory') : undefined}
                  />
                )
              ) : ['categories', 'attributes', 'brands'].includes(visiblePage) ? (
                catalog.isPending ? (
                  <Busy />
                ) : catalog.error ? (
                  <ErrorBox error={catalog.error} />
                ) : (
                  <CatalogPage
                    key={visiblePage}
                    kind={visiblePage as 'categories' | 'attributes' | 'brands'}
                    data={catalog.data!}
                    writable={can('catalog.write')}
                  />
                )
              ) : visiblePage === 'receiving' ? (
                <SourcingReceivingPage
                  viewerId={session.user.id}
                  writable={can('inventory.write')}
                  initialTab="mappings"
                  mappingsOnly
                  initialSource={unitSource}
                  onAccounting={can('catalog.read') ? () => setPage('accounting') : undefined}
                />
              ) : visiblePage === 'inventory' ? (
                <InventoryPage writable={can('inventory.write')} />
              ) : visiblePage === 'finance' ? (
                <FinancePage catalog={catalog.data} writable={can('finance.write')} />
              ) : visiblePage === 'credit-schedules' ? (
                <CreditSchedulesPage viewerId={session.user.id} writable={can('finance.write')} />
              ) : visiblePage === 'credit-requirements' ? (
                <CreditRequirementsPage
                  viewerId={session.user.id}
                  writable={can('finance.write')}
                />
              ) : visiblePage === 'credit-applications' ? (
                <CreditApplicationsPage viewerId={session.user.id} />
              ) : visiblePage === 'tickets' ? (
                <TicketsPage
                  viewerId={session.user.id}
                  writable={can('support.write')}
                  canPickProduct={can('catalog.read')}
                  canPublishQuestion={can('cms.write')}
                />
              ) : visiblePage === 'payments' ? (
                <PaymentsPage viewerId={session.user.id} />
              ) : visiblePage === 'charges' ? (
                <ChargesPage writable={can('finance.write')} />
              ) : visiblePage === 'returns' ? (
                <ReturnsPage viewerId={session.user.id} writable={can('sales.write')} />
              ) : visiblePage === 'orders' ? (
                <Suspense fallback={<Busy />}>
                  <OrdersPage
                    writable={can('sales.write')}
                    viewerId={session.user.id}
                    inventoryReadable={can('inventory.read')}
                    inventoryWritable={can('inventory.write')}
                  />
                </Suspense>
              ) : visiblePage === 'reviews' ? (
                <ReviewsPage writable={can('cms.write')} viewerId={session.user.id} />
              ) : visiblePage === 'content' ? (
                <ContentPage
                  catalogReadable={can('catalog.read')}
                  viewerId={session.user.id}
                  data={content.data}
                  dataLoading={content.isPending}
                  dataError={content.error}
                  onRetry={() => void content.refetch()}
                  settingsReadable={can('cms.read')}
                  writable={can('cms.write')}
                  draftWritable={can('cms.write') || can('cms.editor')}
                  activeSection={cmsSection}
                  onSectionChange={setCmsSection}
                  catalog={catalog.data}
                />
              ) : visiblePage === 'customers' ? (
                <CustomersPage viewerId={session.user.id} />
              ) : visiblePage === 'staff' ? (
                <StaffPage viewerId={session.user.id} writable={can('staff.write')} />
              ) : visiblePage === 'sms' ? (
                <SmsSettingsPage
                  viewerId={session.user.id}
                  onManageAuth={can('cms.read') ? () => openCms('settings') : undefined}
                />
              ) : visiblePage === 'security' ? (
                <SecurityPage onPasswordChanged={() => void logout()} />
              ) : (
                <AuditPage />
              )}
            </Suspense>
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}
