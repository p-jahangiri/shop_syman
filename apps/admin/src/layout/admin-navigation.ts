import { normalizeAdminListText } from '../utils/admin-list-text.ts';
import { canAccessAdminPage } from '../auth/admin-page-access.ts';
import {
  LayoutDashboard,
  Package,
  Layers,
  Boxes,
  PanelTop,
  CreditCard,
  CalendarClock,
  Files,
  FileCheck2,
  ReceiptText,
  Calculator,
  Network,
  ShieldCheck,
  UsersRound,
  MessageSquare,
  RotateCcw,
  ClipboardList,
  ContactRound,
  MessagesSquare,
  PackageCheck,
  Star,
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
  | 'accounting'
  | 'dashboard'
  | 'products'
  | 'categories'
  | 'attributes'
  | 'brands'
  | 'inventory'
  | 'finance'
  | 'charges'
  | 'orders'
  | 'returns'
  | 'content'
  | 'audit'
  | 'security'
  | 'sms'
  | 'customers'
  | 'staff';
export const navigation: {
  id: Page;
  label: string;
  icon: typeof Package;
  permission?: string;
  requiredPermissions?: string[];
  anyPermissions?: string[];
}[] = [
  {
    id: 'credit-schedules',
    label: 'سررسید و گردش چک‌ها',
    icon: CalendarClock,
    permission: 'finance.read',
  },
  {
    id: 'credit-requirements',
    label: 'شرایط و مدارک خرید چکی',
    icon: FileCheck2,
    permission: 'finance.read',
  },
  {
    id: 'credit-applications',
    label: 'پرونده‌های خرید چکی',
    icon: Files,
    permission: 'credit.read',
  },
  { id: 'tickets', label: 'پشتیبانی و تیکت‌ها', icon: MessagesSquare, permission: 'support.read' },
  { id: 'used-items', label: 'کالای کارکرده و سلامت', icon: Package, permission: 'catalog.read' },
  { id: 'dashboard', label: 'نمای کلی', icon: LayoutDashboard },
  { id: 'products', label: 'کالاها و تنوع‌ها', icon: Package, permission: 'catalog.read' },
  { id: 'accounting', label: 'اتصال هلو', icon: Network, permission: 'catalog.read' },
  { id: 'categories', label: 'دسته‌بندی‌ها', icon: Layers, permission: 'catalog.read' },
  { id: 'attributes', label: 'ویژگی‌های پویا', icon: Boxes, permission: 'catalog.read' },
  { id: 'brands', label: 'برندها', icon: Package, permission: 'catalog.read' },
  { id: 'inventory', label: 'موجودی و گردش انبار', icon: Boxes, permission: 'inventory.read' },
  { id: 'receiving', label: 'نگاشت واحدهای هلو', icon: Boxes, permission: 'inventory.read' },
  { id: 'finance', label: 'روش‌های خرید و چک', icon: CreditCard, permission: 'finance.read' },
  {
    id: 'payments',
    label: 'پرداخت‌ها و تطبیق مالی',
    icon: ReceiptText,
    permission: 'finance.read',
    requiredPermissions: ['sales.read'],
  },
  { id: 'charges', label: 'ارسال و مالیات', icon: Calculator, permission: 'finance.read' },
  { id: 'orders', label: 'سفارش‌ها و رزرو', icon: PackageCheck, permission: 'sales.read' },
  { id: 'returns', label: 'درخواست‌های مرجوعی', icon: RotateCcw, permission: 'sales.read' },
  { id: 'reviews', label: 'دیدگاه‌های مشتریان', icon: Star, permission: 'cms.read' },
  {
    id: 'content',
    label: 'محتوا و تنظیمات',
    icon: PanelTop,
    anyPermissions: ['cms.read', 'cms.editor'],
  },
  { id: 'customers', label: 'مشتریان فروشگاه', icon: UsersRound, permission: 'customers.read' },
  { id: 'staff', label: 'کارکنان و دسترسی‌ها', icon: ContactRound, permission: 'staff.read' },
  { id: 'sms', label: 'پیامک و کد ورود', icon: MessageSquare, permission: 'staff.write' },
  { id: 'security', label: 'امنیت حساب', icon: ShieldCheck },
  { id: 'audit', label: 'رویدادهای مدیریتی', icon: ClipboardList, permission: 'audit.read' },
];

export const navigationGroups = [
  { id: 'overview', label: 'فضای کار', pages: ['dashboard'] },
  {
    id: 'sales',
    label: 'فروش و مشتریان',
    pages: ['orders', 'returns', 'customers', 'tickets', 'reviews'],
  },
  {
    id: 'catalog',
    label: 'کالا و انبار',
    pages: [
      'products',
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
  {
    id: 'management',
    label: 'مدیریت و تنظیمات',
    pages: ['content', 'staff', 'sms', 'audit', 'security'],
  },
] as const satisfies readonly { id: string; label: string; pages: readonly Page[] }[];

export const normalizeNavigationQuery = normalizeAdminListText;

const navigationAliases: Partial<Record<Page, string>> = {
  dashboard: 'داشبورد میز کار',
  products: 'محصول کاتالوگ قیمت SKU',
  'used-items': 'دست دوم گزارش سلامت',
  inventory: 'موجودی انبار کسری تامین',
  orders: 'فروش ارسال تحویل سفارش',
  returns: 'بازگشت کالا عودت',
  tickets: 'صندوق پاسخ مشتری پشتیبانی',
  'credit-schedules': 'سررسید اقساط چک',
  content: 'ظاهر رنگ بنر منو مقاله صفحه سایت CMS',
  sms: 'پیامک OTP',
  staff: 'همکار نقش مجوز کارکنان',
  security: 'رمز احراز دومرحله‌ای MFA',
  audit: 'گزارش تاریخچه فعالیت',
};

export function filteredNavigationGroups(permissions: readonly string[], query: string) {
  const terms = normalizeNavigationQuery(query).split(' ').filter(Boolean);
  const allowed = navigation.filter((item) => canAccessAdminPage(item, permissions));
  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.pages.flatMap((id) => {
        const item = allowed.find((candidate) => candidate.id === id);
        if (!item) return [];
        const searchable = normalizeNavigationQuery(
          [item.label, group.label, navigationAliases[item.id]].filter(Boolean).join(' '),
        );
        return terms.every((term) => searchable.includes(term)) ? [item] : [];
      }),
    }))
    .filter((group) => group.items.length);
}
