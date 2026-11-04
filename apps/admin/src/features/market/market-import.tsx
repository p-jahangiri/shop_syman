import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useRef, useState } from 'react';
import {
  readMarketImportJournal,
  keepMarketImportCommand,
  markMarketImportUncertain,
  finishMarketImportCommand,
  clearMarketImportJournal,
} from '../../state/market/market-import-journal';
import { api, ApiError, save } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { ErrorBox, Field } from '../../components/ui';
import {
  previewSchema,
  readImportResult,
  type ImportCommand,
  type ImportPreview,
  type ImportResult,
} from '../../api/contracts/market/market-contract';
import {
  MarketImportDraft,
  marketImportCsvHash,
  marketImportFailureIsUnknown,
} from '../../state/market-import-state';

const maxBytes = 128 * 1024;
const issueNames: Record<string, string> = {
  unknown_brand: 'شناسهٔ برند تعریف نشده است؛ از شناسهٔ برندهای پنل استفاده کنید.',
  unknown_category: 'شناسهٔ دسته تعریف نشده است؛ از شناسهٔ دسته‌های پنل استفاده کنید.',
  invalid_slug: 'اسلاگ باید حروف کوچک لاتین، رقم و خط تیره داشته باشد.',
  required_attribute: 'ویژگی اجباری دسته تکمیل نشده است.',
  invalid_image_url: 'نشانی تصویر مجاز و معتبر وارد کنید.',
  image_not_ready: 'تصویر بارگذاری‌شده هنوز آمادهٔ انتشار نیست.',
  invalid_market_csv: 'قالب یا مقدار یکی از ستون‌های CSV معتبر نیست.',
  invalid_market_input: 'منبع، مبلغ مرجع یا تاریخ مشاهده را بررسی کنید.',
  duplicate_market_csv_row: 'این منبع/مدل در فایل تکرار شده است.',
  model_slug_conflict: 'این اسلاگ قبلاً وجود دارد؛ برای اتصال صریح، model_id را وارد کنید.',
  market_model_conflict: 'مدل به ردیف منبع دیگری متصل است.',
  unknown_category_attribute: 'ویژگی به این دسته تعلق ندارد.',
  attribute_type_mismatch: 'مقدار با نوع یا گزینهٔ ویژگی سازگار نیست.',
  incomplete_market_model: 'مدل برای انتشار در بازار کامل نیست.',
  invalid_translations: 'عنوان و توضیحات فارسی و انگلیسی را بررسی کنید.',
  demo_unavailable: 'دادهٔ نمونه در این محیط مجاز نیست.',
  version_conflict: 'اطلاعات تغییر کرده است؛ پیش‌نمایش تازه بگیرید.',
};
export function MarketImport({ onSaved, viewerId }: { onSaved: () => void; viewerId: string }) {
  const initial = useRef(readMarketImportJournal(viewerId));
  const [csv, setCsv] = useState(initial.current?.command.csv ?? '');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [command, setCommand] = useState<ImportCommand | null>(initial.current?.command ?? null);
  const [result, setResult] = useState<ImportResult | null>(initial.current?.result ?? null);
  const [phase, setPhase] = useState<
    'editing' | 'previewing' | 'ready' | 'sending' | 'unknown' | 'done'
  >(initial.current ? (initial.current.result ? 'done' : 'unknown') : 'editing');
  const [error, setError] = useState<unknown>();
  const [receiptId, setReceiptId] = useState('');
  const [readingReceipt, setReadingReceipt] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const draft = useRef(new MarketImportDraft<ImportPreview>(initial.current?.command.csv ?? ''));
  const [readingFile, setReadingFile] = useState(false);
  const locked = phase === 'sending' || phase === 'unknown';
  const busy = phase === 'previewing' || phase === 'sending' || readingReceipt || readingFile;
  useEffect(() => () => draft.current.invalidate(), [viewerId]);
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [locked]);
  function change(value: string) {
    if (locked || busy || inFlight.current || draft.current.readingFile) return;
    draft.current.replace(value);
    clearMarketImportJournal(viewerId);
    setCsv(value);
    setPreview(null);
    setCommand(null);
    setResult(null);
    setPhase('editing');
    setError(undefined);
    setNotice('');
  }
  async function file(value: File | undefined) {
    if (!value || locked || busy || inFlight.current) return;
    const authority = adminViewRevision(),
      token = draft.current.beginFileRead();
    setReadingFile(true);
    setPreview(null);
    setPhase('editing');
    setError(undefined);
    try {
      if (value.size > maxBytes) throw Error('فایل باید حداکثر ۱۲۸ کیلوبایت باشد.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await value.arrayBuffer());
      if (authority !== adminViewRevision() || !draft.current.finishFileRead(token, text)) return;
      clearMarketImportJournal(viewerId);
      setCsv(text);
      setCommand(null);
      setResult(null);
      setNotice('');
    } catch {
      if (authority === adminViewRevision() && draft.current.cancelFileRead(token))
        setError(Error('فایل UTF-8 معتبر و حداکثر ۱۲۸ کیلوبایت انتخاب کنید.'));
    } finally {
      if (authority === adminViewRevision() && !draft.current.readingFile) setReadingFile(false);
    }
  }
  async function template() {
    try {
      const blob = await api<Blob>('/admin/market/import/template', {}, 'blob');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sayman-market-template.csv';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e);
    }
  }
  async function inspect() {
    if (inFlight.current || locked || draft.current.readingFile) return;
    const authority = adminViewRevision(),
      token = draft.current.beginPreview();
    inFlight.current = true;
    setPhase('previewing');
    setError(undefined);
    setNotice('');
    setCommand(null);
    setResult(null);
    try {
      if (new TextEncoder().encode(token.csv).length > maxBytes)
        throw Error('حجم متن CSV بیش از ۱۲۸ کیلوبایت است.');
      const [raw, hash] = await Promise.all([
        save<unknown>('/admin/market/import/preview', { csv: token.csv }),
        marketImportCsvHash(token.csv),
      ]);
      if (authority !== adminViewRevision()) return;
      const parsed = previewSchema.parse(raw);
      if (parsed.fileHash !== hash)
        throw Error('پیش‌نمایش با متن همین فایل هم‌خوان نیست؛ دوباره بررسی کنید.');
      if (!draft.current.acceptPreview(token, parsed)) return;
      setPreview(parsed);
      setPhase('ready');
    } catch (e) {
      if (authority === adminViewRevision()) {
        setPreview(null);
        setPhase('editing');
        setError(e);
      }
    } finally {
      inFlight.current = false;
    }
  }
  function submitReviewed() {
    try {
      const snapshot = draft.current.reviewed();
      if (!snapshot.preview.canCommit) return;
      void submit({
        csv: snapshot.csv,
        requestId: crypto.randomUUID(),
        expected: snapshot.preview.rows.map((row) => row.expected!),
      });
    } catch (e) {
      setError(e);
    }
  }
  async function submit(frozen: ImportCommand) {
    if (inFlight.current) return;
    const authority = adminViewRevision(),
      wasUncertain = phase === 'unknown' || readMarketImportJournal(viewerId)?.uncertain === true;
    try {
      keepMarketImportCommand(viewerId, frozen);
    } catch (e) {
      setError(e);
      return;
    }
    inFlight.current = true;
    setCommand(frozen);
    setPhase('sending');
    setError(undefined);
    setNotice('');
    try {
      const value = readImportResult(
        await save<unknown>('/admin/market/import/commit', frozen),
        frozen.requestId,
        frozen.expected,
      );
      if (
        authority !== adminViewRevision() ||
        !finishMarketImportCommand(viewerId, frozen.requestId, value)
      )
        return;
      setResult(value);
      setPhase('done');
      setReceiptId(value.requestId);
      onSaved();
    } catch (e) {
      if (authority !== adminViewRevision()) return;
      setError(e);
      if (
        marketImportFailureIsUnknown(e instanceof ApiError ? e.status : undefined, wasUncertain)
      ) {
        markMarketImportUncertain(viewerId, frozen);
        setPhase('unknown');
      } else {
        clearMarketImportJournal(viewerId);
        draft.current.invalidate();
        setPhase('editing');
        setPreview(null);
        setCommand(null);
      }
    } finally {
      inFlight.current = false;
    }
  }
  async function receipt() {
    if (inFlight.current) return;
    const id = command?.requestId ?? receiptId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setError(Error('شناسهٔ UUID رسید را وارد کنید.'));
      return;
    }
    const authority = adminViewRevision();
    inFlight.current = true;
    setReadingReceipt(true);
    setError(undefined);
    try {
      const value = readImportResult(
        await api<unknown>('/admin/market/import/receipts/' + encodeURIComponent(id)),
        id,
        command?.expected,
      );
      if (
        authority !== adminViewRevision() ||
        (command && !finishMarketImportCommand(viewerId, id, value))
      )
        return;
      setResult(value);
      setPhase('done');
      setNotice('رسید ثبت‌شده از سرور بازخوانی شد.');
      onSaved();
    } catch (e) {
      if (authority === adminViewRevision()) {
        setError(e);
        if (e instanceof ApiError && e.status === 404)
          setNotice(
            'رسید ثبت‌شده هنوز پیدا نشد. این پاسخ، پایان عملیات در حال انجام را ثابت نمی‌کند.',
          );
      }
    } finally {
      inFlight.current = false;
      if (authority === adminViewRevision()) setReadingReceipt(false);
    }
  }
  return (
    <section className="panel market-import">
      <div className="section-heading">
        <div>
          <h2>ورود گروهی CSV</h2>
          <p>حداکثر ۵۰ ردیف؛ پیش‌نمایش داده‌ای ذخیره نمی‌کند. همهٔ ردیف‌ها با هم ثبت می‌شوند.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void template()}>
          دریافت قالب CSV
        </button>
      </div>
      <div className="notice">
        ستون‌های منبع، وضعیت و تاریخ/قیمت مرجع را کامل نگه دارید؛ خانهٔ خالی در این ستون‌ها یعنی
        مقدار ندارد. ویژگیِ خالی/غایب مقدار قبلی را حفظ می‌کند؛ برای حذف صریح از{' '}
        <bdi>attr.key.clear=true</bdi> استفاده کنید. مبالغ صحیح ریال‌اند. تصویرها و فهرست گزینه‌ها
        با <bdi>|</bdi> جدا می‌شوند.
      </div>
      <fieldset disabled={locked || busy}>
        <Field label="فایل CSV با کدگذاری UTF-8">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void file(e.target.files?.[0])}
          />
        </Field>
        <Field label="متن CSV">
          <textarea
            dir="ltr"
            rows={7}
            value={csv}
            onChange={(e) => change(e.target.value)}
            spellCheck={false}
          />
        </Field>
      </fieldset>
      {readingFile && <p role="status">در حال خواندن فایل انتخاب‌شده…</p>}
      <div className="row-buttons">
        <button disabled={!csv.trim() || locked || busy} onClick={() => void inspect()}>
          {phase === 'previewing' ? 'در حال بررسی…' : 'پیش‌نمایش و بررسی خطاها'}
        </button>
        {phase === 'ready' && preview?.canCommit && (
          <button className="primary" disabled={busy} onClick={submitReviewed}>
            ثبت {preview.validRows.toLocaleString('fa-IR')} ردیف بررسی‌شده
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {preview && (
        <>
          <p role="status">
            {preview.validRows.toLocaleString('fa-IR')} ردیف معتبر ·{' '}
            {preview.invalidRows.toLocaleString('fa-IR')} ردیف دارای خطا
          </p>
          <div className="table-wrap" role="region" aria-label="پیش‌نمایش CSV" tabIndex={0}>
            <AdminTable>
              <thead>
                <tr>
                  <th>ردیف</th>
                  <th>مدل / منبع</th>
                  <th>عملیات</th>
                  <th>قیمت مرجع</th>
                  <th>نتیجهٔ بررسی</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber.toLocaleString('fa-IR')}</td>
                    <td>
                      <strong>{row.nameFa || row.nameEn}</strong>
                      <small>
                        <bdi>
                          {row.sourceKey} / {row.sourceItemKey}
                        </bdi>
                      </small>
                      {row.hasStorefrontOffers && (
                        <small>دارای پیشنهاد فروشگاهی؛ قیمت و موجودی حفظ می‌شوند.</small>
                      )}
                    </td>
                    <td>
                      {
                        {
                          create: 'مدل و ردیف جدید',
                          link: 'اتصال مدل موجود',
                          update: 'به‌روزرسانی',
                          invalid: 'نیازمند اصلاح',
                        }[row.operation]
                      }
                    </td>
                    <td>
                      <bdi>
                        {row.referencePriceRial && /^\d+$/.test(row.referencePriceRial)
                          ? BigInt(row.referencePriceRial).toLocaleString('fa-IR') + ' ریال'
                          : '—'}
                      </bdi>
                    </td>
                    <td>
                      {row.issues.length
                        ? row.issues.map((issue, index) => (
                            <p key={index}>{issueNames[issue.code] ?? issue.message}</p>
                          ))
                        : 'آمادهٔ ثبت'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </div>
        </>
      )}
      {command && (
        <div className="notice">
          <strong>کد پیگیری ورود فایل</strong>
          <p>
            <code dir="ltr">{command.requestId}</code>
          </p>
          <button
            onClick={() =>
              void navigator.clipboard
                ?.writeText(command.requestId)
                .catch(() => setNotice('کد را از متن بالای دکمه انتخاب و کپی کنید.'))
            }
          >
            کپی کد پیگیری
          </button>
        </div>
      )}
      {phase === 'unknown' && command && (
        <div className="notice" role="alert">
          <strong>نتیجهٔ ثبت هنوز مشخص نیست.</strong>
          <p>
            فایل و شناسهٔ همین درخواست در این صفحه نگه داشته شده‌اند. پیش از ثبت تازه، رسید را
            بازخوانی یا همان درخواست را دوباره ارسال کنید. این درخواست هنگام جابه‌جایی بین بخش‌های
            پنل در حافظه می‌ماند؛ بستن تب یا خروج از حساب آن را پاک می‌کند. کد پیگیری را نگه دارید.
          </p>
          <div className="row-buttons">
            <button onClick={() => void receipt()}>بازخوانی رسید همین درخواست</button>
            <button onClick={() => void submit(command)}>ارسال دوبارهٔ همان درخواست</button>
          </div>
        </div>
      )}
      {result && (
        <div className="notice" role="status">
          {result.replayed ? 'رسید ثبت قبلی بازیابی شد.' : 'ورود فایل ثبت شد.'}{' '}
          {result.created.toLocaleString('fa-IR')} ردیف جدید و{' '}
          {result.updated.toLocaleString('fa-IR')} ردیف به‌روزرسانی‌شده.
          <p>
            <code dir="ltr">{result.requestId}</code>
          </p>
          <button
            onClick={() => {
              draft.current.replace('');
              clearMarketImportJournal(viewerId);
              setCommand(null);
              setResult(null);
              setPreview(null);
              setCsv('');
              setPhase('editing');
              setReceiptId('');
              setNotice('');
              setError(undefined);
            }}
          >
            آماده‌کردن فایل بعدی
          </button>
        </div>
      )}
      <fieldset disabled={busy}>
        <legend>پیگیری با کد ثبت</legend>
        <div className="form-grid">
          <Field label="UUID رسید، برای همین حساب مدیر">
            <input
              dir="ltr"
              value={command?.requestId ?? receiptId}
              disabled={!!command}
              onChange={(e) => setReceiptId(e.target.value)}
            />
          </Field>
          <button disabled={busy} onClick={() => void receipt()}>
            بازخوانی رسید
          </button>
        </div>
      </fieldset>
    </section>
  );
}
