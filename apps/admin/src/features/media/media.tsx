import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ArrowDown, Trash2, Upload, Images } from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { ImageLibrary } from './image-library';
import {
  appendLibraryImage,
  type ImageLibraryItem,
} from '../../api/contracts/media/image-library-contract';
import '../../styles/media/image-library.css';
import {
  imagePreviewUrl,
  readImageCapabilities,
  readUploadedImage,
  validEditorImageUrl,
} from '../../api/contracts/media/media-contract';
export function ImageEditor({
  value,
  onChange,
  max = 24,
  label = 'تصاویر کالا',
  onBusy,
  allowExternal = true,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  max?: number;
  label?: string;
  onBusy?: (busy: boolean) => void;
  allowExternal?: boolean;
  disabled?: boolean;
}) {
  const capability = useQuery({
    queryKey: ['admin', 'media', 'capabilities'],
    queryFn: async () => readImageCapabilities(await api<unknown>('/admin/media/capabilities')),
    retry: false,
    staleTime: 30000,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [manual, setManual] = useState('');
  const [libraryOpen, setLibraryOpen] = useState<{ revision: number } | null>(null);
  const libraryId = useId();
  const libraryButton = useRef<HTMLButtonElement | null>(null);
  const libraryOwner = useRef<{ revision: number } | null>(null);
  const libraryContext = useRef({ disabled, max, onChange });
  libraryContext.current = { disabled, max, onChange };
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const [broken, setBroken] = useState<string[]>([]);
  const current = useRef(value);
  current.current = value;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      libraryOwner.current = null;
      if (request.current) {
        request.current.abort();
        busyCallback.current?.(false);
      }
    };
  }, []);
  async function upload(files: FileList | null) {
    if (!files?.length || busy || disabled || request.current) return;
    const chosen = Array.from(files);
    const limits = capability.data;
    if (!limits?.configured) {
      setError('ذخیره‌ساز و اسکن تصویر هنوز آماده نیستند.');
      return;
    }
    if (chosen.length + current.current.length > max) {
      setError(`حداکثر ${max.toLocaleString('fa-IR')} تصویر می‌توانید انتخاب کنید.`);
      return;
    }
    if (
      chosen.some(
        (file) =>
          !limits.contentTypes.some((type) => type === file.type) ||
          file.size === 0 ||
          file.size > limits.maxBytes,
      )
    ) {
      setError('فایل JPEG، PNG یا WebP تا ۸ مگابایت انتخاب کنید.');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    libraryOwner.current = null;
    setLibraryOpen(null);
    setBusy(true);
    busyCallback.current?.(true);
    setError('');
    try {
      for (let i = 0; i < chosen.length; i++) {
        if (controller.signal.aborted) break;
        setProgress(
          `بررسی و آماده‌سازی تصویر ${(i + 1).toLocaleString('fa-IR')} از ${chosen.length.toLocaleString('fa-IR')}…`,
        );
        const form = new FormData();
        form.set('file', chosen[i]);
        const raw = await api<unknown>('/admin/media/images', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        const parsed = (() => {
          try {
            return readUploadedImage(raw);
          } catch {
            throw new ApiError(
              503,
              'invalid_media_response',
              'پاسخ ذخیرهٔ تصویر معتبر نیست؛ تصویر به فرم اضافه نشد.',
            );
          }
        })();
        if (!alive.current || controller.signal.aborted) return;
        const urls = Array.from(new Set([...current.current, parsed.url]));
        if (urls.length > max) throw new Error('ظرفیت تصاویر فرم تکمیل شده است.');
        current.current = urls;
        onChange(urls);
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'آپلود تصویر انجام نشد.');
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress('');
        busyCallback.current?.(false);
      }
      request.current = null;
    }
  }
  function move(index: number, delta: number) {
    if (disabled || busy || request.current) return;
    const next = [...value];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  }
  function addManual() {
    const url = manual.trim();
    if (value.length >= max || disabled || busy || request.current) return;
    if (!validEditorImageUrl(url, allowExternal)) {
      setError(
        allowExternal
          ? 'نشانی معتبر HTTPS بدون اطلاعات ورود، یا تصویر ثبت‌شدهٔ فروشگاه وارد کنید.'
          : 'تصویر محلی مجاز یا تصویر آپلودشدهٔ فروشگاه را انتخاب کنید.',
      );
      return;
    }
    onChange(Array.from(new Set([...value, url])));
    setManual('');
    setError('');
  }
  function remove(index: number) {
    if (disabled || busy || request.current) return;
    onChange(value.filter((_, i) => i !== index));
  }
  function selectExisting(item: ImageLibraryItem, owner: { revision: number } | null) {
    const context = libraryContext.current;
    if (
      !alive.current ||
      request.current ||
      context.disabled ||
      !owner ||
      libraryOwner.current !== owner ||
      owner.revision !== adminViewRevision()
    )
      return false;
    try {
      const selected = appendLibraryImage(current.current, item, context.max);
      if (selected.reason !== 'added') return false;
      current.current = selected.value;
      context.onChange(selected.value);
      setError('');
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'انتخاب تصویر انجام نشد.');
      return false;
    }
  }
  const showLibrary =
    libraryOpen !== null && libraryOpen.revision === adminViewRevision() && !disabled && !busy;
  function closeLibrary() {
    libraryOwner.current = null;
    setLibraryOpen(null);
    libraryButton.current?.focus({ preventScroll: true });
  }
  return (
    <fieldset className="image-editor">
      <legend>{label}</legend>
      <p className="muted">
        تصاویر این بخش عمومی‌اند. مدارک شخصی را اینجا بارگذاری نکنید. نخستین تصویر، تصویر اصلی است.
      </p>
      {capability.isPending ? (
        <p role="status">در حال بررسی امکان آپلود…</p>
      ) : capability.error || !capability.data?.configured ? (
        <div className="notice">
          آپلود فعلاً آماده نیست؛ ذخیره‌ساز و سرویس اسکن باید پیکربندی شوند.{' '}
          <button type="button" onClick={() => capability.refetch()}>
            بررسی دوباره
          </button>
        </div>
      ) : null}
      <label className="upload-control">
        <Upload size={18} />
        <span>{busy ? 'در حال بررسی تصویر…' : 'انتخاب و آپلود تصویر'}</span>
        <input
          type="file"
          aria-label={`آپلود ${label}`}
          multiple={max > 1}
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy || !capability.data?.configured || value.length >= max}
          onChange={(event) => {
            void upload(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      <small>JPEG، PNG یا WebP، هر فایل تا ۸ مگابایت؛ فایل خام نگهداری عمومی نمی‌شود.</small>
      <button
        type="button"
        ref={libraryButton}
        className="image-library-toggle"
        aria-expanded={showLibrary}
        aria-controls={libraryId}
        disabled={disabled || busy || (!showLibrary && value.length >= max)}
        onClick={() => {
          if (showLibrary) {
            closeLibrary();
            return;
          }
          const context = libraryContext.current;
          if (
            !alive.current ||
            context.disabled ||
            request.current ||
            current.current.length >= context.max
          )
            return;
          const owner = { revision: adminViewRevision() };
          libraryOwner.current = owner;
          setLibraryOpen(owner);
        }}
      >
        <Images size={18} aria-hidden="true" />
        {showLibrary ? 'بستن تصاویر آماده' : 'انتخاب از تصاویر آماده'}
      </button>
      {showLibrary && (
        <ImageLibrary
          id={libraryId}
          value={value}
          max={max}
          onSelect={(item) => selectExisting(item, libraryOpen)}
          onClose={() => {
            if (libraryOwner.current === libraryOpen) closeLibrary();
          }}
        />
      )}
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ol className="image-editor-list">
        {value.map((url, index) => (
          <li key={url}>
            {broken.includes(url) || !imagePreviewUrl(url) ? (
              <span
                className="image-preview-unavailable"
                role="img"
                aria-label="پیش‌نمایش تصویر در دسترس نیست"
              >
                پیش‌نمایش در دسترس نیست
              </span>
            ) : (
              <img
                src={imagePreviewUrl(url)}
                onError={() => setBroken((old) => (old.includes(url) ? old : [...old, url]))}
                alt={`تصویر ${(index + 1).toLocaleString('fa-IR')}`}
                width={96}
                height={80}
              />
            )}
            <span>
              {index === 0 ? 'تصویر اصلی' : `تصویر ${(index + 1).toLocaleString('fa-IR')}`}
            </span>
            <div>
              <button
                type="button"
                disabled={disabled || busy || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`بالا بردن تصویر ${index + 1}`}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                disabled={disabled || busy || index === value.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`پایین بردن تصویر ${index + 1}`}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => remove(index)}
                aria-label={`حذف تصویر ${index + 1} از فرم`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <details>
        <summary>افزودن تصویر با نشانی عمومی</summary>
        <div className="manual-image">
          <input
            aria-label="نشانی عمومی تصویر"
            dir="ltr"
            value={manual}
            disabled={disabled || busy}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            type="button"
            disabled={disabled || busy || !manual.trim() || value.length >= max}
            onClick={addManual}
          >
            افزودن
          </button>
        </div>
      </details>
    </fieldset>
  );
}
