import { useEffect, useId, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { CartFetch } from '@/lib/checkout/cart-client';
import {
  reviewPhotoMaxBytes,
  reviewPhotoMaxCount,
  reviewPhotoMime,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';

export function reviewPhotoPath(productId: string, reviewId: string, revisionId: string, slot = 1) {
  return `/api/reviews/products/${encodeURIComponent(productId)}/photos/${reviewId}/${revisionId}${slot > 1 ? '/' + slot : ''}`;
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

export type DraftPhoto = { id: string; file: File } | { id: string; path: string; slot: number };
type Props = {
  locale: 'fa' | 'en';
  photos: DraftPhoto[];
  fetcher: CartFetch;
  onChange: (photos: DraftPhoto[]) => void;
};

export function ReviewPhotoInput({ locale, photos, fetcher, onChange }: Props) {
  const id = useId();
  const [error, setError] = useState('');
  const fa = locale === 'fa';
  const text = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="review-photo-input">
      <div>
        <strong>{text('عکس‌های کالا', 'Product photos')}</strong>
        <small id={id}>
          {text(
            'اختیاری · تا ۳ عکس JPG، PNG یا WebP؛ هر عکس حداکثر ۲ مگابایت. عکس‌ها همراه دیدگاه و پس از تأیید منتشر می‌شوند.',
            'Optional · up to 3 JPG, PNG or WebP photos, 2 MB each. Photos appear with the review after approval.',
          )}
        </small>
      </div>
      <div className="review-photo-tools">
        {photos.map((photo, i) => (
          <div key={photo.id} className="review-photo-selection">
            <PhotoPreview photo={photo} fetcher={fetcher} locale={locale} />
            <button
              type="button"
              aria-label={text(
                `حذف عکس ${(i + 1).toLocaleString('fa-IR')}`,
                `Remove photo ${i + 1}`,
              )}
              onClick={() => {
                setError('');
                onChange(photos.filter((item) => item.id !== photo.id));
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
        {photos.length < reviewPhotoMaxCount && (
          <label className="review-photo-pick">
            <ImagePlus size={17} aria-hidden="true" />
            <span>{text('افزودن عکس', 'Add photos')}</span>
            <input
              type="file"
              multiple
              aria-describedby={id}
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (!files.length) return;
                if (files.length + photos.length > reviewPhotoMaxCount) {
                  setError(
                    text(
                      'در هر دیدگاه حداکثر ۳ عکس می‌توانید بفرستید.',
                      'You can add up to 3 photos per review.',
                    ),
                  );
                  return;
                }
                if (
                  files.some(
                    (file) =>
                      !reviewPhotoMime.safeParse(file.type).success ||
                      !file.size ||
                      file.size > reviewPhotoMaxBytes ||
                      file.name.length > 120,
                  )
                ) {
                  setError(
                    text(
                      'عکس JPG، PNG یا WebP تا ۲ مگابایت انتخاب کنید.',
                      'Choose JPG, PNG or WebP photos up to 2 MB.',
                    ),
                  );
                  return;
                }
                setError('');
                onChange([...photos, ...files.map((file) => ({ id: crypto.randomUUID(), file }))]);
              }}
            />
          </label>
        )}
      </div>
      <small role="status">
        {text(`${photos.length.toLocaleString('fa-IR')} از ۳ عکس`, `${photos.length} of 3 photos`)}
      </small>
      {error && (
        <small className="review-photo-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

function PhotoPreview({
  photo,
  fetcher,
  locale,
}: {
  photo: DraftPhoto;
  fetcher: CartFetch;
  locale: 'fa' | 'en';
}) {
  const file = 'file' in photo ? photo.file : null;
  const path = 'path' in photo ? photo.path : null;
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let url = '';
    const show = (blob: Blob) => {
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    };
    if (file) show(file);
    else if (path)
      void fetcher(path + '/mine', { method: 'GET', signal: abort.signal })
        .then(async (response) => {
          if (!response.ok || response.headers.get('content-type') !== 'image/webp')
            throw new Error('photo');
          show(await response.blob());
        })
        .catch(() => {
          if (!abort.signal.aborted) setFailed(true);
        });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, path, fetcher]);
  const label = failed
    ? locale === 'fa'
      ? 'عکس دریافت نشد'
      : 'Photo unavailable'
    : locale === 'fa'
      ? 'عکس دیدگاه'
      : 'Review photo';
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- Private preview uses a revocable object URL.
    <img className="review-photo-thumb" src={src} alt={label} />
  ) : (
    <span className="review-photo-placeholder" role="img" aria-label={label} title={label}>
      <ImagePlus size={19} aria-hidden="true" />
    </span>
  );
}
