import { useEffect, useRef, type ReactNode } from 'react';

export function FinanceReviewBox({
  title,
  children,
  blocked,
  backBlocked,
  pending,
  onBack,
  onConfirm,
  action = 'تأیید و ذخیره',
}: {
  title: string;
  children: ReactNode;
  blocked?: boolean;
  backBlocked?: boolean;
  pending?: boolean;
  onBack: () => void;
  onConfirm: () => void;
  action?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <section className="finance-review-box" ref={ref} tabIndex={-1} aria-label={title}>
      <h3>{title}</h3>
      {children}
      <div className="row-buttons">
        <button type="button" disabled={pending || backBlocked} onClick={onBack}>
          بازگشت به فرم
        </button>
        <button type="button" className="primary" disabled={pending || blocked} onClick={onConfirm}>
          {pending ? 'در حال ثبت…' : action}
        </button>
      </div>
    </section>
  );
}
