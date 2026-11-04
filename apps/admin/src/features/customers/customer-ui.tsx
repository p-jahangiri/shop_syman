export const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
export const count = (value: string) => BigInt(value).toLocaleString('fa-IR');
export const money = (value: string) => count(value) + ' ریال';
export const states: Record<string, string> = {
  AwaitingPayment: 'در انتظار پرداخت',
  Paid: 'پرداخت‌شده',
  Cancelled: 'لغوشده',
  Expired: 'منقضی',
  Fulfilled: 'تحویل‌شده',
  CreditApproved: 'خرید چکی تأییدشده',
  Open: 'باز',
  WaitingCustomer: 'منتظر پاسخ مشتری',
  Closed: 'بسته',
};

export function CustomerPager({
  pages,
  next,
  busy,
  onChange,
}: {
  pages: (string | null)[];
  next: string | null;
  busy: boolean;
  onChange: (pages: (string | null)[]) => void;
}) {
  return (
    <div className="pagination">
      <button disabled={pages.length === 1 || busy} onClick={() => onChange(pages.slice(0, -1))}>
        صفحهٔ قبل
      </button>
      <span>صفحهٔ {pages.length.toLocaleString('fa-IR')}</span>
      <button
        disabled={!next || busy}
        onClick={() => {
          if (next) onChange([...pages, next]);
        }}
      >
        صفحهٔ بعد
      </button>
    </div>
  );
}
