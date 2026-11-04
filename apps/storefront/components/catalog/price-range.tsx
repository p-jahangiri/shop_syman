'use client';
import { useRef, useState, type PointerEvent } from 'react';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
import { tomanInput } from '@sayman/web-shared/lib/shared/money.ts';
import { parseCatalogPriceRange } from '@/lib/catalog/catalog-filter-state';
import {
  CATALOG_PRICE_SLIDER_STEPS,
  catalogPriceDomain,
  catalogPriceForThumb,
  catalogPriceInput,
  catalogPricePosition,
} from '@/lib/catalog/catalog-price-range';

type Bound = 'min' | 'max';
export function CatalogPriceRange({
  value,
  maximumRial,
  locale,
  error,
  errorId,
  busy,
  disabled,
  onChange,
}: {
  value: { min: string; max: string };
  maximumRial?: string;
  locale: Locale;
  error: 'minimum' | 'maximum' | 'order' | null;
  errorId: string;
  busy: boolean;
  disabled: boolean;
  onChange: (bound: Bound, value: string) => void;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [editing, setEditing] = useState<Bound>();
  const [active, setActive] = useState<Bound>();
  const dragging = useRef<Bound | undefined>(undefined);
  const domain = catalogPriceDomain(undefined, maximumRial);
  const minimum = parseCatalogPriceRange(value.min, '');
  const maximum = parseCatalogPriceRange('', value.max);
  const lowerRial = minimum.ok ? minimum.value.minPriceRial : undefined;
  const upperRial = maximum.ok ? maximum.value.maxPriceRial : undefined;
  const upper = domain
    ? catalogPricePosition(upperRial ?? domain.maxRial, domain)
    : CATALOG_PRICE_SLIDER_STEPS;
  const lower = domain
    ? Math.min(upper, catalogPricePosition(lowerRial ?? domain.minRial, domain))
    : 0;
  const sliderDisabled = disabled || !domain || domain.minRial === domain.maxRial;

  function displayed(bound: Bound) {
    const rial = bound === 'min' ? lowerRial : upperRial;
    return editing === bound || rial === undefined ? value[bound] : catalogPriceInput(rial, locale);
  }
  function change(bound: Bound, position: number) {
    if (!domain || sliderDisabled) return;
    const tick = bound === 'min' ? Math.min(position, upper) : Math.max(position, lower);
    const rial = catalogPriceForThumb(tick, domain, bound, bound === 'min' ? upperRial : lowerRial);
    onChange(bound, rial === undefined ? '' : tomanInput(rial));
  }
  function pointerPosition(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left - 11) / Math.max(1, rect.width - 22)),
    );
    return Math.round((locale === 'fa' ? 1 - position : position) * CATALOG_PRICE_SLIDER_STEPS);
  }
  function startTrack(event: PointerEvent<HTMLDivElement>) {
    if (sliderDisabled || event.button !== 0 || (event.target as HTMLElement).tagName === 'INPUT')
      return;
    event.preventDefault();
    const position = pointerPosition(event);
    const lowerDistance = Math.abs(position - lower);
    const upperDistance = Math.abs(position - upper);
    const bound =
      lowerDistance === upperDistance
        ? position < lower
          ? 'min'
          : 'max'
        : lowerDistance < upperDistance
          ? 'min'
          : 'max';
    dragging.current = bound;
    setActive(bound);
    event.currentTarget.setPointerCapture(event.pointerId);
    change(bound, position);
  }
  const lowerText = catalogPriceInput(lowerRial ?? domain?.minRial ?? 0n, locale);
  const upperText =
    upperRial !== undefined || domain
      ? catalogPriceInput(upperRial ?? domain!.maxRial, locale)
      : text('بدون سقف', 'No limit');

  return (
    <div className="catalog-price-range">
      <div className="price-range-fields">
        {(['min', 'max'] as const).map((bound) => (
          <label className="price-range-row" key={bound}>
            <span className="price-range-label">
              {bound === 'min' ? text('از', 'From') : text('تا', 'To')}
            </span>
            <input
              aria-label={
                bound === 'min'
                  ? text('حداقل قیمت به تومان', 'Minimum price in toman')
                  : text('حداکثر قیمت به تومان', 'Maximum price in toman')
              }
              inputMode="decimal"
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              value={displayed(bound)}
              placeholder={bound === 'min' ? lowerText : upperText}
              onBlur={() => setEditing(undefined)}
              onChange={(event) => {
                setEditing(bound);
                onChange(bound, event.target.value);
              }}
              aria-invalid={
                error === (bound === 'min' ? 'minimum' : 'maximum') || error === 'order'
              }
              aria-describedby={error ? errorId : undefined}
            />
            <span className="price-range-unit" aria-hidden="true">
              {text('تومان', 'toman')}
            </span>
          </label>
        ))}
      </div>
      <div
        className={`price-slider${sliderDisabled ? ' is-disabled' : ''}`}
        onPointerDown={startTrack}
        onPointerMove={(event) => {
          if (dragging.current && event.currentTarget.hasPointerCapture(event.pointerId))
            change(dragging.current, pointerPosition(event));
        }}
        onPointerUp={(event) => {
          dragging.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = undefined;
        }}
      >
        <div className="price-slider-rail" aria-hidden="true">
          <span
            style={{ insetInlineStart: `${lower / 10}%`, insetInlineEnd: `${100 - upper / 10}%` }}
          />
        </div>
        <input
          type="range"
          aria-label={text('دستگیره حداقل قیمت', 'Minimum price slider')}
          min={0}
          max={CATALOG_PRICE_SLIDER_STEPS}
          step={1}
          value={lower}
          aria-valuemax={upper}
          aria-valuetext={`${lowerText} ${text('تومان', 'toman')}`}
          disabled={sliderDisabled}
          onFocus={() => setActive('min')}
          onChange={(event) => change('min', Number(event.target.value))}
          style={{ zIndex: lower === CATALOG_PRICE_SLIDER_STEPS ? 6 : active === 'min' ? 5 : 3 }}
        />
        <input
          type="range"
          aria-label={text('دستگیره حداکثر قیمت', 'Maximum price slider')}
          min={0}
          max={CATALOG_PRICE_SLIDER_STEPS}
          step={1}
          value={upper}
          aria-valuemin={lower}
          aria-valuetext={`${upperText} ${text('تومان', 'toman')}`}
          disabled={sliderDisabled}
          onFocus={() => setActive('max')}
          onChange={(event) => change('max', Number(event.target.value))}
          style={{ zIndex: upper === 0 ? 6 : active === 'max' ? 5 : 4 }}
        />
      </div>
      <div className="price-range-extremes" aria-hidden="true">
        <span>{text('ارزان‌ترین', 'Cheapest')}</span>
        <span className="price-range-tick">|</span>
        <span>{text('گران‌ترین', 'Most expensive')}</span>
      </div>
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error === 'order'
            ? text(
                'حداقل قیمت باید کمتر یا برابر حداکثر باشد.',
                'Minimum price must not exceed maximum price.',
              )
            : text(
                'مبلغ معتبر تومان با حداکثر یک رقم اعشار وارد کنید.',
                'Enter a valid toman amount with up to one decimal place.',
              )}
        </p>
      ) : (
        busy && (
          <p className="filter-note filter-auto-note" role="status">
            {text('در حال به‌روزرسانی نتایج…', 'Updating results…')}
          </p>
        )
      )}
    </div>
  );
}
