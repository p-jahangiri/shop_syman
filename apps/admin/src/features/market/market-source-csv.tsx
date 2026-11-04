import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useRef, useState } from 'react';
import { api, save, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { ErrorBox, Field } from '../../components/ui';
import {
  sourceCsvPreviewSchema,
  readSourceCsvResult,
  sourceCsvHash,
  type SourceCsvCommand,
  type SourceCsvPreview,
  type SourceCsvResult,
} from '../../api/contracts/market/market-source-csv-contract';
import {
  readSourceCsvJournal,
  keepSourceCsvCommand,
  markSourceCsvUncertain,
  finishSourceCsvCommand,
  clearSourceCsvJournal,
} from '../../state/market/market-source-csv-journal';
import { MarketImportDraft, marketImportFailureIsUnknown } from '../../state/market-import-state';
const limit = 128 * 1024;
const issues: Record<string, string> = {
  not_found: 'listing_id در بازار پیدا نشد؛ آن را از بخش منابع مدل کپی کنید.',
  market_source_conflict: 'هویت منبع تکراری است، به مدل دیگری تعلق دارد یا منبع اصلی است.',
  market_source_capacity_conflict: 'تعداد منابع تکمیلی این مدل با فایل از ۱۵ بیشتر می‌شود.',
  duplicate_market_csv_row: 'یک منبع در فایل تکرار شده است.',
  invalid_market_csv: 'ساختار CSV، شناسه یا مقدار یکی از ستون‌ها معتبر نیست.',
  invalid_market_input: 'نام، وضعیت، مبلغ مرجع یا زمان مشاهده و اعتبار را بررسی کنید.',
  incomplete_market_model: 'مشخصات مدل برای انتشار کامل نیست.',
  demo_unavailable: 'نمونهٔ توسعه در این محیط مجاز نیست.',
  version_conflict: 'مدل، منبع یا متادیتا تغییر کرده؛ پیش‌نمایش تازه بگیرید.',
};
export function MarketSourceCsvImport({
  viewerId,
  onSaved,
}: {
  viewerId: string;
  onSaved: () => void;
}) {
  const initial = useRef(readSourceCsvJournal(viewerId));
  const [csv, setCsv] = useState(initial.current?.command.csv ?? ''),
    [preview, setPreview] = useState<SourceCsvPreview | null>(null),
    [command, setCommand] = useState<SourceCsvCommand | null>(initial.current?.command ?? null),
    [result, setResult] = useState<SourceCsvResult | null>(initial.current?.result ?? null),
    [phase, setPhase] = useState<
      'editing' | 'previewing' | 'ready' | 'sending' | 'unknown' | 'done'
    >(initial.current ? (initial.current.result ? 'done' : 'unknown') : 'editing'),
    [error, setError] = useState<unknown>(),
    [receiptId, setReceiptId] = useState(''),
    [reading, setReading] = useState(false),
    [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const draft = useRef(new MarketImportDraft<SourceCsvPreview>(initial.current?.command.csv ?? ''));
  const [readingFile, setReadingFile] = useState(false);
  const locked = phase === 'sending' || phase === 'unknown',
    busy = phase === 'previewing' || phase === 'sending' || reading || readingFile;
  useEffect(() => () => draft.current.invalidate(), [viewerId]);
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [locked]);
  function change(value: string) {
    if (locked || busy || inFlight.current || draft.current.readingFile) return;
    draft.current.replace(value);
    clearSourceCsvJournal(viewerId);
    setCsv(value);
    setPreview(null);
    setCommand(null);
    setResult(null);
    setError(undefined);
    setNotice('');
    setPhase('editing');
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
      if (value.size > limit) throw Error('فایل باید حداکثر ۱۲۸ کیلوبایت باشد.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await value.arrayBuffer());
      if (authority !== adminViewRevision() || !draft.current.finishFileRead(token, text)) return;
      clearSourceCsvJournal(viewerId);
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
      const blob = await api<Blob>('/admin/market/source-import/template', {}, 'blob');
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sayman-extra-source-reports.csv';
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
    setResult(null);
    try {
      if (new TextEncoder().encode(token.csv).length > limit)
        throw Error('متن فایل بیش از ۱۲۸ کیلوبایت است.');
      const [raw, hash] = await Promise.all([
        save('/admin/market/source-import/preview', { csv: token.csv }),
        sourceCsvHash(token.csv),
      ]);
      if (authority !== adminViewRevision()) return;
      const value = sourceCsvPreviewSchema.parse(raw);
      if (value.fileHash !== hash)
        throw Error('پیش‌نمایش با متن همین فایل هم‌خوان نیست. دوباره بررسی کنید.');
      if (!draft.current.acceptPreview(token, value)) return;
      setPreview(value);
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
        fileHash: snapshot.preview.fileHash,
      });
    } catch (e) {
      setError(e);
    }
  }
  async function submit(frozen: SourceCsvCommand) {
    if (inFlight.current) return;
    const authority = adminViewRevision(),
      wasUncertain = phase === 'unknown' || readSourceCsvJournal(viewerId)?.uncertain === true;
    try {
      keepSourceCsvCommand(viewerId, frozen);
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
      const value = readSourceCsvResult(
        await save('/admin/market/source-import/commit', {
          csv: frozen.csv,
          requestId: frozen.requestId,
          expected: frozen.expected,
        }),
        frozen.requestId,
        frozen.expected,
        frozen.fileHash,
      );
      if (authority !== adminViewRevision() || !finishSourceCsvCommand(viewerId, frozen, value))
        return;
      setResult(value);
      setReceiptId(value.requestId);
      setPhase('done');
      onSaved();
    } catch (e) {
      if (authority !== adminViewRevision()) return;
      setError(e);
      if (
        marketImportFailureIsUnknown(e instanceof ApiError ? e.status : undefined, wasUncertain)
      ) {
        markSourceCsvUncertain(viewerId, frozen);
        setPhase('unknown');
      } else {
        clearSourceCsvJournal(viewerId);
        draft.current.invalidate();
        setCommand(null);
        setPreview(null);
        setPhase('editing');
      }
    } finally {
      inFlight.current = false;
    }
  }
  async function receipt() {
    if (inFlight.current) return;
    const id = command?.requestId ?? receiptId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setError(Error('شناسهٔ UUID رسید فایل را وارد کنید.'));
      return;
    }
    const authority = adminViewRevision();
    inFlight.current = true;
    setReading(true);
    setError(undefined);
    setNotice('');
    try {
      const value = readSourceCsvResult(
        await api('/admin/market/source-import/receipts/' + encodeURIComponent(id)),
        id,
        command?.expected,
        command?.fileHash,
      );
      if (authority !== adminViewRevision()) return;
      if (command && !finishSourceCsvCommand(viewerId, command, value)) return;
      setResult(value);
      setPhase('done');
      onSaved();
    } catch (e) {
      if (authority !== adminViewRevision()) return;
      setError(e);
      if (e instanceof ApiError && e.status === 404)
        setNotice(
          'رسید هنوز پیدا نشده؛ این پاسخ پایان فرمانِ در حال اجرا را ثابت نمی‌کند. همان شناسه را نگه دارید.',
        );
    } finally {
      inFlight.current = false;
      if (authority === adminViewRevision()) setReading(false);
    }
  }
  function reset() {
    draft.current.replace('');
    clearSourceCsvJournal(viewerId);
    setCsv('');
    setCommand(null);
    setPreview(null);
    setResult(null);
    setReceiptId('');
    setError(undefined);
    setNotice('');
    setPhase('editing');
  }
  return (
    <section className="panel market-source-import">
      <div className="section-heading">
        <div>
          <h2>CSV گزارش منابع تکمیلی</h2>
          <p>حداکثر ۵۰ گزارش؛ چند منبع برای یک مدل مجاز است و همهٔ ردیف‌ها با هم ثبت می‌شوند.</p>
        </div>
        <button disabled={busy} onClick={() => void template()}>
          قالب CSV منابع تکمیلی
        </button>
      </div>
      <p className="notice">
        از <bdi>listing_id</bdi> بخش «منابع و تاریخچه» استفاده کنید. <bdi>source_id</bdi> خالی، منبع
        تکمیلی همان هویت را پیدا می‌کند یا منبع تازه می‌سازد. منبع اصلی از فایل مدل قبلی ویرایش
        می‌شود. این فایل، مشخصات مدل، SKU، قیمت فروشگاهی یا موجودی انبار را تغییر نمی‌دهد. مبلغ مرجع
        ریال صحیح است؛ تاریخ ISO باید منطقهٔ زمانی داشته باشد.
      </p>
      <fieldset disabled={locked || busy || phase === 'done'}>
        <Field label="فایل CSV گزارش منابع با UTF-8">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void file(e.target.files?.[0])}
          />
        </Field>
        <Field label="متن CSV گزارش منابع">
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
        <button
          disabled={!csv.trim() || locked || busy || phase === 'done'}
          onClick={() => void inspect()}
        >
          بررسی فایل منابع
        </button>
        {phase === 'ready' && preview?.canCommit && (
          <button className="primary" disabled={busy} onClick={submitReviewed}>
            ثبت {preview.validRows.toLocaleString('fa-IR')} گزارش منابع
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {preview && (
        <>
          <p role="status">
            {preview.validRows.toLocaleString('fa-IR')} گزارش معتبر ·{' '}
            {preview.invalidRows.toLocaleString('fa-IR')} گزارش دارای خطا
          </p>
          <div className="table-wrap" role="region" aria-label="پیش‌نمایش گزارش منابع" tabIndex={0}>
            <AdminTable>
              <thead>
                <tr>
                  <th>ردیف</th>
                  <th>مدل و منبع</th>
                  <th>عملیات</th>
                  <th>قیمت مرجع ریال</th>
                  <th>بررسی</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber.toLocaleString('fa-IR')}</td>
                    <td>
                      {row.nameFa || row.nameEn}
                      <small>{row.sourceNameFa || row.sourceNameEn}</small>
                      <small>
                        <bdi>{row.listingId}</bdi>
                      </small>
                    </td>
                    <td>
                      {row.operation === 'create'
                        ? 'منبع تکمیلی تازه'
                        : row.operation === 'update'
                          ? 'گزارش تازهٔ منبع موجود'
                          : 'نیازمند اصلاح'}
                    </td>
                    <td>
                      <bdi>
                        {row.referencePriceRial && /^[0-9]{1,19}$/.test(row.referencePriceRial)
                          ? BigInt(row.referencePriceRial).toLocaleString('fa-IR')
                          : '—'}
                      </bdi>
                    </td>
                    <td>
                      {row.issues.length
                        ? row.issues.map((issue, i) => (
                            <p key={i}>{issues[issue.code] ?? issue.message}</p>
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
        <p>
          شناسهٔ پیگیری فایل منابع: <code dir="ltr">{command.requestId}</code>
        </p>
      )}
      {phase === 'unknown' && command && (
        <div className="notice" role="alert">
          <strong>نتیجهٔ فایل منابع هنوز مشخص نیست.</strong>
          <p>
            متن، نسخه‌ها و شناسهٔ همین فرمان قفل‌اند و در ناوبری پنل محفوظ می‌مانند. پس از بستن تب
            یا خروج، فقط کد پیگیری برای خواندن رسید می‌ماند.
          </p>
          <button disabled={busy} onClick={() => void receipt()}>
            رسید همین فایل منابع
          </button>
          <button disabled={busy} onClick={() => void submit(command)}>
            ارسال دقیق همان فایل منابع
          </button>
        </div>
      )}
      {result && (
        <div className="notice" role="status">
          <p>
            {result.replayed ? 'رسید فایل قبلی بازیابی شد.' : 'فایل منابع ثبت شد.'}{' '}
            {result.created.toLocaleString('fa-IR')} منبع تازه و{' '}
            {result.updated.toLocaleString('fa-IR')} گزارش به‌روزشده.
          </p>
          <code dir="ltr">{result.requestId}</code>
          <details>
            <summary>شناسهٔ متن پردازش‌شده</summary>
            <code dir="ltr">{result.fileHash}</code>
          </details>
          <button onClick={reset}>آماده‌کردن فایل منابع بعدی</button>
        </div>
      )}
      <fieldset disabled={busy}>
        <legend>بازیابی رسید فایل منابع</legend>
        <Field label="UUID رسید فایل منابع">
          <input
            dir="ltr"
            value={command?.requestId ?? receiptId}
            disabled={!!command}
            maxLength={36}
            onChange={(e) => setReceiptId(e.target.value)}
          />
        </Field>
        <button onClick={() => void receipt()}>خواندن رسید فایل منابع</button>
      </fieldset>
    </section>
  );
}
