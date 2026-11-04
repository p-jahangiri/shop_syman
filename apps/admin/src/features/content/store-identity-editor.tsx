import { useRef } from 'react';
import { ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import { Check, Field } from '../../components/ui';
import { Text } from '../../components/forms/forms';
import { ImageEditor } from '../media/media';
import {
  isSocialUrl,
  normalizeSocialInput,
  socialLabels,
  socialPlatforms,
  storeIdentitySchema,
  visibleStoreIdentity,
  type StoreIdentity,
} from '@sayman/web-shared/lib/content/store-identity.ts';
import '../../styles/content/store-identity-editor.css';

export function readPublishedIdentity(json?: string | null) {
  if (!json) return {};
  try {
    return visibleStoreIdentity(JSON.parse(json)?.storeIdentity);
  } catch {
    return {};
  }
}

export function socialPublicationChanges(draftJson: string, publishedJson?: string | null) {
  const draft = readPublishedIdentity(draftJson).socialLinks ?? [];
  const published = readPublishedIdentity(publishedJson).socialLinks ?? [];
  return socialPlatforms.flatMap((platform) => {
    const current = draft.find((link) => link.platform === platform)?.url;
    const previous = published.find((link) => link.platform === platform)?.url;
    return current === previous ? [] : [{ platform, current, previous }];
  });
}

export function StoreIdentityEditor({
  value,
  published,
  locale,
  onChange,
  onBadgeImageChange,
  onBusy,
  disabled,
}: {
  value?: StoreIdentity;
  published?: StoreIdentity;
  locale: 'fa' | 'en';
  onChange: (value: StoreIdentity) => void;
  onBadgeImageChange: (id: string, imageUrl: string | undefined) => void;
  onBusy: (id: string, busy: boolean) => void;
  disabled: boolean;
}) {
  const current = value ?? {};
  const parsed = storeIdentitySchema.safeParse(current);
  const socials = current.socialLinks ?? [];
  const explicitlyHidden = useRef(
    new Set(socials.filter((row) => row.url && !row.enabled).map((row) => row.platform)),
  );
  const badges = current.badges ?? [];
  const policies = current.policyLinks ?? [];
  const change = (next: Partial<StoreIdentity>) => onChange({ ...current, ...next });
  const updateBadge = (index: number, next: Partial<(typeof badges)[number]>) =>
    change({ badges: badges.map((badge, i) => (i === index ? { ...badge, ...next } : badge)) });
  return (
    <fieldset className="store-identity-editor">
      <legend>اعتماد، شبکه‌های اجتماعی و راهنمای فروشگاه</legend>
      <p>
        این بخش همراه همین سند ذخیره و منتشر می‌شود. فقط اطلاعات واقعی و لینک استعلام متعلق به
        فروشگاه را وارد کنید؛ کد HTML یا اسکریپت لازم نیست.
      </p>
      {current.demonstration && (
        <div className="identity-editor-note">
          <p>
            نمایش کارت‌های مجوز خاموش است. پس از بررسی اصالت و ورود اطلاعات استعلام، تنظیم قبلی را
            بردارید و سند را منتشر کنید.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => change({ demonstration: false })}
          >
            آماده‌سازی نمایش مجوزهای واقعی
          </button>
        </div>
      )}
      <fieldset>
        <legend>راه‌های ارتباطی</legend>
        <p>
          زبان این نسخه {locale === 'fa' ? 'فارسی' : 'انگلیسی'} است. آدرس تازه و معتبر برای نمایش
          انتخاب می‌شود و می‌توانید آن را خاموش کنید. پس از ذخیرهٔ پیش‌نویس، «انتشار شبکه‌های
          اجتماعی» فقط همین لینک‌ها را در پانوشت و صفحهٔ پشتیبانی به‌روز می‌کند.
        </p>
        {socialPlatforms.map((platform) => {
          const saved = socials.find((s) => s.platform === platform);
          const row = saved ?? {
            platform,
            url: '',
            enabled: false,
          };
          const validUrl = isSocialUrl(platform, row.url);
          const publicUrl = published?.socialLinks?.find((link) => link.platform === platform)?.url;
          const ready = row.enabled && validUrl;
          const visibility = ready
            ? publicUrl === row.url
              ? 'اکنون در فروشگاه'
              : 'در انتظار انتشار'
            : publicUrl
              ? 'در انتشار بعد پنهان می‌شود'
              : 'پنهان';
          const update = (patch: Partial<typeof row>) => {
            const next = { ...row, ...patch };
            change({
              socialLinks: saved
                ? socials.map((item) => (item === saved ? next : item))
                : [...socials, next],
            });
          };
          return (
            <div key={platform} className="identity-editor-social">
              <div className="identity-editor-social-status">
                <Check
                  label={`نمایش ${socialLabels[platform].fa}`}
                  checked={row.enabled}
                  disabled={disabled || (!row.enabled && !validUrl)}
                  onChange={(event) => {
                    if (event.target.checked) explicitlyHidden.current.delete(platform);
                    else explicitlyHidden.current.add(platform);
                    update({ enabled: event.target.checked });
                  }}
                />
                <small
                  className="identity-visibility"
                  data-state={publicUrl && ready && publicUrl === row.url ? 'live' : undefined}
                >
                  {visibility}
                </small>
              </div>
              <Field
                label={`آدرس ${socialLabels[platform].fa}`}
                hint={
                  platform === 'whatsapp'
                    ? 'شمارهٔ بین‌المللی در لینک wa.me، بدون + و فاصله'
                    : platform === 'linkedin'
                      ? 'لینک صفحهٔ شرکت یا پروفایل را وارد کنید؛ پارامترهای اشتراک‌گذاری حذف می‌شوند.'
                      : undefined
                }
                error={
                  row.url && !validUrl ? 'آدرس HTTPS معتبر همین شبکه را وارد کنید.' : undefined
                }
              >
                <input
                  type="url"
                  dir="ltr"
                  placeholder={socialLabels[platform].hint}
                  value={row.url}
                  disabled={disabled}
                  onChange={(event) => {
                    const url = normalizeSocialInput(platform, event.target.value);
                    if (!url) explicitlyHidden.current.delete(platform);
                    update({
                      url,
                      enabled:
                        !!url &&
                        (row.enabled ||
                          (!explicitlyHidden.current.has(platform) && isSocialUrl(platform, url))),
                    });
                  }}
                />
              </Field>
              {validUrl && (
                <a
                  className="identity-editor-test-link"
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer external"
                >
                  <ArrowUpRight size={16} aria-hidden="true" />
                  بازکردن لینک
                </a>
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset>
        <legend>نمادها و مجوزها</legend>
        <p>
          اینماد از دامنهٔ رسمی trustseal.enamad.ir استعلام می‌شود. در صورت داشتن کد رسمی، فقط آدرس
          لینک و تصویر را از آن بردارید. تاریخ اعتبار و وضعیت نزد صادرکننده بررسی می‌شود؛ بارگذاری
          یک تصویر به معنی صدور مجوز نیست.
        </p>
        {badges.map((badge, index) => (
          <fieldset key={badge.id}>
            <legend>
              {badge.kind === 'enamad' ? 'نماد اعتماد الکترونیکی' : `مجوز ${index + 1}`}
            </legend>
            <Check
              label="نمایش در فروشگاه"
              checked={badge.enabled}
              onChange={(event) => updateBadge(index, { enabled: event.target.checked })}
            />
            <div className="form-grid">
              <Text
                label="عنوان مجوز"
                value={badge.title}
                onChange={(title) => updateBadge(index, { title })}
              />
              <Text
                label="لینک استعلام نزد صادرکننده"
                type="url"
                dir="ltr"
                value={badge.verificationUrl}
                onChange={(verificationUrl) =>
                  updateBadge(index, { verificationUrl: verificationUrl.trim() })
                }
              />
              {badge.kind === 'enamad' ? (
                <Text
                  label="آدرس تصویر رسمی اینماد — اختیاری"
                  type="url"
                  dir="ltr"
                  value={badge.imageUrl ?? ''}
                  hint="فقط HTTPS از trustseal.enamad.ir؛ بدون تصویر نیز لینک استعلام نمایش داده می‌شود."
                  onChange={(imageUrl) =>
                    updateBadge(index, { imageUrl: imageUrl.trim() || undefined })
                  }
                />
              ) : (
                <ImageEditor
                  label="تصویر واقعی مجوز — اختیاری"
                  max={1}
                  allowExternal={false}
                  disabled={disabled}
                  value={badge.imageUrl ? [badge.imageUrl] : []}
                  onBusy={(busy) => onBusy(`identity-${badge.id}`, busy)}
                  onChange={(urls) => onBadgeImageChange(badge.id, urls[0] || undefined)}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => change({ badges: badges.filter((_, i) => i !== index) })}
            >
              <Trash2 size={16} />
              حذف این مجوز
            </button>
          </fieldset>
        ))}
        <div className="row-buttons">
          <button
            type="button"
            disabled={badges.length >= 6 || badges.some((b) => b.kind === 'enamad')}
            onClick={() =>
              change({
                badges: [
                  ...badges,
                  {
                    id: 'enamad',
                    kind: 'enamad',
                    title: 'نماد اعتماد الکترونیکی',
                    enabled: false,
                    verificationUrl: '',
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            افزودن اینماد
          </button>
          <button
            type="button"
            disabled={badges.length >= 6}
            onClick={() =>
              change({
                badges: [
                  ...badges,
                  {
                    id: crypto.randomUUID(),
                    kind: 'license',
                    title: '',
                    enabled: false,
                    verificationUrl: '',
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            افزودن مجوز دیگر
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>صفحه‌های حقوق مشتری و راهنما</legend>
        <p>
          شرایط خرید، ارسال و مرجوعی، حریم خصوصی یا دربارهٔ فروشگاه را به صفحهٔ منتشرشدهٔ خود متصل
          کنید. مسیر موجود /support است؛ صفحات دلخواه ابتدا در مدیریت صفحات ساخته و منتشر شوند.
        </p>
        {policies.map((policy, index) => (
          <div className="identity-editor-policy" key={policy.id}>
            <Check
              label="نمایش لینک"
              checked={policy.enabled}
              onChange={(event) =>
                change({
                  policyLinks: policies.map((p, i) =>
                    i === index ? { ...p, enabled: event.target.checked } : p,
                  ),
                })
              }
            />
            <Text
              label="عنوان لینک"
              value={policy.title}
              onChange={(title) =>
                change({ policyLinks: policies.map((p, i) => (i === index ? { ...p, title } : p)) })
              }
            />
            <Text
              label="مسیر داخلی صفحه"
              dir="ltr"
              hint="/support یا /pages/privacy"
              value={policy.href}
              onChange={(href) =>
                change({
                  policyLinks: policies.map((p, i) =>
                    i === index ? { ...p, href: href.trim() } : p,
                  ),
                })
              }
            />
            <button
              type="button"
              aria-label={`حذف لینک ${policy.title || index + 1}`}
              onClick={() => change({ policyLinks: policies.filter((_, i) => i !== index) })}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={policies.length >= 6}
          onClick={() =>
            change({
              policyLinks: [
                ...policies,
                { id: crypto.randomUUID(), title: '', href: '', enabled: false },
              ],
            })
          }
        >
          <Plus size={16} />
          افزودن صفحهٔ راهنما
        </button>
      </fieldset>
      {!parsed.success && (
        <div role="alert" className="identity-editor-errors">
          <strong>پیش از ذخیره، اطلاعات این بخش را اصلاح کنید:</strong>
          <ul>
            {Array.from(new Set(parsed.error.issues.map((issue) => issue.message))).map(
              (message) => (
                <li key={message}>{message}</li>
              ),
            )}
          </ul>
        </div>
      )}
      <Field label="گردش انتشار">
        <small>
          ذخیرهٔ پیش‌نویس، فروشگاه را تغییر نمی‌دهد؛ پس از بررسی، «انتشار» را بزنید. تنظیمات هر زبان
          مستقل است.
        </small>
      </Field>
    </fieldset>
  );
}
