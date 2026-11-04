import type {
  SourcingSubmit,
  SourcingCancel,
  SourcingMutation,
} from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import {
  offerMutationMatches,
  offerMutationSchema,
  type OfferAction,
  type OfferMutation,
} from '@sayman/web-shared/lib/market/offer-contract.ts';
import {
  cartCommandReceiptMatches,
  type CartCommand,
  type CartCommandReceipt,
} from '../checkout/cart-conversion-contract.ts';
export type SourcingOfferCommand = {
  kind: 'accept' | 'decline';
  id: string;
  offerId: string;
  reference: string;
  body: OfferAction;
};
export type SourcingCommand =
  | { kind: 'submit'; locale: 'fa' | 'en'; body: SourcingSubmit }
  | { kind: 'cancel'; id: string; body: SourcingCancel }
  | SourcingOfferCommand
  | CartCommand;
export function isSourcingOfferCommand(command: SourcingCommand): command is SourcingOfferCommand {
  return command.kind === 'accept' || command.kind === 'decline';
}
export interface SourcingPending {
  command: SourcingCommand;
  result: SourcingMutation | OfferMutation | null;
  uncertain: boolean;
  cartReceipt?: CartCommandReceipt;
}
export function isCartSourcingCommand(command: SourcingCommand): command is CartCommand {
  return command.kind === 'cart-convert' || command.kind === 'cart-remove';
}
// Frozen commands and customer notes live only in RAM, and only for one member.
let owner: string | null = null;
let pending: SourcingPending | null = null;
let revision = 0;
const listeners = new Set<() => void>();
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
export const sourcingJournalRevision = () => revision;
export function subscribeSourcingJournal(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function bindSourcingOwner(value: string | null) {
  if (value !== owner) {
    owner = value;
    pending = null;
    changed();
  }
}
export function readSourcingJournal(value: string) {
  return value === owner && pending ? structuredClone(pending) : null;
}
export function sourcingJournalBlocksNewIntent(value: string | null) {
  return value !== null && value === owner && !!pending && !pending.result;
}
export function startSourcingJournal(value: string, command: SourcingCommand) {
  if (value !== owner) throw new Error('sourcing_owner_changed');
  if (pending && !pending.result) throw new Error('sourcing_command_pending');
  pending = { command: structuredClone(command), result: null, uncertain: false };
  changed();
  return structuredClone(pending);
}
export function markSourcingUncertain(value: string, requestId: string) {
  if (value !== owner || pending?.command.body.requestId !== requestId || pending.result)
    return false;
  if (!pending.uncertain) {
    pending = { ...pending, uncertain: true };
    changed();
  }
  return true;
}
// A retry can be refused before reaching the original transaction. Its 4xx
// response cannot establish whether an earlier, unanswered attempt committed.
export function failSourcingJournal(
  value: string,
  requestId: string,
  status: number,
): 'ignored' | 'unknown' | 'rejected' {
  if (value !== owner || pending?.command.body.requestId !== requestId || pending.result)
    return 'ignored';
  if (pending.uncertain || status < 400 || status >= 500) {
    markSourcingUncertain(value, requestId);
    return 'unknown';
  }
  pending = null;
  changed();
  return 'rejected';
}
export function finishSourcingJournal(
  value: string,
  requestId: string,
  result: SourcingMutation | OfferMutation,
) {
  if (value !== owner || pending?.command.body.requestId !== requestId) return false;
  const command = pending.command;
  if (isCartSourcingCommand(command)) return false;
  if (command.kind === 'accept' || command.kind === 'decline') {
    const parsed = offerMutationSchema.safeParse(result);
    if (
      !parsed.success ||
      !offerMutationMatches(parsed.data, command.id, command.offerId, command.kind)
    )
      return false;
  } else if (
    !('id' in result) ||
    result.state !== (command.kind === 'submit' ? 'Submitted' : 'Cancelled') ||
    (command.kind === 'cancel' && result.id !== command.id)
  )
    return false;
  pending = { ...pending, result: structuredClone(result) };
  changed();
  return true;
}
export function sourcingJournalTarget(value: SourcingPending) {
  if (value.command.kind === 'accept' || value.command.kind === 'decline')
    return { id: value.command.id, reference: value.command.reference };
  return value.result && 'id' in value.result
    ? { id: value.result.id, reference: value.result.reference }
    : null;
}
export function sourcingRecoveryMayApply(
  value: SourcingPending | null,
  operation: 'submit' | 'cancel',
  commandId: string,
  resultId?: string,
) {
  if (!value || value.result) return true;
  const command = value.command;
  return (
    command.kind === operation &&
    command.body.requestId.replaceAll('-', '').toLowerCase() ===
      commandId.replaceAll('-', '').toLowerCase() &&
    (command.kind !== 'cancel' || resultId === undefined || command.id === resultId)
  );
}
export function clearSourcingJournal(value: string, requestId?: string) {
  if (value === owner && (!requestId || pending?.command.body.requestId === requestId)) {
    pending = null;
    changed();
  }
}
export function cartJournalMatches(value: string, command: CartCommand) {
  return (
    value === owner &&
    !!pending &&
    isCartSourcingCommand(pending.command) &&
    JSON.stringify(pending.command) === JSON.stringify(command)
  );
}
export function rememberCartReceipt(
  value: string,
  command: CartCommand,
  raw: unknown,
  receipt = false,
) {
  if (!cartJournalMatches(value, command)) return false;
  const result = cartCommandReceiptMatches(command, raw, receipt);
  pending = { ...pending!, cartReceipt: structuredClone(result) };
  changed();
  return true;
}
