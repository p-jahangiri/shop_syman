import { readImportResult, type ImportCommand, type ImportResult } from './market-contract.ts';
interface Entry {
  owner: string;
  command: ImportCommand;
  result: ImportResult | null;
  uncertain: boolean;
}
let entry: Entry | null = null;
export function readMarketImportJournal(owner: string) {
  return entry?.owner === owner ? structuredClone(entry) : null;
}
export function keepMarketImportCommand(owner: string, command: ImportCommand) {
  if (
    entry?.owner === owner &&
    entry.result === null &&
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    throw Error('ابتدا نتیجهٔ فایل قبلی را با همان شناسه و متن پیگیری کنید.');
  const uncertain = entry?.owner === owner && entry.result === null ? entry.uncertain : false;
  entry = { owner, command: structuredClone(command), result: null, uncertain };
}
export function markMarketImportUncertain(owner: string, command: ImportCommand) {
  if (
    entry?.owner !== owner ||
    entry.result !== null ||
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    return false;
  entry = { ...entry, uncertain: true };
  return true;
}
export function finishMarketImportCommand(owner: string, requestId: string, result: ImportResult) {
  if (entry?.owner !== owner || entry.command.requestId.toLowerCase() !== requestId.toLowerCase())
    return false;
  try {
    readImportResult(result, requestId, entry.command.expected);
  } catch {
    return false;
  }
  entry = { ...entry, result: structuredClone(result), uncertain: false };
  return true;
}
export function clearMarketImportJournal(owner?: string) {
  if (!owner || entry?.owner === owner) entry = null;
}
