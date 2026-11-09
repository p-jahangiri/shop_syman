import { useMemo, useRef, useState } from 'react';
import {
  designFonts,
  designTemplateIds,
  designTemplates,
  designThemes,
  editableSiteDesign,
  resolveSiteDesign,
  type SiteDesign,
} from '@sayman/web-shared/lib/content/site-design.ts';
import {
  generateDesignPalette,
  neutralTemperatures,
  paletteHarmonies,
} from '@sayman/web-shared/lib/content/design-palette-generator.ts';
import {
  designTransferMaxBytes,
  readDesignTransfer,
  type DesignTransfer,
} from '@sayman/web-shared/lib/content/design-transfer.ts';
import { resolveStorefrontColors } from '@sayman/web-shared/lib/content/brand-colors.ts';
import { palettePresets } from '@sayman/web-shared/lib/content/palette-presets.ts';
import type { HomeBlock } from '@sayman/web-shared/lib/shared/types.ts';
import type { SitePalette } from '@sayman/web-shared/lib/content/site-palette.ts';
import { Check, Field } from '../../components/ui';
import {
  editableHomeBlocks,
  importDesignPatch,
  unavailableBlockCategories,
  updateAppearance,
  type DesignDraft,
  type DesignImportScope,
} from './cms-design-draft';
import { CmsAppearanceEditor } from './cms-appearance-editor';
import { CmsPaletteEditor } from './cms-palette-editor';
import {
  paletteFor,
  replaceCustomPalette,
  selectPalette,
  selectedPalette,
} from './cms-palette-library';
import '../../styles/content/cms-design-studio.css';

const themeLabel = { system: 'طبق دستگاه', light: 'روشن', dark: 'تاریک' };
const fontLabel = {
  vazirmatn: 'وزیرمتن',
  'noto-arabic': 'Noto Sans Arabic',
  system: 'فونت دستگاه',
};
const harmonyLabel = { analogous: 'مشابه', complementary: 'مکمل', triadic: 'سه‌گانه' };
const temperatureLabel = { cool: 'سرد', neutral: 'خنثی', warm: 'گرم' };
export const homeBlockLabels: Record<HomeBlock['kind'], string> = {
  categories: 'دسته‌بندی‌ها',
  collection: 'محصولات منتخب',
  promotions: 'بنرهای تبلیغاتی',
  products: 'فهرست محصولات',
  spotlight: 'لحظهٔ سایمان',
  brands: 'برندها',
  cheque: 'معرفی خرید چکی',
};
const groups = [
  ['layout', 'چیدمان و کارت'],
  ['motion', 'حرکت'],
  ['typography', 'فونت'],
] as const;

function DesignSwatches({ palette, label }: { palette?: SitePalette; label: string }) {
  return (
    <div className="cms-design-swatches" aria-label={label}>
      {(['light', 'dark'] as const).map((theme) => {
        const colors = resolveStorefrontColors(theme, palette);
        return (
          <div key={theme} style={{ background: colors.regions.canvas }}>
            <span style={{ background: colors.brand.fill, color: colors.brand.text }}>
              {themeLabel[theme]}
            </span>
            <i style={{ background: colors.regions.hero }} aria-hidden="true" />
            <i style={{ background: colors.regions.cards }} aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}

export function CmsDesignStudio({
  site,
  name,
  disabled,
  categoryIds,
  update,
}: {
  site: DesignDraft;
  name: string;
  disabled: boolean;
  categoryIds?: readonly string[];
  update: (apply: (current: DesignDraft) => Partial<DesignDraft>) => void;
}) {
  const [brand, setBrand] = useState('#405833');
  const [harmony, setHarmony] = useState<(typeof paletteHarmonies)[number]>('analogous');
  const [temperature, setTemperature] = useState<(typeof neutralTemperatures)[number]>('neutral');
  const [transfer, setTransfer] = useState<DesignTransfer>();
  const [scope, setScope] = useState<DesignImportScope>({ appearance: true, blocks: false });
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRead = useRef(0);
  const resolved = resolveSiteDesign(site);
  const template = site.design ? designTemplates[site.design.template] : undefined;
  const choice = selectedPalette(site);
  const draftDesign = editableSiteDesign(site);
  const overrideCount = Object.values(draftDesign.overrides ?? {}).reduce(
    (count, group) => count + Object.keys(group).length,
    0,
  );
  const customPalette = paletteFor(site, 'custom');
  const generated = useMemo(
    () => generateDesignPalette(brand, harmony, temperature),
    [brand, harmony, temperature],
  );
  const importedBlocks = transfer?.homeBlocks;
  const missingCategories =
    importedBlocks && categoryIds ? unavailableBlockCategories(importedBlocks, categoryIds) : [];
  const importedColors =
    transfer && scope.appearance
      ? importDesignPatch(site, transfer, {
          appearance: true,
          blocks: false,
        }).paletteLibrary?.selected
      : undefined;
  const selectDesign = (change: (design: SiteDesign) => SiteDesign) =>
    update((current) => ({ design: change(editableSiteDesign(current)) }));

  function exportDesign() {
    try {
      const data = {
        format: 'sayman-store-design',
        schemaVersion: 1,
        design: editableSiteDesign(site),
        palette: site.palette,
        homeBlocks: editableHomeBlocks(site.homeBlocks),
      } as const;
      const json = JSON.stringify(data, null, 2);
      readDesignTransfer(json);
      const href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = Object.assign(document.createElement('a'), {
        href,
        download: 'sayman-design.json',
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setError('');
      setMessage('قالب و چیدمان خانه برای دانلود آماده شد.');
    } catch {
      setError('برای دریافت فایل قالب، ابتدا اطلاعات نامعتبر یا حجم بلوک‌های خانه را اصلاح کنید.');
    }
  }

  async function inspectFile(file: File) {
    const generation = ++fileRead.current;
    setTransfer(undefined);
    setReading(true);
    setError('');
    setMessage('');
    try {
      if (file.size > designTransferMaxBytes) throw new Error('فایل قالب بیش از حد بزرگ است.');
      const parsed = readDesignTransfer(await file.text());
      if (generation === fileRead.current) {
        setScope({ appearance: true, blocks: parsed.homeBlocks !== undefined });
        setTransfer(parsed);
      }
    } catch {
      if (generation === fileRead.current)
        setError('فایل JSON قالب معتبر نیست یا از محدودهٔ مجاز بزرگ‌تر است.');
    } finally {
      if (generation === fileRead.current) setReading(false);
    }
  }

  return (
    <fieldset id="cms-site-design" className="cms-design-studio" disabled={disabled}>
      <legend>طراحی فروشگاه</legend>
      <p>قالب، پالت و تم را جدا انتخاب کنید. نتیجه پس از ذخیره و انتشار مشترک به فروشگاه می‌رسد.</p>
      <div className="form-grid">
        <Field
          label="قالب چیدمان"
          hint={template?.description ?? 'ظاهر منتشرشدهٔ فعلی مبنای ویرایش است.'}
        >
          <select
            value={site.design?.template ?? ''}
            onChange={(event) => {
              const picked = designTemplateIds.find((id) => id === event.target.value);
              if (picked)
                update((current) => ({
                  design: { ...(current.design ?? { schemaVersion: 1 }), template: picked },
                }));
            }}
          >
            {!site.design && (
              <option value="" disabled>
                ظاهر فعلی فروشگاه
              </option>
            )}
            {designTemplateIds.map((id) => (
              <option key={id} value={id}>
                {designTemplates[id].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="پالت رنگ">
          <select
            value={choice}
            onChange={(event) => {
              const id = event.target.value;
              const preset = palettePresets.find((entry) => entry.id === id);
              if (preset) update((current) => selectPalette(current, preset.id));
              else if (id === 'default' || id === 'custom')
                update((current) => selectPalette(current, id));
            }}
          >
            <option value="default">رنگ‌های پیش‌فرض</option>
            {palettePresets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
            {(choice === 'custom' || site.paletteLibrary?.alternatives.custom) && (
              <option value="custom">پالت سفارشی</option>
            )}
          </select>
        </Field>
        <Field label="تم پیش‌فرض مشتری">
          <select
            value={resolved.theme}
            onChange={(event) => {
              const theme = designThemes.find((entry) => entry === event.target.value);
              if (theme) selectDesign((design) => ({ ...design, theme }));
            }}
          >
            {designThemes.map((theme) => (
              <option key={theme} value={theme}>
                {themeLabel[theme]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {site.design && overrideCount > 0 && (
        <p className="muted">
          {overrideCount.toLocaleString('fa-IR')} تنظیم دستی روی انتخاب قالب اولویت دارند. برای
          بازنشانی هر گروه، تنظیمات پیشرفته را باز کنید.
        </p>
      )}
      {template && choice !== template.palette && (
        <button
          type="button"
          onClick={() => update((current) => selectPalette(current, template.palette))}
        >
          انتخاب پالت پیشنهادی قالب
        </button>
      )}
      <DesignSwatches palette={site.palette} label="نمونهٔ پالت انتخاب‌شده" />
      <details>
        <summary>ساخت پالت از رنگ برند</summary>
        <div className="form-grid">
          <Field label="رنگ برند">
            <input type="color" value={brand} onChange={(event) => setBrand(event.target.value)} />
          </Field>
          <Field label="هارمونی">
            <select
              value={harmony}
              onChange={(event) => {
                const value = paletteHarmonies.find((entry) => entry === event.target.value);
                if (value) setHarmony(value);
              }}
            >
              {paletteHarmonies.map((entry) => (
                <option key={entry} value={entry}>
                  {harmonyLabel[entry]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="دمای رنگ‌های خنثی">
            <select
              value={temperature}
              onChange={(event) => {
                const value = neutralTemperatures.find((entry) => entry === event.target.value);
                if (value) setTemperature(value);
              }}
            >
              {neutralTemperatures.map((entry) => (
                <option key={entry} value={entry}>
                  {temperatureLabel[entry]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p>نمونهٔ پالت پیشنهادی</p>
        <DesignSwatches palette={generated} label="پیش‌نمایش پالت ساخته‌شده" />
        {customPalette && (
          <p className="muted">با اعمال این نمونه، پالت سفارشی فعلی جایگزین می‌شود.</p>
        )}
        <button
          type="button"
          onClick={() => {
            update((current) => replaceCustomPalette(current, generated));
            setMessage('پالت سفارشی در فرم انتخاب شد.');
          }}
        >
          {customPalette ? 'جایگزینی پالت سفارشی' : 'انتخاب پالت ساخته‌شده'}
        </button>
      </details>
      <details>
        <summary>تنظیمات پیشرفته و پیش‌نمایش نمونه</summary>
        <Field label="فونت فروشگاه">
          <select
            value={resolved.font}
            onChange={(event) => {
              const font = designFonts.find((entry) => entry === event.target.value);
              if (font)
                selectDesign((design) => ({
                  ...design,
                  overrides: { ...design.overrides, typography: { font } },
                }));
            }}
          >
            {designFonts.map((font) => (
              <option key={font} value={font}>
                {fontLabel[font]}
              </option>
            ))}
          </select>
        </Field>
        <div className="row-buttons">
          {groups.map(([group, label]) => {
            const overrides = draftDesign.overrides?.[group];
            return (
              overrides &&
              Object.keys(overrides).length > 0 && (
                <button
                  type="button"
                  key={group}
                  onClick={() =>
                    selectDesign((design) => {
                      const next = { ...design.overrides };
                      delete next[group];
                      return { ...design, overrides: next };
                    })
                  }
                >
                  بازنشانی {label} به قالب
                </button>
              )
            );
          })}
        </div>
        <CmsPaletteEditor
          settings={{ palette: site.palette, paletteLibrary: site.paletteLibrary }}
          onChange={({ palette, paletteLibrary }) => update(() => ({ palette, paletteLibrary }))}
          disabled={disabled}
        />
        <CmsAppearanceEditor
          value={resolved.appearance}
          font={resolved.font}
          name={name}
          onChange={(patch) => update((current) => updateAppearance(current, patch))}
        />
      </details>
      <details>
        <summary>انتقال قالب و بلوک‌های خانه</summary>
        <p>
          فایل شامل ظاهر و چیدمان خانه است. در فروشگاه دیگر، دسته‌ها، کالاها و تصاویر را پس از
          درون‌ریزی بررسی کنید.
        </p>
        <div className="row-buttons">
          <button type="button" onClick={exportDesign}>
            دریافت فایل قالب و خانه
          </button>
          <Field label="انتخاب فایل JSON قالب">
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void inspectFile(file);
                event.currentTarget.value = '';
              }}
            />
          </Field>
        </div>
        {reading && <p role="status">در حال بررسی فایل قالب…</p>}
        {transfer && (
          <div className="notice cms-design-import-review">
            <strong>بازبینی فایل «{designTemplates[transfer.design.template].label}»</strong>
            <div className="row-buttons">
              <Check
                label="ظاهر و پالت"
                checked={scope.appearance}
                onChange={(event) => setScope({ ...scope, appearance: event.target.checked })}
              />
              {importedBlocks !== undefined && (
                <Check
                  label="بلوک‌های خانه"
                  checked={scope.blocks}
                  onChange={(event) => setScope({ ...scope, blocks: event.target.checked })}
                />
              )}
            </div>
            {importedColors === 'custom' && customPalette && (
              <p>با اعمال ظاهر، پالت سفارشی فعلی جایگزین می‌شود.</p>
            )}
            {scope.blocks && importedBlocks && (
              <>
                <p>
                  تعداد بلوک‌های خانه از{' '}
                  {editableHomeBlocks(site.homeBlocks).length.toLocaleString('fa-IR')} به{' '}
                  {importedBlocks.length.toLocaleString('fa-IR')} می‌رسد.
                </p>
                {importedBlocks.length === 0 && (
                  <p>با اعمال این فایل، فهرست بلوک‌های خانه خالی می‌شود.</p>
                )}
                {importedBlocks.length > 0 && (
                  <ol>
                    {importedBlocks.map((block) => (
                      <li key={block.id}>
                        {block.title || homeBlockLabels[block.kind]}
                        {!block.enabled && ' (خاموش)'}
                        {missingCategories.includes(block) && ' — دسته در این فروشگاه پیدا نشد'}
                      </li>
                    ))}
                  </ol>
                )}
                <p>قبل از انتشار، کالاها، تصاویر و متن انگلیسی بلوک‌های واردشده را مرور کنید.</p>
              </>
            )}
            <div className="row-buttons">
              <button
                type="button"
                disabled={!scope.appearance && !scope.blocks}
                onClick={() => {
                  update((current) => importDesignPatch(current, transfer, scope));
                  setTransfer(undefined);
                  setMessage(
                    'بخش‌های انتخاب‌شده به فرم اضافه شدند. برای نگه‌داشتنشان، پیش‌نویس را ذخیره کنید.',
                  );
                }}
              >
                اعمال بخش‌های انتخاب‌شده
              </button>
              <button type="button" onClick={() => setTransfer(undefined)}>
                انصراف
              </button>
            </div>
          </div>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
