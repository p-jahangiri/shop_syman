import { ArrowUpRight, Boxes, Layers, Package, ShieldCheck, WalletCards } from 'lucide-react';
import { navigation, type Page } from './admin-navigation';
import { canAccessAdminPage } from './admin-page-access';
import { formatAdminCount } from './inventory-contract';
import { ErrorBox } from './ui';

type Props = {
  displayName: string;
  permissions: readonly string[];
  products?: string;
  categories?: string;
  availableVariants?: string;
  enabledPlans?: string;
  errors: readonly unknown[];
  onNavigate: (page: Page) => void;
};
const actions: { page: Page; description: string }[] = [
  { page: 'orders', description: 'بررسی سفارش‌ها، رزرو و تحویل' },
  { page: 'products', description: 'ثبت کالا، تنوع و مشخصات' },
  { page: 'inventory', description: 'ماندهٔ انبار و گردش موجودی' },
  { page: 'sourcing', description: 'پیگیری انتخاب و تأمین مشتری' },
  { page: 'market', description: 'مدل‌های گوشی، رنگ و حافظه' },
  { page: 'credit-schedules', description: 'سررسید و وضعیت چک‌ها' },
];
export function AdminDashboard(props: Props) {
  const stats = [
    { label: 'کالای ثبت‌شده', value: props.products, icon: Package, permission: 'catalog.read' },
    { label: 'دسته‌بندی', value: props.categories, icon: Layers, permission: 'catalog.read' },
    {
      label: 'ردیف انبار با ماندهٔ آزاد',
      value: props.availableVariants,
      icon: Boxes,
      permission: 'inventory.read',
    },
    {
      label: 'طرح خرید چکی فعال',
      value: props.enabledPlans,
      icon: WalletCards,
      permission: 'finance.read',
    },
  ].filter((stat) => props.permissions.includes(stat.permission));
  return (
    <>
      <section className="welcome" aria-label="خوش‌آمدگویی">
        <div>
          <span className="dashboard-kicker">مدیریت روزانه، در یک نگاه</span>
          <h2>سلام، {props.displayName}</h2>
          <p>از کالا و موجودی تا سفارش و ارتباط با مشتری؛ بخش موردنیازتان را انتخاب کنید.</p>
        </div>
        <ShieldCheck size={52} aria-hidden="true" />
      </section>
      {stats.length > 0 && (
        <div className="stats">
          {stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <span className="stat-heading">
                <small>{stat.label}</small>
                <stat.icon size={17} aria-hidden="true" />
              </span>
              <strong>{formatAdminCount(stat.value)}</strong>
              <span className="stat-source">بر اساس اطلاعات ثبت‌شده</span>
            </div>
          ))}
        </div>
      )}
      {props.errors.filter(Boolean).map((error, index) => (
        <ErrorBox key={index} error={error} />
      ))}
      <section className="panel dashboard-actions">
        <div className="section-heading">
          <div>
            <h2>کارهای روزانه</h2>
            <p>دسترسی مستقیم به عملیات فروشگاه</p>
          </div>
          <span className="badge">فضای کار شما</span>
        </div>
        <div className="quick-actions">
          {actions.map((action) => {
            const item = navigation.find((candidate) => candidate.id === action.page)!;
            return canAccessAdminPage(item, props.permissions) ? (
              <button type="button" key={item.id} onClick={() => props.onNavigate(item.id)}>
                <item.icon size={22} aria-hidden="true" />
                <span>
                  <strong>{item.label}</strong>
                  <small>{action.description}</small>
                </span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </button>
            ) : null;
          })}
        </div>
        {!actions.some((action) =>
          canAccessAdminPage(
            navigation.find((item) => item.id === action.page)!,
            props.permissions,
          ),
        ) && <p className="empty">بخش‌های مجاز حساب شما در فهرست مدیریت در دسترس‌اند.</p>}
      </section>
      <section className="dashboard-footnote">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>
          عملیات هر بخش بر اساس سطح دسترسی حساب شما در دسترس است. تنظیمات خرید، ارسال و پرداخت از
          بخش‌های مربوط مدیریت می‌شوند.
        </p>
      </section>
    </>
  );
}
