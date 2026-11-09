'use client';
import { useEffect, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { VoteValue } from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
import { voteReview } from '@/lib/reviews/reviews-client';
import { CartError, type CartFetch } from '@/lib/checkout/cart-client';
import Link from '../navigation/localized-link';
import { useI18n } from '../navigation/locale-provider';

export function ReviewVoteCounts({ likes, dislikes }: { likes: number; dislikes: number }) {
  const { locale, digits } = useI18n();
  return (
    <div className="review-votes">
      <span>
        <ThumbsUp size={16} aria-hidden="true" />
        <span className="sr-only">{locale === 'fa' ? 'لایک: ' : 'Likes: '}</span>
        {digits(likes)}
      </span>
      <span>
        <ThumbsDown size={16} aria-hidden="true" />
        <span className="sr-only">{locale === 'fa' ? 'دیس‌لایک: ' : 'Dislikes: '}</span>
        {digits(dislikes)}
      </span>
    </div>
  );
}

export function ReviewVoteBar({
  id,
  revisionId,
  likes,
  dislikes,
  current,
  own,
  fetcher,
  signIn,
  onVoted,
}: {
  id: string;
  revisionId: string;
  likes: number;
  dislikes: number;
  current?: VoteValue;
  own: boolean;
  fetcher?: CartFetch;
  signIn?: string;
  onVoted: (value: VoteValue, likes: number, dislikes: number) => void;
}) {
  const { locale, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const retry = useRef<{ command: string; value: VoteValue } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function vote(value: VoteValue) {
    if (!fetcher || current === undefined || busy || own) return;
    const operation = retry.current ?? { command: crypto.randomUUID().replaceAll('-', ''), value };
    retry.current = operation;
    const controller = new AbortController();
    abort.current = controller;
    setError('');
    setBusy(true);
    try {
      const result = await voteReview(
        fetcher,
        id,
        operation.command,
        revisionId,
        operation.value,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        retry.current = null;
        onVoted(result.value, result.likes, result.dislikes);
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (
        failure instanceof CartError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 429
      ) {
        retry.current = null;
        setError(
          text(
            'رأی ثبت نشد؛ ممکن است دیدگاه تغییر کرده باشد.',
            'Vote not saved. The review may have changed.',
          ),
        );
      } else setError(text('نتیجهٔ ثبت رأی مشخص نیست.', 'The vote result is unknown.'));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (own || !fetcher)
    return (
      <div className="review-reaction-row">
        <ReviewVoteCounts likes={likes} dislikes={dislikes} />
        {signIn && !own && (
          <Link className="product-community-link" href={signIn}>
            {text('ورود برای رأی', 'Sign in to vote')}
          </Link>
        )}
      </div>
    );
  return (
    <div className="review-reaction-row">
      <div
        className="review-votes"
        role="group"
        aria-label={text('این دیدگاه مفید بود؟', 'Was this review helpful?')}
      >
        {(
          [
            { value: 1, label: text('لایک', 'Like'), Icon: ThumbsUp, count: likes },
            { value: -1, label: text('دیس‌لایک', 'Dislike'), Icon: ThumbsDown, count: dislikes },
          ] as const
        ).map(({ value, label, Icon, count }) => (
          <button
            type="button"
            key={value}
            aria-pressed={current === value}
            aria-label={label + ': ' + digits(count)}
            disabled={busy || current === undefined || !!retry.current}
            onClick={() => void vote(current === value ? 0 : value)}
          >
            <Icon size={17} aria-hidden="true" />
            {digits(count)}
          </button>
        ))}
      </div>
      {error && <p role="status">{error}</p>}
      {!!retry.current && !busy && (
        <button
          type="button"
          className="product-community-link"
          onClick={() => void vote(retry.current?.value ?? 0)}
        >
          {text('پیگیری همان رأی', 'Retry vote')}
        </button>
      )}
    </div>
  );
}
