export interface Translation {
  locale: 'fa' | 'en';
  name: string;
  description: string;
  badge?: string;
}
export interface Versioned {
  id: string;
  version: string;
  updatedAt?: string;
}
export interface AttributeValue {
  attributeId: string;
  valueTextFa?: string;
  valueTextEn?: string;
  valueNumber?: number;
  valueBool?: boolean;
  valueOptionId?: string;
  selections?: { optionId: string }[];
}
export interface AttributeDefinition extends Versioned {
  key: string;
  dataType: 'Text' | 'Number' | 'Bool' | 'Select' | 'MultiSelect';
  unit?: string;
  translations: Translation[];
  options: { id: string; value: string; labelFa: string; labelEn: string; sortOrder: number }[];
}
export interface CategoryAttribute {
  attributeId: string;
  isRequired: boolean;
  isFilterable: boolean;
  isComparable: boolean;
  showInSpecs: boolean;
  isVariantAxis: boolean;
  sortOrder: number;
  groupName: string;
}
export interface Category extends Versioned {
  slug: string;
  parentId?: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  translations: Translation[];
  attributes: CategoryAttribute[];
}
export interface Brand extends Versioned {
  name: string;
  slug: string;
  logoUrl: string;
  isActive: boolean;
}
export interface Variant extends Versioned {
  sku: string;
  priceRial: string;
  compareAtPriceRial?: string;
  color: string;
  colorNameFa: string;
  colorNameEn: string;
  labelFa: string;
  labelEn: string;
  warrantyFa: string;
  warrantyEn: string;
  isActive: boolean;
  attributes: AttributeValue[];
  purchaseMethods: { methodId: string }[];
}
export interface Product extends Versioned {
  slug: string;
  categoryId: string;
  brandId: string;
  status: 'Draft' | 'Published' | 'Hidden';
  isDigital: boolean;
  featured: boolean;
  translations: Translation[];
  attributes: AttributeValue[];
  variants: Variant[];
  media: { url: string; sortOrder: number }[];
  purchaseMethods: { methodId: string }[];
  creditPlans: { planId: string }[];
}
export interface Catalog {
  categories: Category[];
  brands: Brand[];
  attributes: AttributeDefinition[];
  products: Product[];
}
export interface PurchaseMethod extends Versioned {
  kind: 'online' | 'cheque' | 'installment';
  nameFa: string;
  nameEn: string;
  descriptionFa: string;
  descriptionEn: string;
  enabled: boolean;
  requiresApproval: boolean;
  minAmountRial?: string;
  maxAmountRial?: string;
  categories: { categoryId: string }[];
}
export interface ChequePlan extends Versioned {
  roundingUnitRial: number;
  nameFa: string;
  nameEn: string;
  months: number;
  markupBasisPoints: number;
  downPaymentBasisPoints: number;
  intervalMonths: number;
  enabled: boolean;
  minAmountRial?: string;
  maxAmountRial?: string;
  categories: { categoryId: string }[];
}
export interface Inventory {
  stock: { variantId: string; onHand: number; reserved: number; version: string }[];
  movements: {
    id: string;
    variantId: string;
    delta: number;
    balance: number;
    reason: string;
    actorId: string;
    at: string;
  }[];
}
export interface ContentDocument {
  key: 'site' | 'auth' | 'support';
  locale: 'fa' | 'en';
  draftJson: string;
  publishedJson?: string;
  version: string;
  revision: number;
  updatedAt: string;
}
export interface Content {
  documents: ContentDocument[];
  revisions: {
    id: string;
    key: string;
    locale: string;
    revision: number;
    publishedAt: string;
    publishedBy: string;
  }[];
}
export interface Session {
  accessToken: string;
  expiresIn: number;
  requiresMfa: boolean;
  requiresEnrollment: boolean;
  requiresRecovery?: boolean;
  requiresPasswordChange?: boolean;
  user: { id: string; displayName: string; userName: string; permissions?: string[] };
}
export const nameOf = (x: { translations: Translation[] } | undefined) =>
  x?.translations.find((t) => t.locale === 'fa')?.name ?? '—';
export const emptyTranslations = (): Translation[] => [
  { locale: 'fa', name: '', description: '' },
  { locale: 'en', name: '', description: '' },
];
