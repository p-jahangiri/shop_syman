import {
  readWarehouseResult,
  type WarehouseCommand,
  type WarehouseResult,
} from './accounting-reconciliation-contract.ts';
interface Entry {
  owner: string;
  command: WarehouseCommand;
  result: WarehouseResult | null;
}
let entry: Entry | null = null;
export const readWarehouseJournal = (owner: string) =>
  entry?.owner === owner ? structuredClone(entry) : null;
export function keepWarehouseCommand(owner: string, command: WarehouseCommand) {
  if (
    entry?.owner === owner &&
    !entry.result &&
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    throw Error('نتیجهٔ فرمان انبار قبلی را ابتدا پیگیری کنید.');
  entry = { owner, command: structuredClone(command), result: null };
}
export function finishWarehouseCommand(owner: string, command: WarehouseCommand, raw: unknown) {
  if (entry?.owner !== owner || JSON.stringify(entry.command) !== JSON.stringify(command))
    return false;
  const result = readWarehouseResult(raw, command);
  entry = { ...entry, result };
  return true;
}
export function clearWarehouseJournal(owner?: string) {
  if (!owner || entry?.owner === owner) entry = null;
}
