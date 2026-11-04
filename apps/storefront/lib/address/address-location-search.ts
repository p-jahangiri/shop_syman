import {
  cities,
  counties,
  countyMapCenter,
  findCounty,
  findProvince,
  geographySearch,
} from './address-geography.ts';

export type AddressLocationSearchResult = {
  key: string;
  kind: 'city' | 'county';
  name: string;
  provinceId: string;
  provinceName: string;
  countyId: string;
  countyName: string;
  cityId: string | null;
  cityName: string | null;
  path: string[];
  /** An approximate county overview, never a city centroid or delivery point. */
  center?: [number, number];
  centerSource: 'county' | null;
};

export const maxAddressLocationSearchResults = 12;

export function normalizeAddressLocationQuery(value: string) {
  return geographySearch(
    value.normalize('NFKC').replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, ''),
  );
}

function result(
  county: (typeof counties)[number],
  city?: (typeof cities)[number],
): AddressLocationSearchResult | undefined {
  const province = findProvince(county.provinceId);
  if (!province || (city && city.provinceId !== province.id)) return;
  const center = countyMapCenter(county.id);
  return {
    key: city ? `city:${city.id}` : `county:${county.id}`,
    kind: city ? 'city' : 'county',
    name: city?.name ?? county.name,
    provinceId: province.id,
    provinceName: province.name,
    countyId: county.id,
    countyName: county.name,
    cityId: city?.id ?? null,
    cityName: city?.name ?? null,
    path: [province.name, county.name, ...(city ? [city.name] : [])],
    ...(center ? { center } : {}),
    centerSource: center ? 'county' : null,
  };
}

const index = [
  ...counties.map((county) => result(county)),
  ...cities.map((city) => {
    const county = findCounty(city.countyId);
    return county ? result(county, city) : undefined;
  }),
]
  .filter((entry): entry is AddressLocationSearchResult => entry !== undefined)
  .map((entry, order) => ({
    entry,
    order,
    name: normalizeAddressLocationQuery(entry.name),
    path: normalizeAddressLocationQuery(entry.path.join(' ')),
  }));

/** Searches the pinned geography only; this does not geocode street addresses. */
export function searchAddressLocations(
  query: string,
  options: { limit?: number } = {},
): AddressLocationSearchResult[] {
  const tokens = query
    .normalize('NFKC')
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .split(/[^\p{L}\p{N}\u200c]+/u)
    .map(normalizeAddressLocationQuery)
    .filter(Boolean);
  if (!tokens.length) return [];
  const requestedLimit = options.limit ?? maxAddressLocationSearchResults;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(maxAddressLocationSearchResults, Math.floor(requestedLimit)))
    : maxAddressLocationSearchResults;
  if (!limit) return [];
  const normalized = tokens.join('');
  const score = (name: string) =>
    name === normalized ? 0 : name.startsWith(normalized) ? 1 : name.includes(normalized) ? 2 : 3;
  return index
    .filter(({ path }) => tokens.every((token) => path.includes(token)))
    .sort(
      (a, b) =>
        score(a.name) - score(b.name) ||
        Number(a.entry.kind === 'county') - Number(b.entry.kind === 'county') ||
        a.order - b.order,
    )
    .slice(0, limit)
    .map(({ entry }) => ({
      ...entry,
      path: [...entry.path],
      ...(entry.center ? { center: [...entry.center] as [number, number] } : {}),
    }));
}
