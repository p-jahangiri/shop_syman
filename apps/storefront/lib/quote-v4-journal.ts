import { quoteInputSchema, type QuoteInput } from './quote-contract.ts';
export interface QuoteV4Attempt {
  locale: 'fa' | 'en';
  input: QuoteInput;
  uncertain: boolean;
}
// No credentials, agreed prices or request bodies are persisted to browser storage.
let owner: string | null = null,
  pending: QuoteV4Attempt | null = null;
export function bindQuoteV4Owner(value: string | null) {
  if (value !== owner) {
    owner = value;
    pending = null;
  }
}
export function readQuoteV4Attempt(value: string) {
  return value === owner && pending ? structuredClone(pending) : null;
}
export function startQuoteV4Attempt(value: string, locale: 'fa' | 'en', input: QuoteInput) {
  const parsed = quoteInputSchema.parse(input);
  if (value !== owner || !parsed.methodId || !parsed.requestId)
    throw new Error('quote_owner_changed');
  if (
    pending &&
    (pending.locale !== locale || JSON.stringify(pending.input) !== JSON.stringify(parsed))
  )
    throw new Error('quote_request_pending');
  pending ??= { locale, input: structuredClone(parsed), uncertain: false };
  return structuredClone(pending);
}
export function finishQuoteV4Attempt(value: string, requestId: string) {
  if (value !== owner || pending?.input.requestId !== requestId) return false;
  pending = null;
  return true;
}
export function failQuoteV4Attempt(value: string, requestId: string, status: number) {
  if (value !== owner || pending?.input.requestId !== requestId) return false;
  // A later rejection cannot prove that an unanswered earlier calculation did not save.
  if (pending.uncertain || status < 400 || status >= 500) {
    pending.uncertain = true;
    return true;
  }
  pending = null;
  return false;
}
