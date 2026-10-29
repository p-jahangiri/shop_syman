import type { UsedCondition } from './used-condition-contract';
export type CategoryKey = string;
export type MoneyRial = `${bigint}`;
export interface Variant {
  usedCondition?: UsedCondition;
  id: string;
  sku: string;
  label: string;
  color: string;
  colorName: string;
  priceRial: MoneyRial;
  compareAtRial?: MoneyRial;
  stock: number;
  warranty: string;
  attributes?: Record<string, string>;
  purchaseMethodIds?: string[];
}
export interface Product {
  id: string;
  slug: string;
  name: string;
  englishName: string;
  category: CategoryKey;
  brand: string;
  description: string;
  image: string;
  images?: string[];
  badge?: string;
  isDigital?: boolean;
  featured?: boolean;
  attributes: Record<string, string>;
  variants: Variant[];
  purchaseMethodIds: string[];
  chequePlanIds?: string[];
}
export interface Category {
  key: CategoryKey;
  name: string;
  description: string;
  image: string;
  filters: { key: string; label: string }[];
  attributeRules?: {
    key: string;
    comparable: boolean;
    showInSpecs: boolean;
    variantAxis: boolean;
  }[];
}
export interface CartLine {
  variantId: string;
  quantity: number;
}
export interface ChequePlan {
  roundingUnitRial?: '1' | '10';
  id: string;
  months: number;
  markupPercent: number;
  downPaymentPercent: number;
  intervalMonths: number;
  enabled?: boolean;
  name?: string;
  categoryIds?: string[];
  minAmountRial?: MoneyRial;
  maxAmountRial?: MoneyRial;
}
export type Locale = 'fa' | 'en';
export interface PurchaseMethod {
  id: string;
  kind: 'online' | 'cheque' | 'installment';
  name: string;
  description: string;
  enabled: boolean;
  requiresApproval: boolean;
  categoryIds?: string[];
  minAmountRial?: MoneyRial;
  maxAmountRial?: MoneyRial;
}
export interface AuthSettings {
  mobileOtp: boolean;
  emailPassword: boolean;
  usernamePassword: boolean;
  registration: boolean;
  passwordReset: boolean;
}
export interface AttributeDefinition {
  key: string;
  name: string;
  dataType: 'text' | 'number' | 'bool' | 'select' | 'multiSelect';
  unit?: string;
  comparable: boolean;
  filterable: boolean;
  showInSpecs?: boolean;
}
export interface MenuItem {
  label: string;
  href: string;
  children?: MenuItem[];
}
export interface PromoContent {
  eyebrow: string;
  title: string;
  action: string;
  href: string;
  image: string;
  watermark?: string;
}
export interface HomeBlock {
  id: string;
  kind: 'categories' | 'collection' | 'promotions' | 'products' | 'spotlight' | 'brands' | 'cheque';
  enabled: boolean;
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: string;
  href?: string;
  categoryId?: string;
  limit?: number;
  productIds?: string[];
  items?: PromoContent[];
  startsAt?: string;
  endsAt?: string;
}
export interface SiteContent {
  name: string;
  latinName: string;
  tagline: string;
  announcement: string;
  seo?: { title?: string; description?: string; shareImage?: string; allowIndexing?: boolean };
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    action: string;
    secondary: string;
    image?: string;
    actionHref?: string;
    secondaryHref?: string;
    visualTitle?: string;
    floatingTitle?: string;
    floatingDescription?: string;
    footnote?: string;
  };
  nav: MenuItem[];
  homeBlocks?: HomeBlock[];
  chequeDisclaimer: string;
  about: string;
  logoUrl?: string;
  font?: 'vazirmatn' | 'system';
  palette?: { primaryLight?: string; primaryDark?: string; heroLight?: string; heroDark?: string };
  contact?: { phone?: string; email?: string; address?: string; hours?: string };
}
export interface StorefrontSnapshot {
  version: number;
  isPreview: boolean;
  dataSource?: 'api' | 'fixture';
  locale?: Locale;
  site: SiteContent;
  products: Product[];
  categories: Category[];
  chequePlans: ChequePlan[];
  purchaseMethods: PurchaseMethod[];
  authSettings: AuthSettings;
  attributeDefinitions: AttributeDefinition[];
  attributeLabels: Record<string, string>;
}
