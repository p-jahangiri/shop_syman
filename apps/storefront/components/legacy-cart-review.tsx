'use client';
import { useEffect, useState } from 'react';
import { Modal, Button } from './ui';
import { useI18n } from './locale-provider';
import { lookupProducts } from '@/lib/catalog-client';
import { findVariant } from '@/lib/commerce';
import type { CartLine, Product } from '@/lib/types';
export function LegacyCartReview({
  open,
  onOpenChange,
  lines,
  busy,
  onImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lines: CartLine[];
  busy: boolean;
  onImport: (ids: string[]) => void;
}) {
  const { locale, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [products, setProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(false);
    async function load() {
      try {
        const results: Product[] = [];
        const ids = [...new Set(lines.map((l) => l.variantId))];
        for (let i = 0; i < ids.length; i += 64)
          results.push(
            ...(await lookupProducts(
              locale,
              { variantIds: ids.slice(i, i + 64) },
              controller.signal,
            )),
          );
        if (cancelled) return;
        setProducts(results);
        setSelected(
          ids.filter((id) => (findVariant(results, id)?.variant.stock ?? 0) > 0).slice(0, 64),
        );
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, lines, locale, attempt]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={text('انتخاب‌های قبلی شما', 'Your previous selections')}
      description={text(
        'کالاهای دلخواه را منتقل کنید. برای کالای مشترک، تعداد بیشتر حفظ می‌شود؛ انتخاب‌های منتقل‌نشده باقی می‌مانند.',
        'Choose items to transfer. Shared items keep the higher quantity; untransferred selections remain saved.',
      )}
    >
      {loading ? (
        <p role="status">{text('در حال بررسی کالاها…', 'Checking items…')}</p>
      ) : error ? (
        <div role="alert">
          <p>
            {text(
              'بررسی انجام نشد؛ انتخاب‌ها حفظ شده‌اند.',
              'Items could not be checked. Your selections are preserved.',
            )}
          </p>
          <Button onClick={() => setAttempt((n) => n + 1)}>{text('تلاش دوباره', 'Retry')}</Button>
        </div>
      ) : (
        <>
          <div className="legacy-cart-lines">
            {lines.map((line) => {
              const found = findVariant(products, line.variantId);
              const available = !!found?.variant.stock;
              return (
                <label className="check-label" key={line.variantId}>
                  <input
                    type="checkbox"
                    checked={selected.includes(line.variantId)}
                    disabled={!available || busy}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, line.variantId]
                          : old.filter((id) => id !== line.variantId),
                      )
                    }
                  />
                  <span>
                    {found?.product.name ??
                      text('کالای خارج از فهرست فعلی', 'Item outside the current catalogue')}{' '}
                    {found?.variant.label} · {digits(line.quantity)}
                    {!available && (
                      <small>
                        {' '}
                        · {text('فعلاً قابل انتقال نیست', 'Currently unavailable for transfer')}
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="small-note">
            {text(
              'موجودی و تعداد هنگام انتقال دوباره بررسی می‌شوند.',
              'Stock and quantities are checked again when transferring.',
            )}
          </p>
          <Button
            className="full"
            disabled={busy || !selected.length || selected.length > 64}
            onClick={() => onImport(selected)}
          >
            {busy
              ? text('در حال ذخیره…', 'Saving…')
              : text('انتقال انتخاب‌ها', 'Transfer selections')}
          </Button>
        </>
      )}
    </Modal>
  );
}
