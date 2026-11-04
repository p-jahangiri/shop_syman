import {
  readStockApplication,
  type StockApplyCommand,
  type StockApplication,
} from '../../api/contracts/accounting/accounting-stock-contract.ts';
type State = 'pending' | 'unknown' | 'rejected' | 'done';
export interface StockJournalEntry {
  readonly owner: string;
  readonly command: StockApplyCommand;
  readonly state: State;
  readonly result: StockApplication | null;
  readonly message: string | null;
}
let entry: StockJournalEntry | null = null;
const listeners = new Set<() => void>();
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
const same = (a: StockApplyCommand, b: StockApplyCommand) =>
  JSON.stringify(a) === JSON.stringify(b);
function publish(value: StockJournalEntry | null) {
  entry = value === null ? null : freeze(structuredClone(value));
  for (const changed of listeners) changed();
}
export const subscribeStockJournal = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const stockJournalSnapshot = (owner: string) => (entry?.owner === owner ? entry : null);
export const readStockJournal = (owner: string) => {
  const value = stockJournalSnapshot(owner);
  return value ? structuredClone(value) : null;
};
export function beginStockCommand(owner: string, command: StockApplyCommand) {
  if (entry?.owner === owner && (entry.state === 'pending' || !same(entry.command, command)))
    throw Error('ابتدا نتیجهٔ فرمان موجودی قبلی را با همان شناسه پیگیری کنید.');
  publish({ owner, command, state: 'pending', result: null, message: null });
}
export function finishStockCommand(owner: string, command: StockApplyCommand, raw: unknown) {
  if (entry?.owner !== owner || !same(entry.command, command)) return false;
  const result = readStockApplication(raw, command);
  publish({ ...entry, state: 'done', result, message: null });
  return true;
}
export function failStockCommand(
  owner: string,
  command: StockApplyCommand,
  state: 'unknown' | 'rejected',
  message: string,
) {
  if (entry?.owner !== owner || !same(entry.command, command)) return false;
  publish({ ...entry, state, message });
  return true;
}
export function clearStockJournal(owner?: string) {
  if (!owner || entry?.owner === owner) publish(null);
}

export function interruptStockCommand() {
  if (entry?.state === 'pending')
    publish({
      ...entry,
      state: 'unknown',
      message: 'تأیید نشست موقتاً در دسترس نیست؛ بدنه و شناسهٔ همان فرمان محفوظ‌اند.',
    });
}
