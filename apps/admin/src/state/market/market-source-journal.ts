import type {
  SourceCommand,
  SourceResult,
} from '../../api/contracts/market/market-sources-contract.ts';
interface Entry {
  owner: string;
  command: SourceCommand;
  result: SourceResult | null;
}
let entry: Entry | null = null;
export const readSourceJournal = (owner: string) =>
  entry?.owner === owner ? structuredClone(entry) : null;
export function keepSourceCommand(owner: string, command: SourceCommand) {
  if (
    entry?.owner === owner &&
    entry.result === null &&
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    throw new Error('ابتدا نتیجهٔ فرمان قبلی را با همان بدنه پیگیری کنید.');
  entry = { owner, command: structuredClone(command), result: null };
}
export function finishSourceCommand(owner: string, command: SourceCommand, result: SourceResult) {
  if (
    entry?.owner !== owner ||
    JSON.stringify(entry.command) !== JSON.stringify(command) ||
    result.requestId.toLowerCase() !== command.requestId.toLowerCase() ||
    result.listingId !== command.listingId ||
    result.sourceId !== command.sourceId
  )
    return false;
  entry = { ...entry, result: structuredClone(result) };
  return true;
}
export function clearSourceJournal(owner?: string) {
  if (!owner || entry?.owner === owner) entry = null;
}
