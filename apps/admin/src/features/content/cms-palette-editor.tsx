import type { CSSProperties } from 'react';
import { resolveStorefrontColors } from '@sayman/web-shared/lib/content/brand-colors.ts';
import {
  copyPalettePreset,
  matchingPalettePreset,
  palettePresets,
} from '@sayman/web-shared/lib/content/palette-presets.ts';
import {
  paletteIntensities,
  sectionColor,
  type PaletteRegion,
  type PaletteTheme,
  type SitePalette,
} from '@sayman/web-shared/lib/content/site-palette.ts';
import { Text } from '../../components/forms/forms';
import { Field } from '../../components/ui';

const themes = [
  { theme: 'light', label: 'تم روشن', primary: 'primaryLight' },
  { theme: 'dark', label: 'تم تاریک', primary: 'primaryDark' },
] as const;

const sections: { key: PaletteRegion; label: string; hint: string }[] = [
  { key: 'canvas', label: 'زمینهٔ صفحه', hint: 'رنگ سطح پشت کارت‌ها و پنل‌ها' },
  { key: 'navigation', label: 'سربرگ و منو', hint: 'سربرگ، منوی موبایل و نوار پیمایش پایین' },
  { key: 'hero', label: 'بنر اصلی', hint: 'پشت تیتر و تصویر بالای صفحهٔ خانه' },
  { key: 'cards', label: 'کارت کالا و دسته', hint: 'بدنهٔ کارت‌ها و طیف قاب تصویر' },
  {
    key: 'promotions',
    label: 'پیشنهادها و کمپین‌ها',
    hint: 'کارت‌های تبلیغاتی، ویترین منتخب و بنر خرید چکی',
  },
  { key: 'footer', label: 'پانوشت', hint: 'زمینهٔ راه‌های تماس و پیوندهای پایین فروشگاه' },
];

const intensityLabels = { soft: 'ملایم', balanced: 'متعادل', strong: 'پررنگ' };

function changeSection(
  palette: SitePalette | undefined,
  region: PaletteRegion,
  theme: PaletteTheme,
  color: string | undefined,
): SitePalette {
  if (region === 'hero')
    return { ...palette, [theme === 'light' ? 'heroLight' : 'heroDark']: color };
  const sections = { ...palette?.sections };
  const themed = { ...sections[region] };
  if (color) themed[theme] = color;
  else delete themed[theme];
  if (themed.light || themed.dark) sections[region] = themed;
  else delete sections[region];
  return { ...palette, sections: Object.keys(sections).length ? sections : undefined };
}

export function CmsPaletteEditor({
  value,
  onChange,
  disabled,
}: {
  value: SitePalette | undefined;
  onChange: (palette: SitePalette | undefined) => void;
  disabled: boolean;
}) {
  const previews = themes.map((theme) => ({
    ...theme,
    colors: resolveStorefrontColors(theme.theme, value),
  }));
  const activePreset = matchingPalettePreset(value);
  return (
    <fieldset id="cms-site-palette" className="cms-palette-editor">
      <legend>رنگ فروشگاه</legend>
      <p>
        از یک پالت آماده شروع کنید یا رنگ هر بخش را جداگانه بسازید. نتیجه برای تم روشن و تاریک پایین
        همین فرم دیده می‌شود.
      </p>
      <div className="cms-palette-library" role="group" aria-labelledby="cms-palette-library-label">
        <div className="cms-palette-library-heading">
          <h4 id="cms-palette-library-label">پالت‌های آماده</h4>
          <small aria-live="polite">
            {activePreset
              ? 'انتخاب فعلی: ' + palettePresets.find((preset) => preset.id === activePreset)?.label
              : value
                ? 'انتخاب فعلی: سفارشی'
                : 'انتخاب فعلی: پیش‌فرض فروشگاه'}
          </small>
        </div>
        <div className="cms-palette-preset-grid">
          {palettePresets.map(({ id, label, description, colors }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              aria-pressed={id === activePreset}
              onClick={() => onChange(copyPalettePreset(id))}
            >
              <span className="cms-palette-swatch-pair" aria-hidden="true">
                {themes.map(({ theme, primary }) => (
                  <span className="cms-palette-swatches" key={theme} data-swatch-theme={theme}>
                    {[
                      colors[primary],
                      sectionColor(colors, 'navigation', theme),
                      sectionColor(colors, 'hero', theme),
                      sectionColor(colors, 'cards', theme),
                      sectionColor(colors, 'promotions', theme),
                    ].map((color, index) => (
                      <span key={index} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                ))}
              </span>
              <strong>{label}</strong>
              <small>{description}</small>
            </button>
          ))}
        </div>
        <small>
          نوار بالایی رنگ‌های تم روشن و نوار پایینی رنگ‌های تم تاریک است. انتخاب نمونه فقط پیش‌نویس
          را تغییر می‌دهد؛ می‌توانید رنگ‌ها را ویرایش و سپس منتشر کنید.
        </small>
      </div>
      <Field label="شدت تنوع رنگ" hint="میزان تفاوت طیف کارت‌ها، منو و بنرها در هر تم.">
        <select
          value={value?.intensity ?? 'balanced'}
          disabled={disabled}
          onChange={(event) => {
            const intensity = paletteIntensities.find((option) => option === event.target.value);
            if (intensity) onChange({ ...value, intensity });
          }}
        >
          {paletteIntensities.map((option) => (
            <option key={option} value={option}>
              {intensityLabels[option]}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        {previews.map(({ theme, label, primary, colors }) => (
          <section className="cms-palette-theme" key={theme} aria-label={label}>
            <h4>{label}</h4>
            <Text
              label={'رنگ اصلی و دکمه‌ها در ' + label}
              type="color"
              value={colors.brand.fill.toLowerCase()}
              disabled={disabled}
              onChange={(color) => onChange({ ...value, [primary]: color })}
            />
            <div
              className="cms-palette-preview"
              data-palette-theme={theme}
              style={
                {
                  backgroundColor: colors.regions.canvas,
                  '--cms-palette-edge': colors.edge,
                  '--cms-palette-menu': colors.navTrack,
                  '--cms-palette-footer-band': colors.footerBand,
                } as CSSProperties
              }
              aria-label={'پیش‌نمایش رنگ‌های ' + label}
            >
              <span
                className="cms-palette-preview-bar cms-palette-preview-nav"
                style={{ backgroundColor: colors.regions.navigation }}
              >
                سربرگ و منو
              </span>
              <div
                className="cms-palette-preview-hero"
                style={{ backgroundColor: colors.regions.hero }}
              >
                <strong>بنر اصلی فروشگاه</strong>
                <span
                  className="cms-palette-preview-art"
                  aria-hidden="true"
                  style={{
                    background: `linear-gradient(135deg, ${colors.heroArt}, ${colors.heroGlow})`,
                  }}
                />
                <span
                  className="cms-palette-sample"
                  style={
                    {
                      color: colors.brand.text,
                      borderColor: colors.brand.accent,
                      '--cms-palette-fill': colors.brand.fill,
                      '--cms-palette-hover': colors.brand.hover,
                    } as CSSProperties
                  }
                >
                  دیدن کالاها
                </span>
              </div>
              <div className="cms-palette-preview-cards">
                {colors.lanes.map((tone, index) => (
                  <span
                    key={index}
                    className="cms-palette-product"
                    style={{ backgroundColor: tone.body }}
                  >
                    <span aria-hidden="true" style={{ backgroundColor: tone.media }} />
                    <span style={{ color: tone.ink }}>کارت کالا</span>
                  </span>
                ))}
              </div>
              <div className="cms-palette-preview-campaigns">
                <span style={{ backgroundColor: colors.promoWarm }}>بنر کمپین</span>
                <span style={{ backgroundColor: colors.promoCool }}>پیشنهاد منتخب</span>
              </div>
              <span
                className="cms-palette-preview-spotlight"
                style={{ backgroundColor: colors.spotlight, color: colors.spotlightAccent }}
              >
                ویترین پیشنهادها
              </span>
              <span
                className="cms-palette-preview-bar cms-palette-preview-footer"
                style={{ backgroundColor: colors.regions.footer }}
              >
                پانوشت
              </span>
            </div>
            <small>
              متن دکمه {colors.brand.text === '#000000' ? 'مشکی' : 'سفید'} با کنتراست{' '}
              {colors.brand.ratio.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} به ۱{' · '}
              <bdi>{colors.brand.fill.toUpperCase()}</bdi>
            </small>
          </section>
        ))}
      </div>
      <details className="cms-palette-sections">
        <summary>رنگ اختصاصی هر بخش</summary>
        <p>
          رنگ هر بخش به طیف مناسب همان تم تبدیل می‌شود. حتی با انتخاب یک رنگ مشترک، زمینه، کارت و
          قاب تصویر از هم جدا می‌مانند و رنگ متن دکمه خودکار تعیین می‌شود.
        </p>
        {sections.map(({ key, label, hint }) => (
          <fieldset className="cms-palette-section" key={key}>
            <legend>{label}</legend>
            <small>{hint}</small>
            <div className="form-grid">
              {previews.map(({ theme, label: themeLabel, colors }) => {
                const custom = sectionColor(value, key, theme);
                return (
                  <div className="cms-palette-override" key={theme}>
                    <Text
                      label={label + ' در ' + themeLabel}
                      type="color"
                      value={(custom ?? colors.regions[key]).toLowerCase()}
                      disabled={disabled}
                      onChange={(color) => onChange(changeSection(value, key, theme, color))}
                    />
                    <small>{custom ? 'اختصاصی' : 'هماهنگ با رنگ اصلی'}</small>
                    {custom && (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={label + ' در ' + themeLabel + ' از رنگ اصلی پیروی کند'}
                        onClick={() => onChange(changeSection(value, key, theme, undefined))}
                      >
                        پیروی از رنگ اصلی
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </details>
      <button type="button" disabled={disabled || !value} onClick={() => onChange(undefined)}>
        بازگشت همهٔ رنگ‌ها به پیش‌فرض
      </button>
    </fieldset>
  );
}
