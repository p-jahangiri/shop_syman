import { adminCreditReminderPolicyJournal } from '../../state/finance/admin-credit-reminder-policy-journal';
import { adminCreditReminderJournal } from '../../state/finance/admin-credit-reminder-journal';
import { adminCreditClearanceJournal } from '../../state/finance/admin-credit-clearance-journal';
import { adminReviewHoldPolicyJournal } from '../../state/finance/admin-review-hold-policy-journal';
import { adminChequeApprovalJournal } from '../../state/finance/admin-cheque-approval-journal';
import { adminCreditUpfrontJournal } from '../../state/finance/admin-credit-upfront-journal';
import { adminChequeLedgerJournal } from '../../state/finance/admin-cheque-ledger-journal';
import { useSyncExternalStore } from 'react';
import { adminCreditScheduleJournal as journal } from '../../state/finance/admin-credit-schedule-journal';
export function CreditScheduleCommandGuard({
  viewerId,
  onOpen,
}: {
  viewerId: string;
  onOpen: () => void;
}) {
  const entry = useSyncExternalStore(
    journal.subscribe,
    () => journal.snapshot(viewerId),
    () => null,
  );
  const cheque = useSyncExternalStore(
    adminChequeLedgerJournal.subscribe,
    () => adminChequeLedgerJournal.snapshot(viewerId),
    () => null,
  );
  const upfront = useSyncExternalStore(
    adminCreditUpfrontJournal.subscribe,
    () => adminCreditUpfrontJournal.snapshot(viewerId),
    () => null,
  );
  const approval = useSyncExternalStore(
    adminChequeApprovalJournal.subscribe,
    () => adminChequeApprovalJournal.snapshot(viewerId),
    () => null,
  );
  const hold = useSyncExternalStore(
    adminReviewHoldPolicyJournal.subscribe,
    () => adminReviewHoldPolicyJournal.snapshot(viewerId),
    () => null,
  );
  const clearance = useSyncExternalStore(
    adminCreditClearanceJournal.subscribe,
    () => adminCreditClearanceJournal.snapshot(viewerId),
    () => null,
  );
  const reminder = useSyncExternalStore(
    adminCreditReminderJournal.subscribe,
    () => adminCreditReminderJournal.snapshot(viewerId),
    () => null,
  );
  const policy = useSyncExternalStore(
    adminCreditReminderPolicyJournal.subscribe,
    () => adminCreditReminderPolicyJournal.snapshot(viewerId),
    () => null,
  );
  if (policy && ['pending', 'unknown'].includes(policy.state))
    return (
      <section className="notice credit-schedule-guard" role="status">
        <p>
          تنظیم زمان‌بندی یادآوری هنوز نتیجهٔ قطعی ندارد. شناسه: <bdi>{policy.command.id}</bdi>
        </p>
        <button onClick={onOpen}>پیگیری تنظیم یادآوری چک</button>
      </section>
    );
  if (reminder && ['pending', 'unknown'].includes(reminder.state))
    return (
      <section className="notice credit-schedule-guard" role="status">
        <p>
          یادآوری چک هنوز نتیجهٔ قطعی ندارد. شناسه: <bdi>{reminder.command.id}</bdi>
        </p>
        <button onClick={onOpen}>پیگیری یادآوری داخلی چک</button>
      </section>
    );
  if (clearance && ['pending', 'unknown'].includes(clearance.state))
    return (
      <section className="notice credit-schedule-guard" role="status">
        <p>
          مجوز مالی چکی هنوز نتیجهٔ قطعی ندارد. شناسه: <bdi>{clearance.command.id}</bdi>
        </p>
        <button onClick={onOpen}>پیگیری مجوز مالی چکی</button>
      </section>
    );
  if (hold && ['pending', 'unknown'].includes(hold.state))
    return (
      <section className="notice credit-schedule-guard" role="status">
        <p>
          مهلت چکی هنوز نتیجهٔ قطعی ندارد. شناسه: <bdi>{hold.command.id}</bdi>
        </p>
        <button onClick={onOpen}>پیگیری تنظیم مهلت چکی</button>
      </section>
    );
  if (approval && ['pending', 'unknown'].includes(approval.state))
    return (
      <section className="notice credit-schedule-guard" role="status">
        <p>
          تأیید دستی چک هنوز نتیجهٔ قطعی ندارد. شناسه: <bdi>{approval.command.id}</bdi>
        </p>
        <button onClick={onOpen}>پیگیری تأیید دستی چک</button>
      </section>
    );
  if (upfront && ['pending', 'unknown'].includes(upfront.state))
    return (
      <section className="notice credit-schedule-guard" role="status">
        <p>
          ثبت پیش‌پرداخت هنوز نتیجهٔ قطعی ندارد. شناسهٔ همان فرمان: <bdi>{upfront.command.id}</bdi>
        </p>
        <button onClick={onOpen}>پیگیری گواهی پیش‌پرداخت</button>
      </section>
    );
  if (cheque && ['pending', 'unknown'].includes(cheque.state))
    return (
      <section className="notice credit-schedule-guard" role="status">
        <p>
          ثبت گردش چک هنوز نتیجهٔ قطعی ندارد. شناسهٔ همان فرمان: <bdi>{cheque.command.id}</bdi>
        </p>
        <button onClick={onOpen}>پیگیری گردش چک</button>
      </section>
    );
  if (!entry || !['pending', 'unknown'].includes(entry.state)) return null;
  return (
    <section className="notice credit-schedule-guard" role="status">
      <p>
        ثبت برنامهٔ سررسید هنوز نتیجهٔ قطعی ندارد. برای پیگیری، همان شناسه را حفظ کنید:{' '}
        <bdi>{entry.command.id}</bdi>
      </p>
      <button onClick={onOpen}>پیگیری برنامهٔ سررسید</button>
    </section>
  );
}
