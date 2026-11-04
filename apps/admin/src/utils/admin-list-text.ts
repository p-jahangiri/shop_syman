const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });
export function normalizeAdminListText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[۰-۹٠-٩]/g, (character) => {
      const point = character.charCodeAt(0);
      return String(point >= 0x6f0 ? point - 0x6f0 : point - 0x660);
    })
    .replace(/[\u200c\s]+/g, ' ')
    .trim()
    .toLocaleLowerCase('fa');
}
function cellText(value: unknown) {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}
export function adminListMatches(values: readonly unknown[], search: string) {
  const terms = normalizeAdminListText(search).split(' ').filter(Boolean);
  const text = values.map((value) => normalizeAdminListText(cellText(value)));
  return terms.every((term) => text.some((value) => value.includes(term)));
}
export function compareAdminListValues(left: unknown, right: unknown) {
  if (typeof left === 'number' && typeof right === 'number')
    return left < right ? -1 : left > right ? 1 : 0;
  const a = normalizeAdminListText(cellText(left)).replace(/(?<=\d)[,٬](?=\d)/g, '');
  const b = normalizeAdminListText(cellText(right)).replace(/(?<=\d)[,٬](?=\d)/g, '');
  const pattern = /^(-?\d+)(?:\s+(ریال|تومان|عدد))?$/;
  const numberA = a.match(pattern),
    numberB = b.match(pattern);
  if (numberA && numberB && numberA[2] === numberB[2]) {
    const x = BigInt(numberA[1]),
      y = BigInt(numberB[1]);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return collator.compare(a, b);
}
