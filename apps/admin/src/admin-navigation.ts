import { normalizeAdminListText } from './admin-list-text.ts';
import { canAccessAdminPage } from './admin-page-access.ts';
import {
  LayoutDashboard,
  Package,
  Layers,
  Boxes,
  PanelTop,
  WalletCards,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
export type Page =
  | 'credit-schedules'
  | 'credit-requirements'
  | 'credit-applications'
  | 'tickets'
  | 'payments'
  | 'used-items'
  | 'reviews'
  | 'receiving'
  | 'sourcing'
  | 'accounting'
  | 'dashboard'
  | 'products'
  | 'market'
  | 'categories'
  | 'attributes'
  | 'brands'
  | 'inventory'
  | 'finance'
  | 'charges'
  | 'orders'
  | 'content'
  | 'audit'
  | 'security'
  | 'customers'
  | 'staff';
export const navigation: {
  id: Page;
  label: string;
  icon: typeof Package;
  permission?: string;
  requiredPermissions?: string[];
}[] = [
  {
    id: 'credit-schedules',
    label: 'سررسید و گردش چک‌ها',
    icon: WalletCards,
    permission: 'finance.read',
  },
  {
    id: 'credit-requirements',
    label: 'شرایط و مدارک خرید چکی',
    icon: WalletCards,
    permission: 'finance.read',
  },
  {
    id: 'credit-applications',
    label: 'پرونده‌های خرید چکی',
    icon: WalletCards,
    permission: 'credit.read',
  },
  { id: 'tickets', label: 'پشتیبانی و تیکت‌ها', icon: PanelTop, permission: 'support.read' },
  { id: 'used-items', label: 'کالای کارکرده و سلامت', icon: Package, permission: 'catalog.read' },
  { id: 'dashboard', label: 'نمای کلی', icon: LayoutDashboard },
  { id: 'products', label: 'کالاها و تنوع‌ها', icon: Package, permission: 'catalog.read' },
  { id: 'accounting', label: 'اتصال هلو', icon: Boxes, permission: 'catalog.read' },
  { id: 'market', label: 'کاتالوگ گوشی', icon: Package, permission: 'catalog.read' },
  { id: 'categories', label: 'دسته‌بندی‌ها', icon: Layers, permission: 'catalog.read' },
  { id: 'attributes', label: 'ویژگی‌های پویا', icon: Boxes, permission: 'catalog.read' },
  { id: 'brands', label: 'برندها', icon: Package, permission: 'catalog.read' },
  { id: 'inventory', label: 'موجودی و گردش انبار', icon: Boxes, permission: 'inventory.read' },
  { id: 'receiving', label: 'دریافت تأمین و واحدها', icon: Boxes, permission: 'inventory.read' },
  { id: 'finance', label: 'روش‌های خرید و چک', icon: WalletCards, permission: 'finance.read' },
  {
    id: 'payments',
    label: 'پرداخت‌ها و تطبیق مالی',
    icon: WalletCards,
    permission: 'finance.read',
    requiredPermissions: ['sales.read'],
  },
  { id: 'charges', label: 'ارسال و مالیات', icon: WalletCards, permission: 'finance.read' },
  { id: 'orders', label: 'سفارش‌ها و رزرو', icon: Package, permission: 'sales.read' },
  { id: 'sourcing', label: 'درخواست‌های تأمین', icon: Package, permission: 'sales.read' },
  { id: 'reviews', label: 'دیدگاه‌های مشتریان', icon: PanelTop, permission: 'cms.read' },
  { id: 'content', label: 'محتوا و تنظیمات', icon: PanelTop, permission: 'cms.read' },
  { id: 'customers', label: 'مشتریان فروشگاه', icon: UsersRound, permission: 'customers.read' },
  { id: 'staff', label: 'کارکنان و دسترسی‌ها', icon: ShieldCheck, permission: 'staff.read' },
  { id: 'security', label: 'امنیت حساب', icon: ShieldCheck },
  { id: 'audit', label: 'رویدادهای مدیریتی', icon: ShieldCheck, permission: 'audit.read' },
];

export const navigationGroups = [
  { id: 'overview', label: 'فضای کار', pages: ['dashboard'] },
  {
    id: 'sales',
    label: 'فروش و مشتریان',
    pages: ['orders', 'customers', 'sourcing', 'tickets', 'reviews'],
  },
  {
    id: 'catalog',
    label: 'کالا و انبار',
    pages: [
      'products',
      'market',
      'used-items',
      'inventory',
      'receiving',
      'categories',
      'attributes',
      'brands',
    ],
  },
  {
    id: 'finance',
    label: 'امور مالی',
    pages: [
      'credit-applications',
      'credit-schedules',
      'finance',
      'credit-requirements',
      'payments',
      'charges',
      'accounting',
    ],
  },
  { id: 'management', label: 'مدیریت و تنظیمات', pages: ['content', 'staff', 'audit', 'security'] },
] as const satisfies readonly { id: string; label: string; pages: readonly Page[] }[];

export const normalizeNavigationQuery = normalizeAdminListText;

export function filteredNavigationGroups(permissions: readonly string[], query: string) {
  const normalized = normalizeNavigationQuery(query);
  const allowed = navigation.filter((item) => canAccessAdminPage(item, permissions));
  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.pages.flatMap((id) => {
        const item = allowed.find((candidate) => candidate.id === id);
        return item &&
          (!normalized ||
            normalizeNavigationQuery(item.label).includes(normalized) ||
            normalizeNavigationQuery(group.label).includes(normalized))
          ? [item]
          : [];
      }),
    }))
    .filter((group) => group.items.length);
}
