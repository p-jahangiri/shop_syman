'use client';

import { normalizePersian } from '../../lib/shared/commerce';

export type ShoppingRequest = {
  kind: 'phone' | 'product-question';
  product?: string;
  examples?: boolean;
  slug?: string;
  variant?: string;
  variantId?: string;
  color?: string;
  storage?: string;
  isPhone?: boolean;
};

export const shoppingMarker = { phone: '[phone]', 'product-question': '[product-question]' };

export function shoppingRequestContent(
  form: FormData,
  request: ShoppingRequest,
  locale: 'fa' | 'en',
) {
  const value = (key: string) => String(form.get(key) ?? '').trim();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const name = request.product ?? value('model');
  if (!name || /[\n\t]/.test(name)) return null;
  if (request.kind === 'product-question') {
    const body = value('body');
    return body.length >= 10 && body.length <= 240
      ? {
          subject: shoppingMarker[request.kind] + ' ' + name.slice(0, 95),
          body: [request.slug, body].filter(Boolean).join('\n\n'),
        }
      : null;
  }
  const digits = normalizePersian(value('budget')).replace(/[٬,\s]/g, '');
  if (digits && !/^[1-9][0-9]{0,16}$/.test(digits)) return null;
  const rial = digits ? BigInt(digits) * 10n : null;
  if (rial !== null && rial > 9223372036854775807n) return null;
  return {
    subject: shoppingMarker.phone + ' ' + name.slice(0, 100),
    body: [
      [text('مدل', 'Model'), name],
      [text('تنوع انتخاب‌شده در فروشگاه', 'Selected store variant'), request.variant ?? ''],
      [
        text('نشانی کالا', 'Product path'),
        request.slug ? `/${locale}/product/${request.slug}` : '',
      ],
      [text('شناسهٔ تنوع', 'Variant ID'), request.variantId ?? ''],
      [text('رنگ', 'Color'), request.color || value('color')],
      [text('حافظه', 'Storage'), request.storage || value('storage')],
      [text('سقف بودجه (تومان)', 'Maximum budget (toman)'), digits],
      [text('توضیحات', 'Notes'), value('body')],
    ]
      .filter(([, detail]) => detail)
      .map(([label, detail]) => label + ' — ' + detail)
      .join('\n'),
  };
}

export function ShoppingRequestFields({
  request,
  locale,
}: {
  request: ShoppingRequest;
  locale: 'fa' | 'en';
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  if (request.kind === 'product-question')
    return (
      <>
        <p>
          <bdi>{request.product}</bdi>
        </p>
        <label className="ticket-field">
          <span>{text('سؤال شما؛ ۱۰ تا ۲۴۰ نویسه', 'Your question; 10–240 characters')}</span>
          <textarea name="body" required rows={4} minLength={10} maxLength={240} />
        </label>
      </>
    );
  const showStorage = request.isPhone !== false || Boolean(request.storage);
  return (
    <>
      <p>
        {text(
          'جزئیات دلخواه و سقف بودجه را وارد کنید. پاسخ را در همین بخش و اعلان‌های حساب می‌بینید.',
          'Add your preferences and budget. Replies appear here and in your account notifications.',
        )}
      </p>
      {request.variant && (
        <p>
          {text('تنوع انتخاب‌شده', 'Selected variant')} · {request.variant}
        </p>
      )}
      <label className="ticket-field">
        <span>{text('مدل کالا', 'Product model')}</span>
        <input
          name="model"
          required
          maxLength={100}
          defaultValue={request.product}
          readOnly={Boolean(request.product)}
          placeholder={text('مثلاً آیفون ۱۴', 'For example, iPhone 14')}
        />
      </label>
      <label className="ticket-field">
        <span>{text('رنگ دلخواه', 'Preferred color')}</span>
        <input
          name="color"
          maxLength={40}
          defaultValue={request.color}
          readOnly={Boolean(request.color)}
        />
      </label>
      {showStorage && (
        <label className="ticket-field">
          <span>{text('حافظهٔ دلخواه', 'Preferred storage')}</span>
          <input
            name="storage"
            maxLength={40}
            defaultValue={request.storage}
            readOnly={Boolean(request.storage)}
            placeholder={text('مثلاً ۲۵۶ گیگابایت', 'For example, 256 GB')}
          />
        </label>
      )}
      <label className="ticket-field">
        <span>{text('سقف بودجه به تومان', 'Maximum budget in toman')}</span>
        <input name="budget" inputMode="numeric" maxLength={24} />
      </label>
      <label className="ticket-field">
        <span>{text('توضیح بیشتر', 'Additional notes')}</span>
        <textarea name="body" rows={3} maxLength={1400} />
      </label>
      {request.examples && (
        <details>
          <summary>{text('نمونه‌های توسعه', 'Development examples')}</summary>
          <ul>
            <li>
              {text(
                'آیفون ۱۴، مشکی، ۲۵۶ گیگابایت، سقف ۵۰ میلیون تومان',
                'iPhone 14, black, 256 GB, up to 50 million toman',
              )}
            </li>
            <li>
              {text(
                'گلکسی S25، هر رنگ، ۱۲۸ گیگابایت، بودجه باز',
                'Galaxy S25, any color, 128 GB, flexible budget',
              )}
            </li>
          </ul>
        </details>
      )}
    </>
  );
}
