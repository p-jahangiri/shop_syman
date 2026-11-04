import { useEffect, useId, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import type { CartFetch } from '@/lib/checkout/cart-client';
import {
  reviewPhotoMaxBytes,
  reviewPhotoMime,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';

export function reviewPhotoPath(productId: string, reviewId: string, revisionId: string) {
  return `/api/reviews/products/${encodeURIComponent(productId)}/photos/${reviewId}/${revisionId}`;
}

export function readReviewPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result.split(',', 2)[1] ?? '')
        : reject(new Error('photo'));
    reader.onerror = () => reject(new Error('photo'));
    reader.readAsDataURL(file);
  });
}

type Props = {
  locale: 'fa' | 'en';
  file: File | null;
  path: string | null;
  fetcher: CartFetch;
  onFile: (file: File | null, remove: boolean) => void;
  remove: boolean;
};
export function ReviewPhotoInput({ locale, file, path, fetcher, onFile, remove }: Props) {
  const id = useId();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [viewExisting, setViewExisting] = useState(false);
  const [existingState, setExistingState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const localPath = path && !file && !remove && viewExisting ? path : null;
  useEffect(() => {
    let url = '';
    const abort = new AbortController();
    if (file) {
      url = URL.createObjectURL(file);
      setPreview(url);
    } else if (localPath) {
      setPreview('');
      setExistingState('loading');
      void fetcher(localPath + '/mine', { method: 'GET', signal: abort.signal })
        .then(async (r) => {
          if (!r.ok || r.headers.get('content-type') !== 'image/webp') throw new Error('photo');
          const image = await r.blob();
          if (!abort.signal.aborted) {
            url = URL.createObjectURL(image);
            setPreview(url);
            setExistingState('ready');
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) setExistingState('error');
        });
    } else setPreview('');
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, fetcher, localPath]);
  return (
    <div className="review-photo-input">
      <div>
        <strong>{text('عکس کالا', 'Product photo')}</strong>
        <small id={id}>
          {text(
            'اختیاری · یک تصویر JPG، PNG یا WebP تا ۲ مگابایت. عکس بعد از تأیید همراه دیدگاه منتشر می‌شود.',
            'Optional · one JPG, PNG or WebP up to 2 MB. Photos appear with your review after moderation.',
          )}
        </small>
      </div>
      <div className="review-photo-tools">
        <label className="review-photo-pick">
          <ImagePlus size={17} aria-hidden="true" />
          <span>
            {file || (path && !remove)
              ? text('تعویض عکس', 'Replace photo')
              : text('انتخاب عکس', 'Choose photo')}
          </span>
          <input
            type="file"
            aria-describedby={id}
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const picked = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (!picked) return;
              if (
                !reviewPhotoMime.safeParse(picked.type).success ||
                !picked.size ||
                picked.size > reviewPhotoMaxBytes ||
                picked.name.length > 120
              ) {
                setError(
                  text(
                    'نوع فایل، نام و اندازهٔ تصویر را بررسی کنید؛ حداکثر ۲ مگابایت.',
                    'Check the image format, filename and size; maximum 2 MB.',
                  ),
                );
                return;
              }
              setError('');
              onFile(picked, false);
            }}
          />
        </label>
        {!file && path && !remove && !viewExisting && (
          <button type="button" onClick={() => setViewExisting(true)}>
            <Camera size={16} aria-hidden="true" />
            {text('دیدن عکس ثبت‌شده', 'View saved photo')}
          </button>
        )}
        {(file || (path && !remove)) && (
          <button
            type="button"
            onClick={() => {
              setError('');
              onFile(null, !file);
            }}
          >
            <X size={16} aria-hidden="true" />
            {file ? text('لغو انتخاب', 'Discard selection') : text('حذف عکس', 'Remove photo')}
          </button>
        )}
        {remove && (
          <button type="button" onClick={() => onFile(null, false)}>
            {text('لغو حذف', 'Undo removal')}
          </button>
        )}
      </div>
      {file && <small dir="auto">{file.name}</small>}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- Private photo preview uses a revocable browser object URL.
        <img
          className="review-photo-thumb"
          src={preview}
          alt={text('پیش‌نمایش عکس دیدگاه', 'Review photo preview')}
        />
      )}
      {localPath && existingState === 'loading' && (
        <small role="status">{text('در حال دریافت عکس…', 'Loading photo…')}</small>
      )}
      {localPath && existingState === 'error' && (
        <button type="button" onClick={() => setViewExisting(false)}>
          {text('عکس دریافت نشد؛ بازگشت', 'Photo unavailable; go back')}
        </button>
      )}
      {error && (
        <small className="review-photo-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
