import {
  paymentFilterSchema,
  type PaymentFilter,
  type PaymentItem,
} from '@sayman/web-shared/lib/orders/payment-contract.ts';
import { normalizeAdminListText } from '../../utils/admin-list-text.ts';

export function paymentOrderFilter(value: string): string | null {
  const input = normalizeAdminListText(value);
  const orderId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input)
    ? input.replaceAll('-', '')
    : input;
  return paymentFilterSchema.parse({ state: null, orderId: orderId || null }).orderId;
}

export const paymentStateLabels: Record<NonNullable<PaymentFilter['state']>, string> = {
  review: 'نیازمند تطبیق',
  pending: 'در انتظار تأیید درگاه',
  initiating: 'آغاز درگاه؛ نتیجه نامشخص',
  created: 'درخواست ثبت شده',
  verified: 'پرداخت اعمال شده',
  failed: 'ناموفق',
  cancelled: 'لغوشده',
};

const reasonLabels: Record<string, string> = {
  payment_reference_already_used: 'مدرک پرداخت قبلاً استفاده شده است.',
  payment_attempt_state_conflict: 'وضعیت تلاش هنگام تأیید درگاه قابل اعمال نبود.',
  payment_attempt_bound_elsewhere: 'شناسهٔ این تلاش یا تأیید به ثبت دیگری مرتبط است.',
  payment_original_snapshot_changed: 'اطلاعات سفارش با نسخهٔ زمان درخواست هم‌خوان نیست.',
  payment_amount_or_method_mismatch: 'مبلغ یا روش پرداخت با سفارش هم‌خوان نیست.',
  order_already_paid: 'برای این سفارش قبلاً پرداخت ثبت شده است.',
  order_not_awaiting_payment: 'سفارش در وضعیت انتظار پرداخت نبود.',
  payment_after_order_deadline: 'تأیید بعد از پایان مهلت سفارش ثبت شده است.',
  reservation_not_active: 'رزرو موجودی سفارش فعال نبود.',
  reservation_not_allocated: 'تخصیص رزرو موجودی قطعی نشد.',
  verified_amount_and_reservation: 'مبلغ و رزرو تأیید و پرداخت در سفارش ثبت شد.',
};

export function paymentReasonLabel(code: string) {
  return Object.hasOwn(reasonLabels, code)
    ? reasonLabels[code]
    : 'دلیل ثبت‌شده را با کد زیر پیگیری کنید.';
}

export function paymentRialDifference(
  item: Pick<PaymentItem, 'amountRial' | 'verifiedAmountRial'>,
) {
  return item.verifiedAmountRial === null
    ? null
    : BigInt(item.verifiedAmountRial) - BigInt(item.amountRial);
}
