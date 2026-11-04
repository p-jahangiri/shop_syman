import {
  readShipmentResult,
  type ShipmentCommand,
  type ShipmentResult,
} from '../../api/contracts/orders/order-shipment-contract.ts';
type State = 'pending' | 'unknown' | 'rejected' | 'done';
export interface ShipmentJournalEntry {
  readonly owner: string;
  readonly command: ShipmentCommand;
  readonly state: State;
  readonly result: ShipmentResult | null;
  readonly message: string | null;
}
let entry: ShipmentJournalEntry | null = null;
const listeners = new Set<() => void>();
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
const same = (a: ShipmentCommand, b: ShipmentCommand) => JSON.stringify(a) === JSON.stringify(b);
function publish(value: ShipmentJournalEntry | null) {
  entry = value === null ? null : freeze(structuredClone(value));
  for (const changed of listeners) changed();
}
export const subscribeShipmentJournal = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const shipmentJournalSnapshot = (owner: string) => (entry?.owner === owner ? entry : null);
export const readShipmentJournal = (owner: string) => {
  const value = shipmentJournalSnapshot(owner);
  return value ? structuredClone(value) : null;
};
export function beginShipmentCommand(owner: string, command: ShipmentCommand) {
  if (entry?.owner === owner && (entry.state === 'pending' || !same(entry.command, command)))
    throw Error('ابتدا نتیجهٔ فرمان ارسال قبلی را با همان شناسه پیگیری کنید.');
  publish({ owner, command, state: 'pending', result: null, message: null });
}
export function finishShipmentCommand(owner: string, command: ShipmentCommand, raw: unknown) {
  if (entry?.owner !== owner || !same(entry.command, command)) return false;
  const result = readShipmentResult(raw, command);
  publish({ ...entry, state: 'done', result, message: null });
  return true;
}
export function failShipmentCommand(
  owner: string,
  command: ShipmentCommand,
  state: 'unknown' | 'rejected',
  message: string,
) {
  if (entry?.owner !== owner || !same(entry.command, command)) return false;
  publish({ ...entry, state, message });
  return true;
}
export function interruptShipmentCommand() {
  if (entry?.state === 'pending')
    publish({
      ...entry,
      state: 'unknown',
      message: 'تأیید نشست موقتاً در دسترس نیست؛ بدنه و شناسهٔ همان فرمان محفوظ‌اند.',
    });
}
export function clearShipmentJournal(owner?: string) {
  if (!owner || entry?.owner === owner) publish(null);
}
