import 'server-only';
import {
  readMarketItem,
  readMarketPage,
  readMarketFacets,
  readMarketFilters,
  readMarketValues,
  readMarketSources,
} from './market-http';
import type { MarketQuery, MarketValuesQuery } from './market-contract';
import type { Locale } from './types';
const environment = () => ({
  SHOP_API_URL: process.env.SHOP_API_URL,
  SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
});
export const getMarketPage = (locale: Locale, input: Partial<MarketQuery> = {}) =>
  readMarketPage(locale, input, environment());
export const getMarketItem = (locale: Locale, id: string) =>
  readMarketItem(locale, id, environment());
export const getMarketSources = (locale: Locale, id: string) =>
  readMarketSources(locale, id, environment());
export const getMarketFacets = (locale: Locale, input: Partial<MarketQuery> = {}) =>
  readMarketFacets(locale, input, environment());

export const getMarketFilters = (locale: Locale, categoryId: string) =>
  readMarketFilters(locale, { categoryId }, environment());

export const getMarketValues = (locale: Locale, input: MarketValuesQuery) =>
  readMarketValues(locale, input, environment());
