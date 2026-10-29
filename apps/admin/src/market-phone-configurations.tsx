import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, save } from './api';
import { adminViewRevision } from './admin-view-authority';
import { Busy, Check, ErrorBox, Field } from './ui';
import { Text } from './forms';
import { marketDetailSchema, marketModelSchema, normalizeMarketDigits } from './market-contract';
import { marketImportFailureIsUnknown } from './market-import-state';
import {
  phoneConfigurationCommandInputSchema,
  phoneConfigurationPath,
  phoneConfigurationReceiptPath,
  phoneConfigurationResultSchema,
  phoneConfigurationsSchema,
  readPhoneConfigurationResult,
  type PhoneConfigurationCommand,
  type PhoneConfigurations,
} from './market-phone-contract';
import {
  clearMarketPhoneJournal,
  finishMarketPhoneCommand,
  keepMarketPhoneCommand,
  markMarketPhoneUncertain,
  readMarketPhoneJournal,
} from './market-phone-journal';

export function MarketPhoneConfigurations({
  listingId,
  viewerId,
  writable,
  onSaved,
  onLock,
  onOpenListing,
}: {
  listingId: string;
  viewerId: string;
  writable: boolean;
  onSaved: () => void;
  onLock: (locked: boolean) => void;
  onOpenListing: (listingId: string) => void;
}) {
  const initial = readMarketPhoneJournal(viewerId);
  const [editing, setEditing] = useState<string | null | undefined>(
    initial?.command.listingId === listingId ? initial.command.configurationId : undefined,
  );
  const [revision, setRevision] = useState(0),
    [receiptId, setReceiptId] = useState(''),
    [receiptError, setReceiptError] = useState<unknown>(),
    [receiptNotice, setReceiptNotice] = useState(''),
    [readingReceipt, setReadingReceipt] = useState(false);
  const stored = readMarketPhoneJournal(viewerId);
  const query = useQuery({
    queryKey: ['admin', 'market-phone-configurations', viewerId, listingId, revision],
    queryFn: async ({ signal }) => {
      const [raw, listingRaw] = await Promise.all([
        api(phoneConfigurationPath(listingId), { signal }),
        api('/admin/market/' + encodeURIComponent(listingId), { signal }),
      ]);
      const configurations = phoneConfigurationsSchema.parse(raw),
        listing = marketDetailSchema.parse(listingRaw);
      if (configurations.listingId !== listingId || listing.id !== listingId)
        throw Error('انتخاب‌های پاسخ به مدل دیگری تعلق دارند.');
      const model = marketModelSchema.parse(
        await api('/admin/market/models/' + encodeURIComponent(listing.modelId), { signal }),
      );
      return { configurations, imageUrls: model.model.input.imageUrls };
    },
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  function refresh() {
    setRevision((value) => value + 1);
    onSaved();
  }
  async function lookup() {
    if (readingReceipt) return;
    const authority = adminViewRevision();
    setReadingReceipt(true);
    setReceiptError(undefined);
    setReceiptNotice('');
    onLock(true);
    try {
      const value = phoneConfigurationResultSchema.parse(
        await api(phoneConfigurationReceiptPath(receiptId.trim())),
      );
      if (authority !== adminViewRevision()) return;
      const known = readMarketPhoneJournal(viewerId);
      if (known?.command.requestId.toLowerCase() === value.requestId.toLowerCase()) {
        readPhoneConfigurationResult(value, known.command);
        if (!finishMarketPhoneCommand(viewerId, known.command, value)) return;
      }
      if (value.listingId !== listingId) {
        onOpenListing(value.listingId);
        return;
      }
      refresh();
      setReceiptNotice('رسید ثبت پیدا شد و فهرست انتخاب‌ها تازه شد.');
    } catch (error) {
      if (authority === adminViewRevision()) setReceiptError(error);
    } finally {
      if (authority === adminViewRevision()) {
        setReadingReceipt(false);
        onLock(false);
      }
    }
  }
  return (
    <section className="market-phone-configurations">
      <div className="market-business-note">
        <strong>انتخاب‌های قابل درخواست این گوشی</strong>
        <p>
          هر ردیف یک ترکیب مشخص از رم، حافظه و رنگ است. مشتری همین ترکیب را برای اطلاع‌رسانی یا
          درخواست تأمین انتخاب می‌کند؛ قیمت پیشنهادی پس از بررسی درخواست تعیین می‌شود.
        </p>
      </div>
      {stored?.result === null && (
        <div className="notice" role="status">
          <p>نتیجهٔ یک ثبت هنوز مشخص نیست. پیش از انتخاب تازه، همان فرمان را پیگیری کنید.</p>
          <code dir="ltr">{stored.command.requestId}</code>
          <button
            type="button"
            onClick={() =>
              stored.command.listingId === listingId
                ? setEditing(stored.command.configurationId)
                : onOpenListing(stored.command.listingId)
            }
          >
            پیگیری همان ثبت
          </button>
        </div>
      )}
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        query.data && (
          <>
            <div className="row-buttons">
              <button type="button" disabled={query.isFetching || readingReceipt} onClick={refresh}>
                بازخوانی انتخاب‌ها
              </button>
              {writable && (
                <button
                  type="button"
                  className="primary"
                  disabled={query.isFetching || readingReceipt || stored?.result === null}
                  onClick={() => setEditing(null)}
                >
                  افزودن ترکیب رم، حافظه و رنگ
                </button>
              )}
            </div>
            <ul className="market-config-list">
              {query.data.configurations.configurations.map((configuration) => (
                <li key={configuration.id}>
                  <div>
                    <strong>
                      {configuration.ramGb.toLocaleString('fa-IR')} گیگابایت رم ·{' '}
                      {configuration.storageGb.toLocaleString('fa-IR')} گیگابایت حافظه
                    </strong>
                    <span className="market-color-name">
                      {configuration.colorHex && (
                        <i style={{ backgroundColor: configuration.colorHex }} aria-hidden="true" />
                      )}
                      {configuration.colorNameFa}
                      <small dir="ltr">{configuration.colorNameEn}</small>
                    </span>
                    <small>
                      {configuration.enabled ? 'قابل انتخاب برای درخواست' : 'انتخاب غیرفعال'}
                    </small>
                  </div>
                  {writable && (
                    <button
                      type="button"
                      disabled={
                        query.isFetching ||
                        readingReceipt ||
                        (stored?.result === null &&
                          stored.command.configurationId !== configuration.id)
                      }
                      onClick={() => setEditing(configuration.id)}
                    >
                      ویرایش انتخاب
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!query.data.configurations.configurations.length && (
              <p className="empty">
                هنوز ترکیبی ثبت نشده است. رم، حافظه و رنگ‌های واقعی همین مدل را اضافه کنید.
              </p>
            )}
            {editing !== undefined &&
              writable &&
              (!stored || stored.result || stored.command.listingId === listingId) && (
                <PhoneConfigurationEditor
                  key={
                    listingId +
                    ':' +
                    (editing ?? 'new') +
                    ':' +
                    query.data.configurations.listingVersion
                  }
                  data={query.data.configurations}
                  imageUrls={query.data.imageUrls}
                  configurationId={editing}
                  viewerId={viewerId}
                  onSaved={refresh}
                  onLock={onLock}
                  onClose={() => {
                    setEditing(undefined);
                    refresh();
                  }}
                />
              )}
          </>
        )
      )}
      {!writable && (
        <p className="notice">
          این انتخاب‌ها برای شما فقط خواندنی‌اند. ثبت یا تغییر آن‌ها به مجوز ویرایش کاتالوگ نیاز
          دارد.
        </p>
      )}
      <details className="market-internal-settings">
        <summary>پیگیری ثبت با شناسهٔ قبلی</summary>
        <p>
          پس از بازکردن دوبارهٔ تب، رسید را با همان حساب ثبت‌کننده بخوانید. پاسخ «پیدا نشد»
          به‌تنهایی نتیجهٔ تلاش قبلی را مشخص نمی‌کند.
        </p>
        <Field label="شناسهٔ ثبت ترکیب">
          <input
            dir="ltr"
            maxLength={36}
            value={receiptId}
            onChange={(event) => setReceiptId(event.target.value)}
          />
        </Field>
        <button
          type="button"
          disabled={
            !writable ||
            readingReceipt ||
            !phoneConfigurationResultSchema.shape.requestId.safeParse(receiptId.trim()).success
          }
          onClick={() => void lookup()}
        >
          خواندن رسید ثبت
        </button>
        <ErrorBox error={receiptError} />
        {receiptNotice && (
          <p className="notice" role="status">
            {receiptNotice}
          </p>
        )}
      </details>
    </section>
  );
}

function PhoneConfigurationEditor({
  data,
  imageUrls,
  configurationId,
  viewerId,
  onSaved,
  onClose,
  onLock,
}: {
  data: PhoneConfigurations;
  imageUrls: string[];
  configurationId: string | null;
  viewerId: string;
  onSaved: () => void;
  onClose: () => void;
  onLock: (locked: boolean) => void;
}) {
  const previous = data.configurations.find((value) => value.id === configurationId),
    stored = readMarketPhoneJournal(viewerId);
  const own =
    stored?.command.listingId === data.listingId &&
    (configurationId === stored.command.configurationId || configurationId === null)
      ? stored
      : null;
  const initial = own?.command.input.configuration ?? previous;
  const [form, setForm] = useState({
    enabled: initial?.enabled ?? true,
    ramGb: initial ? String(initial.ramGb) : '',
    storageGb: initial ? String(initial.storageGb) : '',
    colorKey: initial?.colorKey ?? '',
    colorNameFa: initial?.colorNameFa ?? '',
    colorNameEn: initial?.colorNameEn ?? '',
    colorHex: initial?.colorHex ?? '',
    imageUrl: initial?.imageUrl ?? '',
    linkedVariantId: initial?.linkedVariantId ?? '',
  });
  const [command, setCommand] = useState<PhoneConfigurationCommand | null>(own?.command ?? null),
    [result, setResult] = useState(own?.result ?? null),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState<unknown>(),
    [colorKeyEdited, setColorKeyEdited] = useState(!!initial);
  const inFlight = useRef(false);
  async function execute(frozen: PhoneConfigurationCommand, readOnly = false) {
    if (inFlight.current) return;
    const authority = adminViewRevision(),
      wasUncertain = readMarketPhoneJournal(viewerId)?.uncertain === true || !!command;
    if (!readOnly) {
      try {
        keepMarketPhoneCommand(viewerId, frozen);
      } catch (error) {
        setError(error);
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    onLock(true);
    setError(undefined);
    try {
      const raw = readOnly
        ? await api(phoneConfigurationReceiptPath(frozen.requestId))
        : await save(
            phoneConfigurationPath(frozen.listingId) +
              '/' +
              frozen.configurationId +
              '/commands/' +
              frozen.requestId,
            frozen.input,
            'PUT',
          );
      if (authority !== adminViewRevision()) return;
      const value = readPhoneConfigurationResult(raw, frozen);
      if (!finishMarketPhoneCommand(viewerId, frozen, value)) return;
      setResult(value);
      onSaved();
    } catch (error) {
      if (authority !== adminViewRevision()) return;
      setError(error);
      if (
        readOnly ||
        marketImportFailureIsUnknown(
          error instanceof ApiError ? error.status : undefined,
          wasUncertain,
        )
      ) {
        markMarketPhoneUncertain(viewerId, frozen);
      } else {
        clearMarketPhoneJournal(viewerId);
        setCommand(null);
        setBlocked(true);
      }
    } finally {
      inFlight.current = false;
      if (authority === adminViewRevision()) {
        setBusy(false);
        onLock(false);
      }
    }
  }
  function submit() {
    try {
      const ram = normalizeMarketDigits(form.ramGb.trim()),
        storage = normalizeMarketDigits(form.storageGb.trim());
      if (!/^\d+$/.test(ram) || !/^\d+$/.test(storage))
        throw Error('رم و حافظه را به گیگابایت و با عدد صحیح وارد کنید.');
      const input = phoneConfigurationCommandInputSchema.parse({
        listingVersion: data.listingVersion,
        configurationVersion: previous?.version ?? null,
        configuration: {
          ...form,
          ramGb: Number(ram),
          storageGb: Number(storage),
          colorHex: form.colorHex || null,
          imageUrl: form.imageUrl || null,
          linkedVariantId: form.linkedVariantId || null,
        },
      });
      const frozen: PhoneConfigurationCommand = {
        listingId: data.listingId,
        configurationId: previous?.id ?? crypto.randomUUID().replaceAll('-', ''),
        requestId: crypto.randomUUID(),
        input,
      };
      keepMarketPhoneCommand(viewerId, frozen);
      setCommand(frozen);
      void execute(frozen);
    } catch (error) {
      setError(error);
    }
  }
  return (
    <div className="market-config-editor panel">
      <h3>{previous ? 'ویرایش ترکیب گوشی' : 'ترکیب تازهٔ گوشی'}</h3>
      <ErrorBox error={error} />
      {command && (
        <p className="market-command-id">
          شناسهٔ پیگیری: <code dir="ltr">{command.requestId}</code>
        </p>
      )}
      {result ? (
        <div className="notice" role="status">
          <p>{result.replayed ? 'رسید ثبت قبلی بازیابی شد.' : 'ترکیب گوشی ثبت شد.'}</p>
          <button
            type="button"
            onClick={() => {
              clearMarketPhoneJournal(viewerId);
              onClose();
            }}
          >
            پایان و بازخوانی فهرست
          </button>
        </div>
      ) : (
        <>
          {command && (
            <div className="notice" role="status">
              <p>
                متن و شناسهٔ همین ثبت محفوظ‌اند. اگر پاسخ نرسیده است، رسید را بخوانید یا همان ثبت را
                تکرار کنید.
              </p>
              <div className="row-buttons">
                <button type="button" disabled={busy} onClick={() => void execute(command, true)}>
                  خواندن رسید همین ثبت
                </button>
                <button type="button" disabled={busy} onClick={() => void execute(command)}>
                  تکرار دقیق همان ثبت
                </button>
              </div>
            </div>
          )}
          <fieldset disabled={busy || !!command || blocked}>
            <div className="form-grid">
              <Text
                label="رم (گیگابایت)"
                dir="ltr"
                disabled={!!previous}
                value={form.ramGb}
                onChange={(ramGb) => setForm({ ...form, ramGb })}
              />
              <Text
                label="حافظه داخلی (گیگابایت)"
                dir="ltr"
                disabled={!!previous}
                value={form.storageGb}
                onChange={(storageGb) => setForm({ ...form, storageGb })}
              />
              <Text
                label="نام رنگ فارسی"
                value={form.colorNameFa}
                onChange={(colorNameFa) => setForm({ ...form, colorNameFa })}
              />
              <Text
                label="English color name"
                dir="ltr"
                value={form.colorNameEn}
                onChange={(colorNameEn) =>
                  setForm({
                    ...form,
                    colorNameEn,
                    ...(!colorKeyEdited
                      ? {
                          colorKey: colorNameEn
                            .toLowerCase()
                            .trim()
                            .replace(/[^a-z0-9]+/g, '-')
                            .replace(/^-|-$/g, '')
                            .slice(0, 64),
                        }
                      : {}),
                  })
                }
              />
            </div>
            {previous && (
              <p className="notice">
                رم، حافظه و کلید رنگ این ترکیب ثابت‌اند تا انتخاب‌ها و پیگیری‌های قبلی مشتری عوض
                نشوند. برای ترکیب متفاوت، یک ترکیب تازه بسازید؛ این ترکیب را در صورت نیاز غیرفعال
                کنید.
              </p>
            )}
            <Field label="تصویر این رنگ">
              <select
                value={form.imageUrl}
                onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
              >
                <option value="">تصویر اصلی مدل</option>
                {imageUrls.map((url, index) => (
                  <option key={url} value={url}>
                    تصویر {(index + 1).toLocaleString('fa-IR')}
                  </option>
                ))}
              </select>
            </Field>
            <Check
              label="مشتری بتواند این ترکیب را برای درخواست انتخاب کند"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <details className="market-internal-settings">
              <summary>شناسه و تنظیمات تکمیلی رنگ</summary>
              <Text
                label="کلید ثابت رنگ (حروف کوچک لاتین)"
                dir="ltr"
                disabled={!!previous}
                value={form.colorKey}
                onChange={(colorKey) => {
                  setColorKeyEdited(true);
                  setForm({ ...form, colorKey });
                }}
              />
              <Text
                label="کد رنگ اختیاری، مانند #336699"
                dir="ltr"
                value={form.colorHex}
                onChange={(colorHex) => setForm({ ...form, colorHex })}
              />
              <Text
                label="شناسهٔ تنوع واقعی همین مدل (اختیاری)"
                dir="ltr"
                value={form.linkedVariantId}
                onChange={(linkedVariantId) => setForm({ ...form, linkedVariantId })}
              />
              <p className="muted">
                پیوند تنوع فقط برای تطبیق داخلی است؛ ثبت این انتخاب، موجودی یا قیمت فروشگاهی ایجاد
                نمی‌کند.
              </p>
            </details>
            <button type="button" className="primary" onClick={submit}>
              ذخیرهٔ ترکیب گوشی
            </button>
          </fieldset>
          {blocked && (
            <p className="notice">
              ثبت با خطای قطعی متوقف شد. فهرست تازه را بازخوانی و فرم را دوباره باز کنید.
            </p>
          )}
        </>
      )}
      <button type="button" disabled={busy} onClick={onClose}>
        بستن و بازخوانی
      </button>
    </div>
  );
}
