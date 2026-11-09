'use client';

import { useState } from 'react';
import ContentImage from '@/components/media/content-image';

export function MagazineCover({
  cover,
  imageUrl,
  labels,
  sizes,
  priority = false,
}: {
  cover: string;
  imageUrl?: string | null;
  labels?: { source: string; illustration: string };
  sizes: string;
  priority?: boolean;
}) {
  const [imageState, setImageState] = useState<{ url: string; loaded: boolean }>();
  const publisherImage = imageState?.url === imageUrl ? imageState : undefined;
  return (
    <div className="magazine-cover">
      <ContentImage
        src={`/magazine/${cover}.webp`}
        width={768}
        height={512}
        alt=""
        sizes={sizes}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
      />
      {imageUrl && publisherImage?.loaded !== false && (
        <ContentImage
          key={imageUrl}
          src={imageUrl}
          className="magazine-publisher-image"
          data-loaded={publisherImage?.loaded === true}
          width={768}
          height={512}
          alt=""
          sizes={sizes}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setImageState({ url: imageUrl, loaded: true })}
          onError={() => setImageState({ url: imageUrl, loaded: false })}
        />
      )}
      {labels && <span>{publisherImage?.loaded ? labels.source : labels.illustration}</span>}
    </div>
  );
}
