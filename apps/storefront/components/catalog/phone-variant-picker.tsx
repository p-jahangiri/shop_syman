import { Check } from 'lucide-react';
import { useI18n } from '../navigation/locale-provider';
import { groupNavigation } from '../shared/ui';
import {
  choosePhoneConfiguration,
  type phoneConfigurations,
} from '@/lib/catalog/phone-configurations';
import type { Variant } from '@sayman/web-shared/lib/shared/types.ts';
import './phone-variant-picker.css';

type Configurations = NonNullable<ReturnType<typeof phoneConfigurations>>;

export function PhoneConfigurationOptions({
  configurations,
  selected,
  attributeLabels,
  onSelect,
}: {
  configurations: Configurations;
  selected: Variant;
  attributeLabels: Record<string, string>;
  onSelect: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const fa = locale === 'fa';
  const title = configurations.isPhone
    ? fa
      ? 'نسخهٔ گوشی'
      : 'Phone configuration'
    : fa
      ? 'نسخهٔ کالا'
      : 'Product configuration';
  const { groups, configurationKeys } = configurations;
  if (groups.length < 2) return null;

  return (
    <div className="phone-configuration">
      <h2>{title}</h2>
      <div
        className="phone-configuration-options"
        role="radiogroup"
        tabIndex={-1}
        aria-label={title}
        onKeyDown={groupNavigation}
      >
        {groups.map((group) => {
          const active = group.variants.some((variant) => variant.id === selected.id);
          return (
            <button
              key={group.id}
              id={`phone-configuration-${group.id}`}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                if (!active) onSelect(choosePhoneConfiguration(group.variants, selected).id);
              }}
            >
              {configurationKeys.map((key) => (
                <span key={key}>
                  <small>{t(attributeLabels[key] ?? key)}</small>
                  <bdi>{t(group.specs[key] || '—')}</bdi>
                </span>
              ))}
              {active && <Check size={15} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PhoneColorOptions({
  variants,
  selected,
  onSelect,
}: {
  variants: Variant[];
  selected: Variant;
  onSelect: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const fa = locale === 'fa';
  const title = fa ? 'رنگ' : 'Color';
  return (
    <div className="phone-color-picker">
      <h2>
        <span
          className="selected-color-dot"
          style={{ backgroundColor: selected.color }}
          aria-hidden="true"
        />
        {fa ? 'رنگ انتخابی:' : 'Selected color:'} <bdi>{t(selected.colorName)}</bdi>
      </h2>
      <div
        className="phone-color-options"
        role="radiogroup"
        tabIndex={-1}
        aria-label={title}
        onKeyDown={groupNavigation}
      >
        {variants.map((variant) => {
          const active = variant.id === selected.id;
          return (
            <button
              id={`product-variant-${variant.id}`}
              key={variant.id}
              type="button"
              role="radio"
              tabIndex={active ? 0 : -1}
              aria-checked={active}
              aria-label={t(variant.colorName)}
              title={t(variant.colorName)}
              data-sold-out={variant.stock <= 0 || undefined}
              onClick={() => {
                if (!active) onSelect(variant.id);
              }}
            >
              <span className="phone-color-sample" aria-hidden="true">
                <span style={{ backgroundColor: variant.color }} />
                {active && <Check size={13} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
