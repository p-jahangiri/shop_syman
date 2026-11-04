import {
  readPhoneConfigurationResult,
  type PhoneConfigurationCommand,
  type PhoneConfigurationResult,
} from '../../api/contracts/market/market-phone-contract.ts';
interface Entry {
  owner: string;
  command: PhoneConfigurationCommand;
  result: PhoneConfigurationResult | null;
  uncertain: boolean;
}
let entry: Entry | null = null;
export const readMarketPhoneJournal = (owner: string) =>
  entry?.owner === owner ? structuredClone(entry) : null;
export function keepMarketPhoneCommand(owner: string, command: PhoneConfigurationCommand) {
  if (
    entry?.owner === owner &&
    entry.result === null &&
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    throw Error('ابتدا نتیجهٔ ثبت قبلی را با همان شناسه پیگیری کنید.');
  const uncertain = entry?.owner === owner && entry.result === null ? entry.uncertain : false;
  entry = { owner, command: structuredClone(command), result: null, uncertain };
}
export function markMarketPhoneUncertain(owner: string, command: PhoneConfigurationCommand) {
  if (
    entry?.owner !== owner ||
    entry.result !== null ||
    JSON.stringify(entry.command) !== JSON.stringify(command)
  )
    return false;
  entry = { ...entry, uncertain: true };
  return true;
}
export function finishMarketPhoneCommand(
  owner: string,
  command: PhoneConfigurationCommand,
  result: PhoneConfigurationResult,
) {
  if (entry?.owner !== owner || JSON.stringify(entry.command) !== JSON.stringify(command))
    return false;
  try {
    readPhoneConfigurationResult(result, command);
  } catch {
    return false;
  }
  entry = { ...entry, result: structuredClone(result), uncertain: false };
  return true;
}
export function clearMarketPhoneJournal(owner?: string) {
  if (!owner || entry?.owner === owner) entry = null;
}
