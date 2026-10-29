import { resolveAppearance } from '../../storefront/lib/appearance';
import type { SiteAppearance } from '../../storefront/lib/types';
import { appearanceChoices, setAppearanceChoice } from './cms-appearance-model';
import { Check, Field } from './ui';
import './cms-appearance.css';

export function CmsAppearanceEditor({
  value,
  onChange,
  name,
}: {
  value?: SiteAppearance;
  onChange: (value: SiteAppearance | undefined) => void;
  name: string;
}) {
  const appearance = resolveAppearance(value);
  return (
    <fieldset className="cms-appearance-editor">
      <legend>طراحی و رفتار فروشگاه</legend>
      <p>
        ظاهر این زبان را تنظیم کنید. ابتدا پیش‌نویس را ذخیره و سپس همان سند را منتشر کنید؛ ذخیره
        به‌تنهایی فروشگاه عمومی را تغییر نمی‌دهد.
      </p>
      <div className="cms-appearance-layout">
        <div>
          <div className="form-grid">
            {appearanceChoices.map((choice) => (
              <Field key={choice.key} label={choice.label} hint={choice.hint}>
                <select
                  value={appearance[choice.key]}
                  onChange={(event) =>
                    onChange(setAppearanceChoice(value, choice.key, event.target.value))
                  }
                >
                  {choice.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Check
            label="هدر هنگام پیمایش در دسترس بماند"
            checked={appearance.stickyHeader}
            onChange={(event) => onChange({ ...value, stickyHeader: event.target.checked })}
          />
          <button type="button" onClick={() => onChange(undefined)}>
            بازگشت طراحی به پیش‌فرض
          </button>
        </div>
        <figure className="cms-appearance-preview">
          <div
            className="cms-appearance-canvas"
            data-surface={appearance.surface}
            data-density={appearance.density}
            data-corners={appearance.corners}
            data-motion={appearance.motion}
            data-hero-layout={appearance.heroLayout}
            aria-hidden="true"
          >
            <div className="cms-appearance-topbar">
              <b>{name}</b>
              <span>{appearance.stickyHeader ? 'هدر در دسترس' : 'هدر معمولی'}</span>
            </div>
            <div className="cms-appearance-hero">
              <div>
                <small>انتخابی ساده، با خیال راحت</small>
                <strong>فروشگاه شما، با طراحی دلخواه</strong>
                <span className="cms-appearance-action">دیدن کالاها</span>
              </div>
              <div className="cms-appearance-art">
                <span />
              </div>
            </div>
            <div className="cms-appearance-products">
              {[1, 2, 3].map((id) => (
                <div className="cms-appearance-product" key={id}>
                  <span />
                  <b />
                  <small />
                </div>
              ))}
            </div>
          </div>
          <figcaption>
            پیش‌نمایش شماتیک فاصله، سطح و چیدمان؛ نمایش نهایی را پس از انتشار در هر دو اندازهٔ
            موبایل و دسکتاپ بررسی کنید. رنگ، لوگو، متن و تصویر از تنظیمات همان سند می‌آیند.
          </figcaption>
        </figure>
      </div>
      <small>
        تنظیمات هر زبان مستقل است. دسترسی به تغییر طراحی به مجوز مدیریت محتوا نیاز دارد. کاهش حرکت و
        کنتراست خوانا حفظ می‌شوند؛ افزودن CSS یا اسکریپت دلخواه مجاز نیست.
      </small>
    </fieldset>
  );
}
