'use client';
import { ExternalLink } from 'lucide-react';
import { useI18n } from '../navigation/locale-provider';
import { marketFreshness, type MarketItem } from '@sayman/web-shared/lib/market/market-contract.ts';
import { marketCopy } from '@/lib/market/market-copy';
export function MarketObservation({
  item,
  now,
  detail = false,
}: {
  item: Omit<MarketItem, 'id' | 'model'>;
  now: number;
  detail?: boolean;
}) {
  const { locale, toman } = useI18n(),
    copy = marketCopy(locale),
    fresh = marketFreshness(item, now);
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: detail ? 'short' : undefined,
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  return (
    <div className="market-observation">
      <span className={`market-state market-state-${fresh.availability}`}>
        {copy[fresh.availability]}
      </span>
      <div className="market-reference">
        <span>
          {item.referencePriceRial
            ? fresh.priceCurrent
              ? copy.reference
              : copy.expiredPrice
            : copy.reference}
        </span>
        {item.referencePriceRial ? (
          <strong className={!fresh.priceCurrent ? 'is-expired' : undefined}>
            <bdi>{toman(item.referencePriceRial)}</bdi> <small>{copy.toman}</small>
          </strong>
        ) : (
          <strong className="market-no-price">{copy.unknownPrice}</strong>
        )}
        <small>{copy.notPayable}</small>
      </div>
      <dl className="market-source">
        <div>
          <dt>{copy.source}</dt>
          <dd>
            {item.sourceUrl ? (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label={`${item.sourceName} — ${copy.sourceLink}`}
              >
                {item.sourceName}
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : (
              item.sourceName
            )}
          </dd>
        </div>
        <div>
          <dt>{copy.observed}</dt>
          <dd>
            {item.observedAt ? (
              <time dateTime={item.observedAt}>{format(item.observedAt)}</time>
            ) : (
              copy.undated
            )}
          </dd>
        </div>
        <div>
          <dt>{copy.validUntil}</dt>
          <dd>
            {item.validUntil ? (
              <time dateTime={item.validUntil}>{format(item.validUntil)}</time>
            ) : (
              copy.undated
            )}
          </dd>
        </div>
      </dl>
      {detail && (
        <>
          <small className="muted">{copy.tehran}</small>
          <p className="market-source-note">{copy.sourceDisclaimer}</p>
        </>
      )}
    </div>
  );
}
