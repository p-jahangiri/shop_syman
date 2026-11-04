export type DateEncoding = 'date' | 'local' | 'utc';
const civilFormatter = new Intl.DateTimeFormat('fa-IR', {
  calendar: 'persian',
  dateStyle: 'medium',
  timeZone: 'UTC',
});
export function persianCivilDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return 'تاریخ نامعتبر';
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    return 'تاریخ نامعتبر';
  return civilFormatter.format(date);
}
const pad = (value: number, size = 2) => String(value).padStart(size, '0');
export function dateFieldWire(value: Date | null, encoding: DateEncoding): string {
  if (!value || !Number.isFinite(value.getTime())) return '';
  if (encoding === 'utc') return value.toISOString().slice(0, 19);
  const day = `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return encoding === 'date'
    ? day
    : `${day}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
export function dateFieldValue(value: string, encoding: DateEncoding): Date | null {
  if (!value) return null;
  const expression =
    encoding === 'date'
      ? /^\d{4}-\d{2}-\d{2}$/
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
  if (!expression.test(value) || value.startsWith('0000')) return null;
  const result = new Date(
    value + (encoding === 'date' ? 'T12:00:00' : encoding === 'utc' ? 'Z' : ''),
  );
  if (!Number.isFinite(result.getTime())) return null;
  // Reject calendar overflow and nonexistent local DST wall times.
  return dateFieldWire(result, encoding).slice(0, value.length > 19 ? 19 : value.length) ===
    value.slice(0, 19)
    ? result
    : null;
}
