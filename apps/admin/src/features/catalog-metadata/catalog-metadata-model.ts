import type { AttributeDefinition, Category, Translation } from '../../types/types';
export type MetadataKind = 'categories' | 'attributes' | 'brands';

export const attributeTypeLabels: Record<AttributeDefinition['dataType'], string> = {
  Text: 'متن',
  Number: 'عدد',
  Bool: 'بله / خیر',
  Select: 'تک‌انتخابی',
  MultiSelect: 'چندانتخابی',
};
export const hasOptions = (type: AttributeDefinition['dataType']) =>
  type === 'Select' || type === 'MultiSelect';

export const metadataName = (item: { translations: Translation[] }, fallback: string) =>
  item.translations.find((tr) => tr.locale === 'fa')?.name ||
  item.translations.find((tr) => tr.locale === 'en')?.name ||
  fallback;

export function metadataTranslations(value: Translation[] = []): Translation[] {
  return (['fa', 'en'] as const).map((locale) => ({
    locale,
    name: '',
    description: '',
    ...value.find((item) => item.locale === locale),
  }));
}

export function categoryParentOptions(categories: Category[], currentId?: string) {
  const parents = new Map(categories.map((item) => [item.id, item.parentId]));
  return categories.filter((item) => {
    const visited = new Set([currentId]);
    let id: string | undefined = item.id;
    while (id) {
      if (visited.has(id) || !parents.has(id)) return false;
      visited.add(id);
      id = parents.get(id);
    }
    return true;
  });
}

export function metadataIdentifierError(value: string, available: boolean) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 150)
    return 'حروف کوچک انگلیسی و عدد وارد کنید. کلمه‌ها را با خط تیره جدا کنید.';
  return available ? undefined : 'این شناسه قبلاً استفاده شده است.';
}

type Option = AttributeDefinition['options'][number];
export function metadataOptions(
  type: AttributeDefinition['dataType'],
  options: readonly Option[],
): Option[] {
  return hasOptions(type)
    ? options.map((option, sortOrder) => ({
        ...option,
        value: option.value.trim(),
        labelFa: option.labelFa.trim(),
        labelEn: option.labelEn.trim(),
        sortOrder,
      }))
    : [];
}
