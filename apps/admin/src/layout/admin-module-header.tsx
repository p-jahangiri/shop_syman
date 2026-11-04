import { ArrowUpLeft } from 'lucide-react';
import { AdminPageHelp } from './admin-page-help';
import { navigation, navigationGroups, type Page } from './admin-navigation';
import { canAccessAdminPage } from '../auth/admin-page-access';
import '../styles/admin-module-header.css';

const shortcuts: Partial<Record<Page, readonly Page[]>> = {
  products: ['inventory', 'categories', 'attributes'],
  'used-items': ['products', 'inventory'],
  inventory: ['products', 'receiving'],
  receiving: ['accounting', 'inventory'],
  categories: ['attributes', 'products'],
  brands: ['products', 'categories'],
  attributes: ['categories', 'products'],
  orders: ['returns', 'payments', 'customers'],
  returns: ['orders', 'tickets'],
  customers: ['orders', 'tickets', 'reviews'],
  tickets: ['customers', 'orders'],
  reviews: ['products', 'customers'],
  'credit-applications': ['credit-requirements', 'credit-schedules'],
  'credit-schedules': ['credit-applications', 'finance'],
  finance: ['credit-requirements', 'charges', 'payments'],
  'credit-requirements': ['credit-applications', 'finance'],
  payments: ['orders', 'charges'],
  charges: ['orders', 'finance'],
  accounting: ['receiving', 'inventory'],
  content: ['products', 'reviews'],
  staff: ['audit', 'security'],
  audit: ['staff', 'security'],
  sms: ['tickets', 'security'],
  security: ['staff', 'audit'],
};

const groupCopy = {
  overview: '',
  sales: 'پیگیری سفارش، خدمات و تجربهٔ مشتری',
  catalog: 'مدیریت اطلاعات کالا و ماندهٔ قابل فروش',
  finance: 'بررسی وضعیت مالی و پیگیری اقدام‌ها',
  management: 'تنظیم فروشگاه و کنترل دسترسی',
};

export function AdminModuleHeader({
  page,
  permissions,
  onNavigate,
}: {
  page: Page;
  permissions: readonly string[];
  onNavigate: (page: Page) => void;
}) {
  const current = navigation.find((item) => item.id === page);
  const group = navigationGroups.find((item) => (item.pages as readonly Page[]).includes(page));
  if (!current || !group) return null;
  const Icon = current.icon;
  const related = (shortcuts[page] ?? []).flatMap((id) => {
    const entry = navigation.find((item) => item.id === id);
    return entry && canAccessAdminPage(entry, permissions) ? [entry] : [];
  });
  return (
    <header className="admin-module-header" data-module={group.id}>
      <div className="admin-module-main">
        <div className="admin-module-icon">
          <Icon size={24} aria-hidden="true" />
        </div>
        <div className="admin-module-copy">
          <p className="admin-module-kicker">{group.label}</p>
          <h1 id="admin-workspace-title">{current.label}</h1>
          <p className="admin-module-context">{groupCopy[group.id]}</p>
        </div>
        <AdminPageHelp page={page} title={current.label} />
      </div>
      {related.length > 0 && (
        <nav className="admin-module-related" aria-label="مسیرهای مرتبط">
          <span aria-hidden="true">دسترسی مرتبط</span>
          {related.map((item) => (
            <button key={item.id} type="button" onClick={() => onNavigate(item.id)}>
              {item.label}
              <ArrowUpLeft size={15} aria-hidden="true" />
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
