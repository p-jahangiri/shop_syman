import { dateFieldValue } from '../../utils/persian-date-contract';
import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, save, ApiError } from '../../api/api';
import { Busy, ErrorBox, Field } from '../../components/ui';
import { AdminTable } from '../../components/tables/admin-table';
import { ImageEditor } from '../../features/media/media';
import { useCmsImageUploads } from '../../features/content/cms-image-uploads';
import {
  usedChoices,
  usedDetail,
  usedInput,
  readUsedInspectionResult,
  type UsedDetail,
} from '../../api/contracts/catalog/used-items-contract';
import type { UsedCondition } from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';
import {
  usedInspectionPhotoUrlSchema,
  usedInspectionPhotoSchema,
} from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import { adminViewRevision } from '../../auth/admin-view-authority';
type Command = { id: string; input: ReturnType<typeof usedInput.parse> };
const names = {
  unknown: 'نامشخص',
  passed: 'سالم در بررسی فنی',
  needsRepair: 'نیازمند تعمیر',
  notApplicable: 'فاقد این ویژگی',
  measured: 'درصد اندازه‌گیری‌شده',
  intact: 'بدون آسیب مشاهده‌شده',
  worn: 'آثار استفاده',
  damaged: 'آسیب‌دیده',
  noKnownRepair: 'تعمیر شناخته‌شده ندارد',
  repaired: 'تعمیر شده',
};
const checks = {
  phone: [
    'گوشی و تبلت',
    'تماس و شبکه، شارژ، دوربین، لمس، لکهٔ نمایشگر و سلامت باتری را بررسی کنید.',
  ],
  laptop: ['لپ‌تاپ', 'کیبورد، تاچ‌پد، درگاه‌ها، نمایشگر، شارژر و سلامت باتری را بررسی کنید.'],
  console: [
    'کنسول بازی',
    'خروجی تصویر، درگاه‌ها، اتصال دسته، دیسک‌خوان و لوازم همراه را بررسی کنید.',
  ],
  accessory: ['لوازم جانبی', 'درگاه و کابل، اتصال، عملکرد زیر بار و قطعات همراه را بررسی کنید.'],
} as const;
export function UsedItemsPage({
  writable,
  viewerId,
  onProducts,
  onInventory,
}: {
  writable: boolean;
  viewerId: string;
  onProducts: () => void;
  onInventory?: () => void;
}) {
  const [text, setText] = useState(''),
    [query, setQuery] = useState(''),
    [reported, setReported] = useState(true),
    [selected, setSelected] = useState(''),
    [revision, setRevision] = useState(0),
    [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'used-choices', viewerId, query, reported],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ query, reported: String(reported) });
      const choices = usedChoices.parse(
        await api('/admin/used-items/variants?' + params, { signal }),
      );
      if (choices.items.some((item) => item.used !== reported))
        throw new Error('نتیجه با وضعیت گزارش انتخاب‌شده هم‌خوان نیست.');
      return choices;
    },
  });
  const detail = useQuery({
    queryKey: ['admin', 'used-detail', viewerId, selected],
    enabled: !!selected,
    queryFn: async () => {
      const value = usedDetail.parse(
        await api('/admin/used-items/' + encodeURIComponent(selected)),
      );
      if (value.variantId.toUpperCase() !== selected.toUpperCase())
        throw new Error('پاسخ مربوط به دستگاه انتخابی نیست.');
      return value;
    },
  });
  return (
    <section className="panel used-workspace">
      <div className="section-heading">
        <div>
          <h2>کالای کارکرده و گزارش سلامت</h2>
          <p>بازرسی، عکس‌ها و سابقهٔ هر دستگاه با SKU مستقل آن ثبت می‌شود.</p>
        </div>
        <div className="row-buttons">
          <button type="button" onClick={onProducts}>
            کالاها و تنوع‌ها
          </button>
          {onInventory && (
            <button type="button" onClick={onInventory}>
              موجودی و گردش انبار
            </button>
          )}
        </div>
      </div>
      <details className="notice">
        <summary>راهنمای ثبت تا فروش</summary>
        <ol>
          <li>
            در «کالاها و تنوع‌ها» محصول پیش‌نویس، SKU مستقل، قیمت و شرایط گارانتی همان دستگاه را ثبت
            کنید.
          </li>
          <li>
            در «بدون گزارش» دستگاه را پیدا کنید. فقط نتیجهٔ بررسی واقعی و عکس عمومی همان دستگاه را
            ثبت کنید.
          </li>
          <li>
            با ماندهٔ صفر یا یک و بدون رزرو فعال می‌توانید گزارش ثبت کنید. سپس از انبار، ماندهٔ
            دستگاه را بررسی و از کالاها آن را منتشر کنید.
          </li>
          <li>برای کارت ویژه، محصول تک‌تنوع را در بلوک «لحظهٔ سایمان» اضافه و منتشر کنید.</li>
        </ol>
      </details>
      <div className="row-buttons" role="group" aria-label="وضعیت گزارش">
        {[true, false].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={reported === value}
            className={reported === value ? 'primary' : undefined}
            onClick={() => {
              setReported(value);
              setSelected('');
              setSaved(false);
            }}
          >
            {value ? 'گزارش‌های ثبت‌شده' : 'بدون گزارش'}
          </button>
        ))}
      </div>
      <AdminFilterForm
        onSubmit={(e) => {
          e.preventDefault();
          setSelected('');
          setSaved(false);
          setQuery(text.trim());
        }}
        label="جست‌وجوی دستگاه کارکرده"
        search={
          <Field label="نام کالا، عنوان تنوع یا SKU">
            <input maxLength={100} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        }
        actions={
          <>
            <button>جست‌وجوی دستگاه</button>
            <button type="button" onClick={() => void list.refetch()} disabled={list.isFetching}>
              تازه‌سازی
            </button>
          </>
        }
        applied={query ? ['جست‌وجو: ' + query] : []}
      ></AdminFilterForm>
      <ErrorBox error={list.error} />
      {list.isPending ? (
        <Busy />
      ) : (
        <>
          {list.data && (
            <div
              className="table-wrap"
              role="region"
              tabIndex={0}
              aria-label="دستگاه‌های قابل بازرسی"
            >
              <AdminTable>
                <thead>
                  <tr>
                    <th scope="col">تنوع</th>
                    <th scope="col">SKU</th>
                    <th scope="col">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((item) => (
                    <tr key={item.variantId}>
                      <td>
                        <strong>{item.productNameFa ?? item.labelFa}</strong>
                        {item.productNameFa && <small>{item.labelFa}</small>}
                      </td>
                      <td>
                        <bdi>{item.sku}</bdi>
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-pressed={selected === item.variantId}
                          onClick={() => {
                            setSelected(item.variantId);
                            setSaved(false);
                          }}
                        >
                          {reported ? 'باز کردن گزارش' : 'شروع بازرسی'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!list.data.items.length && (
                    <tr>
                      <td colSpan={3}>دستگاهی با این وضعیت پیدا نشد.</td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
          )}
          {list.data?.hasMore && (
            <p className="notice">
              ۵۰ نتیجهٔ نخست نمایش داده شده؛ برای یافتن دستگاه، جست‌وجو را دقیق‌تر کنید.
            </p>
          )}
        </>
      )}
      <ErrorBox error={detail.error} />
      {saved && (
        <p role="status" className="notice">
          نسخهٔ تازهٔ گزارش ثبت شد.
        </p>
      )}
      {selected && detail.isPending && <Busy />}
      {selected && detail.data && (
        <InspectionEditor
          key={`${viewerId}:${detail.data.variantId}:${detail.data.variantVersion}:${revision}`}
          detail={detail.data}
          writable={writable}
          onReload={(wasSaved) => {
            setSaved(wasSaved);
            void detail.refetch().then(() => setRevision((v) => v + 1));
            void client.invalidateQueries({ queryKey: ['admin', 'used-choices'] });
          }}
        />
      )}
    </section>
  );
}
function InspectionEditor({
  detail,
  writable,
  onReload,
}: {
  detail: UsedDetail;
  writable: boolean;
  onReload: (saved: boolean) => void;
}) {
  const [facts, setFacts] = useState<UsedCondition>(
    detail.inspection ?? {
      inspectionId: crypto.randomUUID().replaceAll('-', ''),
      technicalState: 'unknown',
      batteryState: 'unknown',
      batteryHealthPercent: null,
      screenState: 'unknown',
      bodyState: 'unknown',
      repairState: 'unknown',
      notesFa: '',
      notesEn: '',
      inspectedAt: new Date().toISOString(),
    },
  );
  const [percent, setPercent] = useState(
    facts.batteryHealthPercent === null ? '' : String(facts.batteryHealthPercent),
  );
  const [inspected, setInspected] = useState(facts.inspectedAt.slice(0, 16));
  const [kind, setKind] = useState<keyof typeof checks>('phone');
  const [submitted, setSubmitted] = useState(false);
  const batteryInvalid =
    submitted &&
    facts.batteryState === 'measured' &&
    (percent === '' ||
      !Number.isInteger(Number(percent)) ||
      Number(percent) < 0 ||
      Number(percent) > 100);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [uncertain, setUncertain] = useState(false),
    [blocked, setBlocked] = useState(false);
  const pending = useRef<Command | null>(null);
  const saving = useRef(false);
  const uploads = useCmsImageUploads();
  const disabled = !writable || busy || uncertain || blocked;
  async function run(command: Command) {
    if (saving.current || busy || !writable || uploads.isBusy()) return;
    saving.current = true;
    const authority = adminViewRevision();
    command = structuredClone(command);
    pending.current = command;
    setBusy(true);
    setError(null);
    try {
      readUsedInspectionResult(
        await save(
          '/admin/used-items/' + encodeURIComponent(detail.variantId) + '/commands/' + command.id,
          command.input,
          'PUT',
        ),
        detail.variantId,
        command.input,
      );
      if (adminViewRevision() !== authority) return;
      pending.current = null;
      setUncertain(false);
      setBlocked(true);
      onReload(true);
    } catch (e) {
      if (adminViewRevision() !== authority) return;
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        setUncertain(false);
        setBlocked(e.code === 'version_conflict' || e.status === 401 || e.status === 403);
      } else setUncertain(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function submit() {
    if (disabled || saving.current || pending.current || uploads.isBusy()) return;
    setSubmitted(true);
    if (
      facts.batteryState === 'measured' &&
      (percent === '' ||
        !Number.isInteger(Number(percent)) ||
        Number(percent) < 0 ||
        Number(percent) > 100)
    ) {
      document.getElementById('used-battery-percent')?.focus();
      return;
    }
    try {
      const inspectedTime = dateFieldValue(inspected, 'utc');
      if (!inspectedTime) throw new Error('زمان بررسی معتبر را از تقویم شمسی انتخاب کنید.');
      const photos = facts.photos?.map((photo) => ({
        ...photo,
        altFa: photo.altFa.trim(),
        altEn: photo.altEn.trim(),
      }));
      if (photos?.some((photo) => !usedInspectionPhotoSchema.safeParse(photo).success))
        throw Error(
          'برای هر تصویر آمادهٔ همین دستگاه، توضیح عمومی فارسی و انگلیسیِ کوتاه و بدون اطلاعات خصوصی وارد کنید.',
        );
      const input = usedInput.parse({
        variantVersion: detail.variantVersion,
        inspection: {
          ...facts,
          ...(photos ? { photos } : {}),
          inspectionId: crypto.randomUUID().replaceAll('-', ''),
          inspectedAt: inspectedTime.toISOString(),
          batteryHealthPercent:
            facts.batteryState === 'measured' && percent !== '' ? Number(percent) : null,
        },
      });
      if (Date.parse(input.inspection.inspectedAt) > Date.now())
        throw new Error('زمان بررسی نمی‌تواند در آینده باشد.');
      void run({ id: crypto.randomUUID().replaceAll('-', ''), input });
    } catch (e) {
      setError(e);
    }
  }
  function editFacts(update: (value: UsedCondition) => UsedCondition) {
    if (!disabled && !uploads.isBusy()) setFacts(update);
  }
  function select<
    K extends 'technicalState' | 'batteryState' | 'screenState' | 'bodyState' | 'repairState',
  >(key: K, label: string, values: UsedCondition[K][]) {
    return (
      <Field label={label}>
        <select
          value={facts[key]}
          onChange={(e) => editFacts((v) => ({ ...v, [key]: e.target.value }))}
        >
          {values.map((v) => (
            <option key={v} value={v}>
              {names[v]}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <div>
      <h3>
        <bdi>{detail.sku}</bdi>
      </h3>
      <UsedConditionReport condition={detail.inspection ?? undefined} mediaPrefix="/api" />
      <ErrorBox error={error} />
      {uncertain && (
        <div className="notice" role="status">
          <p>
            نتیجه دریافت نشد. پیگیری، همان شناسه و بدنه را ارسال می‌کند؛ پیش از ویرایش، نتیجه را
            بررسی کنید.
          </p>
          <button
            disabled={busy || uploads.busy || !writable}
            onClick={() => {
              if (pending.current) void run(pending.current);
            }}
          >
            پیگیری همان ثبت
          </button>
        </div>
      )}
      <button
        disabled={busy || uploads.busy}
        onClick={() => {
          pending.current = null;
          setUncertain(false);
          setBlocked(true);
          onReload(false);
        }}
      >
        دریافت گزارش و نسخهٔ تازه
      </button>
      {uploads.busy && (
        <p className="notice" role="status">
          آپلود و بررسی تصویر در حال انجام است؛ ذخیره، پیگیری و ویرایش تا پایان آن بسته‌اند.
        </p>
      )}
      <fieldset className="used-inspection-form" disabled={disabled || uploads.busy}>
        <legend>نسخهٔ تازهٔ گزارش</legend>
        <Field label="چک‌لیست بازرسی" hint={checks[kind][1]}>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as keyof typeof checks)}
          >
            {Object.entries(checks).map(([key, [label]]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          {select('technicalState', 'وضعیت فنی', ['unknown', 'passed', 'needsRepair'])}
          {select('batteryState', 'وضعیت باتری', ['unknown', 'notApplicable', 'measured'])}
          {facts.batteryState === 'measured' && (
            <Field
              label="سلامت باتری"
              hint="درصد اندازه‌گیری‌شدهٔ همین دستگاه"
              error={batteryInvalid ? 'یک عدد صحیح از ۰ تا ۱۰۰ وارد کنید.' : undefined}
            >
              <input
                id="used-battery-percent"
                type="number"
                min={0}
                max={100}
                step={1}
                value={percent}
                onChange={(e) => {
                  if (!disabled && !uploads.isBusy()) setPercent(e.target.value);
                }}
              />
            </Field>
          )}
          {select('screenState', 'وضعیت صفحه', ['unknown', 'intact', 'worn', 'damaged'])}
          {select('bodyState', 'وضعیت بدنه', ['unknown', 'intact', 'worn', 'damaged'])}
          {select('repairState', 'سابقهٔ تعمیر', ['unknown', 'noKnownRepair', 'repaired'])}
        </div>
        <div className="field">
          <PersianDateField
            label="زمان بررسی به UTC"
            encoding="utc"
            disabled={disabled || uploads.busy}
            value={inspected}
            onChange={(next) => {
              if (!disabled && !uploads.isBusy()) setInspected(next);
            }}
          />
        </div>
        <Field label="یادداشت عمومی فارسی">
          <textarea
            maxLength={2000}
            value={facts.notesFa}
            onChange={(e) => editFacts((v) => ({ ...v, notesFa: e.target.value }))}
          />
        </Field>
        <Field label="Public notes in English">
          <textarea
            dir="ltr"
            maxLength={2000}
            value={facts.notesEn}
            onChange={(e) => editFacts((v) => ({ ...v, notesEn: e.target.value }))}
          />
        </Field>
        <p className="notice">
          این عکس‌ها عمومی و مخصوص همین دستگاه و همین نسخهٔ گزارش‌اند. IMEI، سریال، برچسب مشتری،
          اطلاعات حساب، چهره، آدرس و مدارک شخصی را قبل از بارگذاری از تصویر حذف کنید. حذف عکس از
          نسخهٔ تازه، عکس‌های ثبت‌شده در سفارش یا گزارش قبلی را تغییر نمی‌دهد.
        </p>
        <ImageEditor
          label="عکس‌های عمومی همین دستگاه"
          max={12}
          allowExternal={false}
          disabled={disabled}
          value={facts.photos?.map((photo) => photo.url) ?? []}
          onBusy={(value) => uploads.setBusy('inspection-photos', value)}
          onChange={(urls) => {
            if (disabled) return;
            if (
              urls.length > 12 ||
              urls.some((url) => !usedInspectionPhotoUrlSchema.safeParse(url).success)
            ) {
              setError(
                Error(
                  'فقط تصویر آماده‌شدهٔ فروشگاه با نشانی card.webp مجاز است؛ عکس عمومی مدل را به‌عنوان عکس این دستگاه ثبت نکنید.',
                ),
              );
              return;
            }
            setFacts((old) => ({
              ...old,
              photos: urls.map(
                (url) =>
                  old.photos?.find((photo) => photo.url === url) ?? { url, altFa: '', altEn: '' },
              ),
            }));
          }}
        />
        {(facts.photos ?? []).map((photo, index) => (
          <section key={photo.url}>
            <h4>توضیح تصویر {(index + 1).toLocaleString('fa-IR')} — عمومی و بدون اطلاعات خصوصی</h4>
            <Field label="متن جایگزین فارسی">
              <input
                maxLength={160}
                value={photo.altFa}
                onChange={(e) => {
                  const text = e.target.value;
                  editFacts((old) => ({
                    ...old,
                    photos: old.photos?.map((p) =>
                      p.url === photo.url ? { ...p, altFa: text } : p,
                    ),
                  }));
                }}
              />
            </Field>
            <Field label="English image alternative">
              <input
                dir="ltr"
                maxLength={160}
                value={photo.altEn}
                onChange={(e) => {
                  const text = e.target.value;
                  editFacts((old) => ({
                    ...old,
                    photos: old.photos?.map((p) =>
                      p.url === photo.url ? { ...p, altEn: text } : p,
                    ),
                  }));
                }}
              />
            </Field>
          </section>
        ))}
        <button className="primary" onClick={submit}>
          ثبت نسخهٔ تازهٔ گزارش
        </button>
      </fieldset>
      {!writable && <p className="notice">ثبت گزارش به مجوز ویرایش کاتالوگ و موجودی نیاز دارد.</p>}
    </div>
  );
}
