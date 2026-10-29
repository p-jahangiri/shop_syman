import type { UsedCondition } from '../lib/used-condition-contract';
import type { Locale } from '../lib/types';
const labels = {
  unknown: ['نامشخص', 'Unknown'],
  passed: ['سالم در بررسی فنی', 'Passed technical inspection'],
  needsRepair: ['نیازمند تعمیر', 'Needs repair'],
  notApplicable: ['فاقد این ویژگی', 'Not applicable'],
  intact: ['بدون آسیب مشاهده‌شده', 'No damage observed'],
  worn: ['دارای آثار استفاده', 'Signs of wear'],
  damaged: ['آسیب‌دیده', 'Damaged'],
  noKnownRepair: ['تعمیر شناخته‌شده ندارد', 'No known repair'],
  repaired: ['تعمیر شده', 'Repaired'],
} as const;
export function UsedConditionReport({
  condition,
  locale = 'fa',
  historical = false,
}: {
  condition?: UsedCondition;
  locale?: Locale;
  historical?: boolean;
}) {
  if (!condition) return null;
  const fa = locale === 'fa';
  const label = (key: keyof typeof labels) => labels[key][fa ? 0 : 1];
  const date = new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(condition.inspectedAt));
  return (
    <details className="used-condition" dir={fa ? 'rtl' : 'ltr'}>
      <summary>
        {fa
          ? 'کالای کارکرده · گزارش سلامت همین دستگاه'
          : 'Used device · This unit’s condition report'}
      </summary>
      {historical && (
        <p>{fa ? 'گزارش ثبت‌شده هنگام سفارش' : 'Condition recorded with this order'}</p>
      )}
      <dl>
        <dt>{fa ? 'وضعیت فنی' : 'Technical condition'}</dt>
        <dd>{label(condition.technicalState)}</dd>
        <dt>{fa ? 'سلامت باتری' : 'Battery health'}</dt>
        <dd>
          {condition.batteryState === 'measured' ? (
            <bdi dir="ltr">{condition.batteryHealthPercent}%</bdi>
          ) : (
            label(condition.batteryState)
          )}
        </dd>
        <dt>{fa ? 'صفحه' : 'Screen'}</dt>
        <dd>{label(condition.screenState)}</dd>
        <dt>{fa ? 'بدنه' : 'Body'}</dt>
        <dd>{label(condition.bodyState)}</dd>
        <dt>{fa ? 'سابقهٔ تعمیر' : 'Repair history'}</dt>
        <dd>{label(condition.repairState)}</dd>
        <dt>{fa ? 'زمان بررسی' : 'Inspected'}</dt>
        <dd>{date}</dd>
      </dl>
      {(fa ? condition.notesFa : condition.notesEn) && (
        <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {fa ? condition.notesFa : condition.notesEn}
        </p>
      )}
    </details>
  );
}
