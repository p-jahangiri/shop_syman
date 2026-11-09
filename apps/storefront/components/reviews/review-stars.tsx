import { useId, useState } from 'react';
import { Star } from 'lucide-react';

const values = [1, 2, 3, 4, 5];

export function ReviewStars({ rating, locale }: { rating: number; locale: 'fa' | 'en' }) {
  const score = rating.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  return (
    <span
      className="review-stars"
      role="img"
      aria-label={locale === 'fa' ? `${score} از ۵` : `${score} out of 5`}
    >
      {values.map((n) => (
        <Star key={n} size={17} aria-hidden="true" data-filled={n <= rating} />
      ))}
    </span>
  );
}

export function ReviewStarInput({
  initial,
  locale,
  onChange,
  name = 'rating',
}: {
  initial: number;
  locale: 'fa' | 'en';
  onChange?: (rating: number) => void;
  name?: string;
}) {
  const [rating, setRating] = useState(initial);
  const hint = useId();
  return (
    <fieldset className="review-rating-input" aria-describedby={hint}>
      <legend>{locale === 'fa' ? 'امتیاز شما' : 'Your rating'}</legend>
      <div className="review-rating-options" dir="ltr">
        {values.map((n) => {
          const score = n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
          return (
            <label key={n} data-filled={n <= rating}>
              <input
                type="radio"
                name={name}
                value={n}
                required
                checked={rating === n}
                onChange={() => {
                  setRating(n);
                  onChange?.(n);
                }}
                aria-label={locale === 'fa' ? `${score} از ۵` : `${score} out of 5`}
              />
              <Star aria-hidden="true" size={23} />
            </label>
          );
        })}
      </div>
      <small id={hint}>
        {rating
          ? locale === 'fa'
            ? `${rating.toLocaleString('fa-IR')} از ۵`
            : `${rating} out of 5`
          : locale === 'fa'
            ? 'یک تا پنج ستاره انتخاب کنید.'
            : 'Choose one to five stars.'}
      </small>
    </fieldset>
  );
}
