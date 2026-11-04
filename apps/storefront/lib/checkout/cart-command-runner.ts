import { CartError, withCartLock, type CartFetch } from './cart-client.ts';
import {
  cartJournalMatches,
  failSourcingJournal,
  isCartSourcingCommand,
  readSourcingJournal,
  rememberCartReceipt,
  startSourcingJournal,
  clearSourcingJournal,
} from '../market/sourcing-journal.ts';
import { requestCartCommand, requestCartV2 } from './cart-v2-client.ts';
import type { CartCommand } from './cart-conversion-contract.ts';
import type { ServerCartV2 } from './cart-v2-contract.ts';
export type CartCommandMode = 'send' | 'receipt' | 'refresh';
const flights = new Set<string>();
export function createCartCommandRunner(options: {
  owner: string;
  locale: 'fa' | 'en';
  fetch: CartFetch;
  active: () => boolean;
  onFresh: (value: ServerCartV2) => Promise<void>;
  onError?: (code: string) => void;
}) {
  return async (command: CartCommand, mode: CartCommandMode = 'send') => {
    const { owner } = options;
    if (!options.active() || flights.has(owner)) return false;
    const previous = readSourcingJournal(owner),
      stored = previous && !previous.result ? previous : null;
    if ((stored && !cartJournalMatches(owner, command)) || (!stored && mode !== 'send'))
      return false;
    if (!stored) startSourcingJournal(owner, command);
    const frozen = structuredClone(command);
    flights.add(owner);
    try {
      return await withCartLock(async () => {
        if (!options.active() || !cartJournalMatches(owner, frozen)) return false;
        let confirmed = readSourcingJournal(owner)?.cartReceipt;
        if (mode === 'refresh' && !confirmed) return false;
        try {
          if (!confirmed) {
            const result = await requestCartCommand(options.fetch, frozen, mode === 'receipt');
            if (!rememberCartReceipt(owner, frozen, result, mode === 'receipt')) return false;
            confirmed = result;
          }
          // A known receipt is immutable history. No resend, time extension, fresh
          // price or re-add is attempted if a later Cart2 read fails or lines vanished.
          if (!options.active()) return false;
          const current = await requestCartV2(options.fetch, options.locale);
          if (!options.active() || !cartJournalMatches(owner, frozen)) return false;
          await options.onFresh(current);
          if (!options.active() || !cartJournalMatches(owner, frozen)) return false;
          clearSourcingJournal(owner, frozen.body.requestId);
          return true;
        } catch (error) {
          if (!cartJournalMatches(owner, frozen)) return false;
          if (confirmed) {
            if (options.active()) options.onError?.('cart_refresh_required');
            return false;
          }
          if (mode === 'receipt') {
            if (options.active())
              options.onError?.(
                error instanceof CartError && error.status === 404
                  ? 'cart_receipt_missing'
                  : 'cart_receipt_unavailable',
              );
            return false;
          }
          const outcome = failSourcingJournal(
            owner,
            frozen.body.requestId,
            error instanceof CartError ? error.status : 0,
          );
          if (options.active())
            options.onError?.(
              outcome === 'unknown'
                ? 'cart_command_unknown'
                : error instanceof CartError
                  ? error.code
                  : 'cart_command_unavailable',
            );
          return false;
        }
      });
    } finally {
      flights.delete(owner);
    }
  };
}
export function pendingCartCommand(owner: string) {
  const pending = readSourcingJournal(owner);
  return pending && isCartSourcingCommand(pending.command)
    ? { command: pending.command, known: !!pending.cartReceipt, uncertain: pending.uncertain }
    : null;
}
