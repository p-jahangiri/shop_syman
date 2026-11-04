const maxRial = 9223372036854775807n;
export function latinDigits(value: string) {
  return value
    .trim()
    .replace(/[۰-۹٠-٩]/g, (c) => String(c.charCodeAt(0) - (c >= '۰' && c <= '۹' ? 0x6f0 : 0x660)));
}

// Accept separators only as thousand groups. A typo such as ۱،۲۳ or "1 2" must
// never be silently reinterpreted as another financial amount.
export function normalizeRial(value: string) {
  const clean = latinDigits(value);
  if (!clean) return '';
  if (
    !/^(0|[1-9]\d{0,18})$/.test(clean) &&
    !/^[1-9]\d{0,2}([٬,])\d{3}(?:\1\d{3}){0,5}$/.test(clean)
  )
    throw new Error('مبلغ را به ریال، بدون اعشار و با جداکنندهٔ درست وارد کنید.');
  const integer = BigInt(clean.replace(/[٬,]/g, ''));
  if (integer > maxRial) throw new Error('مبلغ از محدودهٔ قابل ثبت بیشتر است.');
  return integer.toString();
}

export function basisPoints(value: string, min: number, max: number) {
  const clean = latinDigits(value).replace('٫', '.');
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(clean))
    throw new Error('درصد را با حداکثر دو رقم اعشار و بدون جداکنندهٔ هزارگان وارد کنید.');
  const [whole, fraction = ''] = clean.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result < BigInt(min) || result > BigInt(max))
    throw new Error(`درصد باید از ${displayPercent(min)} تا ${displayPercent(max)} باشد.`);
  return Number(result);
}

export function percentInput(points: number) {
  const fraction = String(points % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return String(Math.floor(points / 100)) + (fraction ? '.' + fraction : '');
}

const numbers = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });
export const displayPercent = (points: number) => numbers.format(points / 100) + '٪';
export const displayRial = (rial: string | null | undefined) =>
  rial == null ? '—' : numbers.format(BigInt(rial)) + ' ریال';
