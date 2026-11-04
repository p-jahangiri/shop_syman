using System.Text;
using System.Text.Json;

namespace Shop.Modules.Sales;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record AddressDetailsInput(string GeographyVersion, string ProvinceId, string CountyId, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] string? CityId, string LocalityKind, string Plaque, string Unit, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] double? Latitude, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] double? Longitude);

// Pinned, separately licensed factual data. No remote call or user PII in lookups.
public static class AddressGeography
{
    public const string Version = "iran-1404-v3.1.2";
    private sealed record County(string Name, string ProvinceId);
    private sealed record City(string Name, string ProvinceId, string CountyId);
    private static readonly Dictionary<string, string> Provinces;
    private static readonly Dictionary<string, County> Counties;
    private static readonly Dictionary<string, City> Cities;
    public static (int Provinces, int Counties, int Cities) Counts => (Provinces.Count, Counties.Count, Cities.Count);
    static AddressGeography()
    {
        using var stream = typeof(AddressGeography).Assembly.GetManifestResourceStream("Shop.Sales.IranGeography.v1") ?? throw new InvalidOperationException("Missing address geography resource.");
        using var data = JsonDocument.Parse(stream);
        if (data.RootElement.GetProperty("version").GetString() != Version) throw new InvalidOperationException("Address geography version mismatch.");
        static string Field(JsonElement row, int index) => row[index].GetString() ?? throw new InvalidOperationException("Invalid geography row.");
        Provinces = data.RootElement.GetProperty("provinces").EnumerateArray().ToDictionary(r => Field(r, 0), r => Field(r, 1), StringComparer.Ordinal);
        Counties = data.RootElement.GetProperty("counties").EnumerateArray().ToDictionary(r => Field(r, 0), r => new County(Field(r, 1), Field(r, 2)), StringComparer.Ordinal);
        Cities = data.RootElement.GetProperty("cities").EnumerateArray().ToDictionary(r => Field(r, 0), r => new City(Field(r, 1), Field(r, 2), Field(r, 3)), StringComparer.Ordinal);
        if (Counts != (31, 484, 1672) || Counties.Values.Any(c => !Provinces.ContainsKey(c.ProvinceId)) || Cities.Values.Any(c => !Counties.TryGetValue(c.CountyId, out var county) || county.ProvinceId != c.ProvinceId)) throw new InvalidOperationException("Incomplete address geography resource.");
    }
    public static AddressDetailsInput Normalize(AddressDetailsInput value, OrderAddressInput delivery)
    {
        if (value.GeographyVersion != Version || value.ProvinceId is null || !Provinces.TryGetValue(value.ProvinceId, out var province) || value.CountyId is null || !Counties.TryGetValue(value.CountyId, out var county) || county.ProvinceId != value.ProvinceId || province != delivery.Province) throw AddressBookRules.Invalid();
        if (value.LocalityKind == "city") {
            if (value.CityId is null || !Cities.TryGetValue(value.CityId, out var city) || city.ProvinceId != value.ProvinceId || city.CountyId != value.CountyId || city.Name != delivery.City) throw AddressBookRules.Invalid();
        } else if (value.LocalityKind != "other" || value.CityId is not null) throw AddressBookRules.Invalid();
        if (!(value.Latitude is null && value.Longitude is null) && !(value.Latitude is double lat && double.IsFinite(lat) && lat is >= 24 and <= 40.5 && value.Longitude is double lon && double.IsFinite(lon) && lon is >= 43.5 and <= 64)) throw AddressBookRules.Invalid();
        var normalized = value with { Plaque = Building(value.Plaque, 1, 20), Unit = Building(value.Unit, 0, 10) };
        var building = string.Join("، ", new[] { normalized.LocalityKind == "other" ? "شهرستان " + county.Name : "", "پلاک " + normalized.Plaque, normalized.Unit.Length > 0 ? "واحد " + normalized.Unit : "" }.Where(x => x.Length > 0));
        if (delivery.Address.Length + 1 + building.Length > 2000) throw AddressBookRules.Invalid();
        return normalized;
    }
    private static string Building(string? input, int min, int max)
    {
        if (input is null || input.Length > 128) throw AddressBookRules.Invalid();
        var text = string.Concat(input.Normalize(NormalizationForm.FormKC).Trim().Select(c => c is >= '۰' and <= '۹' ? (char)('0' + c - '۰') : c is >= '٠' and <= '٩' ? (char)('0' + c - '٠') : c));
        if (text.Length < min || text.Length > max || text.Any(c => char.IsControl(c) || c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069')) throw AddressBookRules.Invalid();
        return text;
    }
}
