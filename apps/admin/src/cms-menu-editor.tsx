import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Field } from './ui';
import type { Category, PurchaseMethod } from './types';
import { CmsPurchaseDependencyField } from './cms-purchase-dependency-field';

export interface CmsMenuItem {
  purchaseMethodKind?: PurchaseMethod['kind'];
  label: string;
  href: string;
  children?: CmsMenuItem[];
}
interface Destination {
  href: string;
  label: string;
  hint: string;
}
const routes = [
  ['/market', 'گوشی‌های بازار', 'Market phones'],
  ['/sourcing', 'درخواست‌های تأمین', 'Sourcing requests'],
  ['/moments', 'لحظهٔ سایمان', 'Sayman moments'],
  ['/catalog', 'همهٔ محصولات', 'All products'],
  ['/compare', 'مقایسهٔ محصولات', 'Compare products'],
  ['/installments', 'خرید چکی', 'Cheque purchases'],
  ['/support', 'راهنما و پشتیبانی', 'Help and support'],
] as const;

export function CmsMenuEditor({
  value,
  onChange,
  locale,
  categories = [],
  depth = 0,
}: {
  value: CmsMenuItem[];
  onChange: (value: CmsMenuItem[]) => void;
  locale: 'fa' | 'en';
  categories?: Category[];
  depth?: number;
}) {
  const [addition, setAddition] = useState('/market');
  const destinations: Destination[] = [
    ...routes.map(([href, fa, en]) => ({ href, label: locale === 'en' ? en : fa, hint: fa })),
    ...categories
      .filter((c) => c.isActive)
      .flatMap((c) => {
        const label = c.translations.find((t) => t.locale === locale)?.name;
        return label?.trim()
          ? [
              {
                href: `/catalog?category=${encodeURIComponent(c.slug)}`,
                label,
                hint: `دسته: ${label}`,
              },
            ]
          : [];
      }),
  ];
  function update(index: number, patch: Partial<CmsMenuItem>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function move(index: number, direction: number) {
    const next = [...value];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  const full = value.length >= 50;
  return (
    <div className="menu-editor cms-menu-editor">
      {depth === 0 && (
        <p className="muted">
          بازار، لحظهٔ سایمان یا دستهٔ دلخواه را به منو اضافه کنید. ترتیب این فهرست در منوی دسکتاپ،
          موبایل و فوتر یکسان است. تغییرات پس از ذخیره و انتشار همین زبان دیده می‌شوند.
        </p>
      )}
      {value.map((item, index) => {
        const title = item.label || `آیتم ${index + 1}`;
        return (
          <fieldset key={index}>
            <legend>
              {index + 1}. {title}
            </legend>
            <div className="cms-menu-controls">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`بالا بردن ${title}`}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`پایین بردن ${title}`}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={`حذف ${title}`}
              >
                <Trash2 size={15} />
                حذف
              </button>
            </div>
            <div className="form-grid">
              <Field label="عنوان منو">
                <input
                  required
                  maxLength={150}
                  value={item.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                />
              </Field>
              <Field label="انتخاب مقصد">
                <select
                  value={destinations.some((d) => d.href === item.href) ? item.href : ''}
                  onChange={(e) => {
                    const destination = destinations.find((d) => d.href === e.target.value);
                    if (destination)
                      update(index, {
                        href: destination.href,
                        ...(!item.label.trim() ? { label: destination.label } : {}),
                      });
                    else update(index, { href: '' });
                  }}
                >
                  <option value="">مسیر سفارشی</option>
                  {destinations.map((d) => (
                    <option key={d.href} value={d.href}>
                      {d.hint}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <CmsPurchaseDependencyField
              label={`وابستگی نمایش «${title}» به نوع خرید`}
              value={item.purchaseMethodKind}
              onChange={(purchaseMethodKind) => update(index, { purchaseMethodKind })}
            />
            <Field
              label="مسیر داخلی"
              hint="مسیر بدون پیشوند fa یا en وارد شود؛ فروشگاه زبان جاری را حفظ می‌کند. تغییر مقصد، عنوان یا زیرمنوهای شما را حذف نمی‌کند."
            >
              <input
                required
                dir="ltr"
                maxLength={1500}
                value={item.href}
                onChange={(e) => update(index, { href: e.target.value })}
              />
            </Field>
            {depth < 3 && (
              <CmsMenuEditor
                value={item.children ?? []}
                locale={locale}
                categories={categories}
                depth={depth + 1}
                onChange={(children) => update(index, { children })}
              />
            )}
          </fieldset>
        );
      })}
      <div className="cms-menu-add">
        <Field label={depth ? 'مقصد زیرمنوی جدید' : 'مقصد آیتم جدید'}>
          <select value={addition} onChange={(e) => setAddition(e.target.value)}>
            <option value="custom">مسیر سفارشی</option>
            {destinations.map((d) => (
              <option key={d.href} value={d.href}>
                {d.hint}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          disabled={full}
          onClick={() => {
            const destination = destinations.find((d) => d.href === addition);
            onChange([
              ...value,
              { label: destination?.label ?? '', href: destination?.href ?? '/catalog' },
            ]);
          }}
        >
          <Plus size={15} />
          {depth ? 'افزودن زیرمنو' : 'افزودن آیتم منو'}
        </button>
        {full && <small role="status">حداکثر ۵۰ آیتم در هر سطح منو مجاز است.</small>}
      </div>
    </div>
  );
}
