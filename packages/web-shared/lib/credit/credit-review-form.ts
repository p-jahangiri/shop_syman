// The staff field is explicitly UTC. Never reinterpret it in the device zone.
export function parseCreditReviewExpiryUtc(value: string, now = Date.now()): string | undefined {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return;
  const date = new Date(value + ':00Z');
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 16) !== value ||
    date.getTime() <= now
  )
    return;
  return date.toISOString();
}
