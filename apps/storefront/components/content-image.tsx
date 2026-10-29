import { isProcessedImage } from '@/lib/media-paths';
import NextImage, { type ImageProps } from 'next/image';
// Remote CMS images are fetched by the browser, avoiding a server-side URL fetch.
export default function ContentImage(props: ImageProps) {
  return (
    <NextImage
      {...props}
      unoptimized={
        props.unoptimized ||
        (typeof props.src === 'string' &&
          (props.src.startsWith('https://') || isProcessedImage(props.src)))
      }
    />
  );
}
