using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class AddressGeographyTests
{
    internal static AddressDetailsInput Details() => new(AddressGeography.Version, "123", "1230001", "1230001001576", "city", "۱۲", "۲", 35.6892, 51.389);
    internal static SaveAddressInput Input() => new("خانه", "گیرندهٔ نمونه", "+۹۸۹۱۲۱۲۳۴۵۶۷", new("IR", "تهران", "تهران", "خیابان و کوچهٔ نمونهٔ آزمون", "۱۲۳۴۵۶۷۸۹۰"), false, null, Details());
    [Fact] public void DataIncludesAllSourceRowsAndMatchesThePinnedClientDataHash()
    {
        Assert.Equal((31, 484, 1672), AddressGeography.Counts);
        using var data = typeof(AddressGeography).Assembly.GetManifestResourceStream("Shop.Sales.IranGeography.v1")!;
        Assert.Equal("eb6b9842da1ac203649e75d5b4f9cb9c6e1ab71752e93b207d8195a5e7ddfa15", Convert.ToHexStringLower(SHA256.HashData(data)));
    }
    [Fact] public void CanonicalGeographyNormalizesBuildingDigitsAndRetainsTheExplicitMapPoint()
    {
        var value = AddressBookRules.Normalize(Input());
        Assert.Equal("12", value.Details!.Plaque); Assert.Equal("2", value.Details.Unit); Assert.Equal(35.6892, value.Details.Latitude);
        Assert.Equal(value, AddressBookRules.Normalize(value));
    }
    [Theory][InlineData("province")][InlineData("county")][InlineData("city")][InlineData("name")][InlineData("missing")][InlineData("kind")][InlineData("version")][InlineData("plaque")][InlineData("unit")][InlineData("control")][InlineData("bidi")][InlineData("halfpoint")][InlineData("bounds")][InlineData("nan")][InlineData("combined_length")]
    public void InvalidOrForgedDetailsFailBeforePersistence(string kind)
    {
        var input = Input(); var details = input.Details!;
        input = kind switch {
            "province" => input with { Details = details with { ProvinceId = "999" } },
            "county" => input with { Details = details with { CountyId = "1000001" } },
            "city" => input with { Details = details with { CityId = "1000001001101" } },
            "name" => input with { Delivery = input.Delivery with { City = "کاشان" } },
            "missing" => input with { Details = null },
            "kind" => input with { Details = details with { LocalityKind = "other" } },
            "version" => input with { Details = details with { GeographyVersion = "unknown" } },
            "plaque" => input with { Details = details with { Plaque = "" } },
            "unit" => input with { Details = details with { Unit = new string('x',11) } },
            "control" => input with { Details = details with { Plaque = "1\n2" } },
            "bidi" => input with { Details = details with { Plaque = "1\u202e2" } },
            "halfpoint" => input with { Details = details with { Longitude = null } },
            "combined_length" => input with { Delivery = input.Delivery with { Address = new string('x', 2000) } },
            "bounds" => input with { Details = details with { Latitude = 0 } },
            _ => input with { Details = details with { Latitude = double.NaN } }
        };
        Assert.Equal("invalid_address", Assert.Throws<BusinessException>(() => AddressBookRules.Normalize(input)).Code);
    }
    [Fact] public void ManualVillageRequiresKnownCountyButNoMapAndLegacyReadRemainsAvailable()
    {
        var input = Input() with { Delivery = Input().Delivery with { City = "روستای تازه" }, Details = Details() with { CityId = null, LocalityKind = "other", Latitude = null, Longitude = null, Plaque = "بدون پلاک" } };
        Assert.Null(AddressBookRules.Normalize(input).Details!.CityId);
        var old = input with { Details = null };
        Assert.Null(AddressBookRules.Normalize(old, requireDetails: false).Details);
        Assert.Throws<BusinessException>(() => AddressBookRules.Normalize(old));
    }
    [Fact] public void HttpJsonNullOmissionCannotRemoveRequiredNullableGeographyFields()
    {
        var value = Details() with { LocalityKind = "other", CityId = null, Latitude = null, Longitude = null };
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
        using var json = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(value, options));
        foreach (var name in new[] { "cityId", "latitude", "longitude" }) Assert.Equal(System.Text.Json.JsonValueKind.Null, json.RootElement.GetProperty(name).ValueKind);
    }

}
