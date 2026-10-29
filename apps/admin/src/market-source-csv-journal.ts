import {
  readSourceCsvResult,
  type SourceCsvCommand,
  type SourceCsvResult,
} from './market-source-csv-contract.ts';
interface Entry {
  owner: string;
  command: SourceCsvCommand;
  result: SourceCsvResult | null;
  uncertain: boolean;
}
let entry: Entry | null = null;
export const readSourceCsvJournal = (owner: string) =>
  entry?.owner === owner ? structuredClone(entry) : null;
export function keepSourceCsvCommand(owner: string, command: SourceCsvCommand) {
  if (
    entry?.owner === owner &&
    entry.result === null &&
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    throw Error('پیش از فایل تازه، نتیجهٔ فرمان قبلی را با همان بدنه پیگیری کنید.');
  const uncertain = entry?.owner === owner && entry.result === null ? entry.uncertain : false;
  entry = { owner, command: structuredClone(command), result: null, uncertain };
}
export function markSourceCsvUncertain(owner: string, command: SourceCsvCommand) {
  if (
    entry?.owner !== owner ||
    entry.result !== null ||
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    return false;
  entry = { ...entry, uncertain: true };
  return true;
}
export function finishSourceCsvCommand(
  owner: string,
  command: SourceCsvCommand,
  result: SourceCsvResult,
) {
  if (
    entry?.owner !== owner ||
    JSON.stringify(entry.command) !== JSON.stringify(command) ||
    result.requestId.toLowerCase() !== command.requestId.toLowerCase() ||
    result.fileHash !== command.fileHash
  )
    return false;
  try {
    readSourceCsvResult(result, command.requestId, command.expected, command.fileHash);
  } catch {
    return false;
  }
  entry = { ...entry, result: structuredClone(result), uncertain: false };
  return true;
}
export function clearSourceCsvJournal(owner?: string) {
  if (!owner || entry?.owner === owner) entry = null;
}
