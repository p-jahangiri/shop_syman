import { useState } from 'react';
import { resolveAppearance } from '@sayman/web-shared/lib/content/appearance.ts';
import type { SiteAppearance, SiteContent } from '@sayman/web-shared/lib/shared/types.ts';
import {
  type AppearanceChoice,
  layoutAppearanceChoices,
  motionAppearanceChoices,
  setAppearanceChoice,
} from './cms-appearance-model';
import { Check, Field } from '../../components/ui';
import '../../styles/content/cms-appearance.css';

const motionTargets = [
  { key: 'motionBanners', label: 'بنرها' },
  { key: 'motionCards', label: 'کارت‌های کالا' },
  { key: 'motionSidebar', label: 'پنل فیلتر' },
] as const;

const motionPresetHints = {
  lift: 'قاب بنر کمی جابه‌جا می‌شود و کارت هنگام تعامل کمی بالا می‌آید.',
  ripple: 'خطی از نور دور قاب بنر، کارت یا فیلتر می‌گذرد.',
  glow: 'حاشیهٔ بنر، کارت یا فیلتر برای لحظه‌ای روشن‌تر می‌شود.',
};

export function CmsAppearanceEditor({
  value,
  onChange,
  name,
  font,
}: {
  value?: SiteAppearance;
  onChange: (patch: SiteAppearance) => void;
  name: string;
  font?: SiteContent['font'];
}) {
  const appearance = resolveAppearance(value);
  const [previewRun, setPreviewRun] = useState<{ appearance?: SiteAppearance; index: number }>({
    index: 0,
  });
  const motionOff = appearance.motion === 'none';
  const motionAvailable = !motionOff && motionTargets.some(({ key }) => appearance[key]);
  const previewPlaying = motionAvailable && previewRun.index > 0 && previewRun.appearance === value;
  const renderChoice = (choice: AppearanceChoice) => (
    <Field key={choice.key} label={choice.label} hint={choice.hint}>
      <select
        value={appearance[choice.key]}
        disabled={choice.key === 'motionPreset' && motionOff}
        onChange={(event) =>
          onChange(setAppearanceChoice(undefined, choice.key, event.target.value))
        }
      >
        {choice.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <fieldset className="cms-appearance-editor">
      <legend>طراحی و رفتار فروشگاه</legend>
      <p>
        ظاهر فروشگاه را برای هر دو زبان تنظیم کنید. ابتدا پیش‌نویس را ذخیره و سپس سند مشترک را منتشر
        کنید؛ ذخیره به‌تنهایی فروشگاه عمومی را تغییر نمی‌دهد.
      </p>
      <div className="cms-appearance-layout">
        <div>
          <div className="form-grid">{layoutAppearanceChoices.map(renderChoice)}</div>
          <fieldset className="cms-appearance-motion">
            <legend>جلوه‌های حرکت</legend>
            <div className="form-grid">{motionAppearanceChoices.map(renderChoice)}</div>
            <p>{motionPresetHints[appearance.motionPreset]}</p>
            <fieldset className="cms-appearance-motion-targets" disabled={motionOff}>
              <legend>بخش‌های دارای جلوه</legend>
              {motionTargets.map(({ key, label }) => (
                <Check
                  key={key}
                  label={label}
                  checked={appearance[key]}
                  onChange={(event) => onChange({ [key]: event.target.checked })}
                />
              ))}
            </fieldset>
          </fieldset>
          <Check
            label="هدر هنگام پیمایش در دسترس بماند"
            checked={appearance.stickyHeader}
            onChange={(event) => onChange({ stickyHeader: event.target.checked })}
          />
          <Check
            label="نمایش کالاهای کارکرده در فروشگاه"
            checked={appearance.showUsedProducts}
            onChange={(event) => onChange({ showUsedProducts: event.target.checked })}
          />
        </div>
        <figure className="cms-appearance-preview">
          <div
            key={previewRun.index}
            className="cms-appearance-canvas"
            data-surface={appearance.surface}
            data-density={appearance.density}
            data-corners={appearance.corners}
            data-shop-font={font ?? 'vazirmatn'}
            data-cards={appearance.cards}
            data-navigation={appearance.navigation}
            data-motion={appearance.motion}
            data-motion-preset={appearance.motionPreset}
            data-motion-banners={appearance.motionBanners}
            data-motion-cards={appearance.motionCards}
            data-motion-sidebar={appearance.motionSidebar}
            data-preview-motion={previewPlaying}
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
            <div className="cms-appearance-shelf">
              <div className="cms-appearance-sidebar">
                <b>فیلتر</b>
                <span />
                <span />
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
          </div>
          <figcaption>
            <div className="cms-appearance-preview-motion">
              {motionAvailable ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewRun((run) => ({ appearance: value, index: run.index + 1 }))
                    }
                  >
                    پخش نمونهٔ حرکت
                  </button>
                  <span className="cms-appearance-device-note">کاهش حرکت دستگاه فعال است.</span>
                </>
              ) : (
                <span>
                  {motionOff ? 'حرکت خاموش است.' : 'بخشی برای نمایش جلوه انتخاب نشده است.'}
                </span>
              )}
            </div>
            پیش‌نمایش شماتیک فاصله، سطح و چیدمان. نمایش نهایی را پس از انتشار در موبایل و دسکتاپ
            بررسی کنید. رنگ، لوگو، متن و تصویر از تنظیمات همان سند می‌آیند.
          </figcaption>
        </figure>
      </div>
      <small>
        دسترسی به تغییر طراحی به مجوز مدیریت محتوا نیاز دارد. کاهش حرکت و کنتراست خوانا حفظ می‌شوند؛
        افزودن CSS یا اسکریپت دلخواه مجاز نیست.
      </small>
    </fieldset>
  );
}
