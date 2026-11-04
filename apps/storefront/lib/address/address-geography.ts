import source from '../../public/data/iran-geography.v1.json' with { type: 'json' };

export const geographyVersion = source.version;
export const provinces = source.provinces.map(([id, name]) => ({ id, name }));
export const counties = source.counties.map(([id, name, provinceId]) => ({ id, name, provinceId }));
export const cities = source.cities.map(([id, name, provinceId, countyId]) => ({
  id,
  name,
  provinceId,
  countyId,
}));
const provinceIndex = new Map(provinces.map((v) => [v.id, v]));
const countyIndex = new Map(counties.map((v) => [v.id, v]));
const cityIndex = new Map(cities.map((v) => [v.id, v]));
export const findProvince = (id: string) => provinceIndex.get(id);
export const findCounty = (id: string) => countyIndex.get(id);
export const findCity = (id: string) => cityIndex.get(id);
export function geographySearch(value: string) {
  return value
    .normalize('NFKC')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\s\u200c]/g, '')
    .toLocaleLowerCase('fa');
}
export function resolveLegacyLocation(province: string, city: string) {
  const p = provinces.find((v) => geographySearch(v.name) === geographySearch(province));
  const matches = p
    ? cities.filter(
        (v) => v.provinceId === p.id && geographySearch(v.name) === geographySearch(city),
      )
    : [];
  return {
    provinceId: p?.id ?? '',
    countyId: matches.length === 1 ? matches[0].countyId : '',
    cityId: matches.length === 1 ? matches[0].id : '',
  };
}
export function countyMapCenter(id: string): [number, number] | undefined {
  const row = source.centers.find((v) => v[0] === id);
  return row ? [Number(row[1]), Number(row[2])] : undefined;
}
export function deliveryPoint(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= 24 &&
    latitude <= 40.5 &&
    longitude >= 43.5 &&
    longitude <= 64
  );
}
