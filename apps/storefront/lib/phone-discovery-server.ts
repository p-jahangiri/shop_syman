import 'server-only';
import { readPhoneItem, readPhonePage } from './phone-discovery-http';
import type { PhoneSearch } from './phone-discovery-contract';
import type { Locale } from './types';
const environment = () => ({
  SHOP_API_URL: process.env.SHOP_API_URL,
  SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
});
export const getPhonePage = (locale: Locale, input: Partial<PhoneSearch>) =>
  readPhonePage(locale, input, environment());
export const getPhoneItem = (locale: Locale, id: string) =>
  readPhoneItem(locale, id, environment());
