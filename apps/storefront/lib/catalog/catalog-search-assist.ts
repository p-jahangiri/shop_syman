import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { catalogInputSchema, type CatalogPage, type CatalogQuery } from './catalog-contract.ts';

const aliases: Readonly<Record<string, string>> = {
  ایفون: 'iphone',
  'ای فون': 'iphone',
  'آی فون': 'iphone',
  آیفون: 'iphone',
  iphnoe: 'iphone',
  iphone: 'iphone',
  گالکسی: 'galaxy',
  galxy: 'galaxy',
  پلیستیشن: 'playstation',
  پلیاستیشن: 'playstation',
  playstaion: 'playstation',
  مکبوک: 'macbook',
  macbok: 'macbook',
  'ایر پاد': 'airpods',
};
const aliasesInQuery = new RegExp(
  '(^|\\s)(' + Object.keys(aliases).join('|') + ')(?=\\s|$|[0-9])',
  'gu',
);

export function catalogSearchCandidate(value: string | undefined) {
  if (!value) return undefined;
  const original = normalizePersian(value);
  const replacement = original.replace(
    aliasesInQuery,
    (match, separator: string, alias: string, position: number) => {
      const next = original.charAt(position + match.length);
      return separator + aliases[alias] + (/[0-9]/.test(next) ? ' ' : '');
    },
  );
  if (replacement === original || !catalogInputSchema.safeParse({ query: replacement }).success)
    return undefined;
  return replacement;
}

export async function verifiedCatalogSuggestion(
  query: CatalogQuery,
  page: Pick<CatalogPage, 'total'>,
  read: (alternate: CatalogQuery) => Promise<Pick<CatalogPage, 'total'>>,
) {
  if (query.page !== 1 || page.total !== 0) return undefined;
  const candidate = catalogSearchCandidate(query.query);
  if (!candidate) return undefined;
  const verified = await read({ ...query, query: candidate, pageSize: 1 });
  return verified.total > 0 ? { query: candidate, total: verified.total } : undefined;
}
