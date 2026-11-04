'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { UsedCondition } from '../../lib/catalog/used-condition-contract';
import type { Locale } from '../../lib/shared/types';
import { publicImageVariant } from '../../lib/media/media-paths';

// Shared by the storefront and Vite admin: no Next/router/provider dependency.
// Persisted URLs stay canonical; only admin preview adds the explicit /api base.
export function UsedConditionGallery({
  photos,
  locale,
  mediaPrefix = '',
}: {
  photos: NonNullable<UsedCondition['photos']>;
  locale: Locale;
  mediaPrefix?: '' | '/api';
}) {
  const [selected, setSelected] = useState<number | null>(null),
    dialog = useRef<HTMLDialogElement>(null),
    restore = useRef<HTMLElement | null>(null),
    title = useId(),
    fa = locale === 'fa';
  const photo = selected === null ? undefined : photos[selected];
  useEffect(() => {
    const node = dialog.current;
    if (photo) {
      restore.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node?.showModal();
    }
    return () => {
      node?.close();
      if (restore.current?.isConnected) restore.current.focus({ preventScroll: true });
    };
  }, [photo]);
  return (
    <div className="used-condition-gallery">
      <p>
        {fa
          ? 'تصاویر ثبت‌شدهٔ همین دستگاه در این نسخهٔ بازرسی'
          : 'This unit’s photos recorded with this inspection revision'}
      </p>
      <div className="gallery-thumbnails" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {photos.map((item, index) => (
          <button
            type="button"
            key={item.url}
            onClick={() => setSelected(index)}
            aria-label={(fa ? 'بزرگنمایی: ' : 'Enlarge: ') + (fa ? item.altFa : item.altEn)}
          >
            <img
              src={mediaPrefix + publicImageVariant(item.url, 'thumb')}
              alt={fa ? item.altFa : item.altEn}
              width={96}
              height={80}
              loading="lazy"
              decoding="async"
              style={{ objectFit: 'contain' }}
            />
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        aria-labelledby={title}
        onCancel={() => setSelected(null)}
        style={{
          width: 'min(960px, calc(100vw - 32px))',
          maxHeight: '90dvh',
          padding: 16,
          borderRadius: 16,
        }}
      >
        <div className="dialog-head">
          <h3 id={title}>{fa ? 'تصویر همین دستگاه' : 'This unit’s photo'}</h3>
          <button type="button" onClick={() => setSelected(null)}>
            {fa ? 'بستن' : 'Close'}
          </button>
        </div>
        {photo && (
          <>
            <img
              src={mediaPrefix + publicImageVariant(photo.url, 'zoom')}
              alt={fa ? photo.altFa : photo.altEn}
              width={960}
              height={720}
              decoding="async"
              style={{ display: 'block', maxWidth: '100%', height: 'auto', objectFit: 'contain' }}
            />
            <p>{fa ? photo.altFa : photo.altEn}</p>
          </>
        )}
      </dialog>
    </div>
  );
}
