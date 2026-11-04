using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;
public sealed class AddressGeographySqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    private static AddressDetailsInput Details() => new(AddressGeography.Version, "123", "1230001", "1230001001576", "city", "۱۲", "۲", 35.6892, 51.389);
    private static SaveAddressInput Input() => new("خانه", "گیرندهٔ آزمون", "09121234567", new("IR", "تهران", "تهران", "خیابان و کوچهٔ نمونه؛ نشانی واقعی نیست", "1234567890"), false, null, Details());
    [Fact] public async Task GeographyBuildingAndPointSurviveEncryptedSaveReloadAndCasEdit()
    {
        var customer = await fixture.Customer(); using var c = customer.Client; var id = Guid.NewGuid().ToString("N");
        var saved = await OrderFixture.Json(await c.PutAsJsonAsync("/api/addresses/" + id, Input()), HttpStatusCode.Created);
        var version = saved["address"]!["version"]!.GetValue<string>();
        var book = await OrderFixture.Json(await c.GetAsync("/api/addresses"));
        await Capture("address-book-map", book);
        var row = book["items"]!.AsArray().Single()!;
        Assert.Equal("12", row["details"]!["plaque"]!.GetValue<string>());
        Assert.Equal("2", row["details"]!["unit"]!.GetValue<string>());
        Assert.Equal(35.6892, row["details"]!["latitude"]!.GetValue<double>());
        Assert.Equal("1230001", row["details"]!["countyId"]!.GetValue<string>());
        await using (var scope = fixture.Sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<SalesDbContext>();
            var stored = await db.Addresses.AsNoTracking().SingleAsync(x => x.OwnerId == customer.Owner && x.Id == id);
            Assert.DoesNotContain("35.6892", stored.ProtectedData); Assert.DoesNotContain("1230001", stored.ProtectedData);
            var plain = scope.ServiceProvider.GetRequiredService<IAddressProtection>().Unprotect(customer.Owner, id, stored.ProtectedData);
            Assert.Contains("Latitude", plain); Assert.Contains("35.6892", plain);
        }
        var edit = Input() with { Version = version, Details = Details() with { Latitude = null, Longitude = null, Plaque = "۴۲" } };
        var updated = await OrderFixture.Json(await c.PutAsJsonAsync("/api/addresses/" + id, edit));
        Assert.Equal("42", updated["address"]!["details"]!["plaque"]!.GetValue<string>());
        Assert.True(updated["address"]!["details"]!.AsObject().ContainsKey("latitude"));
        Assert.True(updated["address"]!["details"]!.AsObject().ContainsKey("longitude"));
        Assert.Null(updated["address"]!["details"]!["latitude"]);
        await Capture("address-save-no-map", updated);
        using var stale = await c.PutAsJsonAsync("/api/addresses/" + id, edit);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }
    [Fact] public async Task InvalidParentOrPointCannotMutateTheBookAndManualVillageCanBeSaved()
    {
        var customer = await fixture.Customer(); using var c = customer.Client; var id = Guid.NewGuid().ToString("N");
        foreach (var d in new[] { Details() with { CountyId = "1000001" }, Details() with { CityId = "1000001001101" }, Details() with { Longitude = null }, Details() with { Latitude = 0 } }) {
            using var bad = await c.PutAsJsonAsync("/api/addresses/" + id, Input() with { Details = d }); Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        }
        var book = await OrderFixture.Json(await c.GetAsync("/api/addresses")); Assert.Empty(book["items"]!.AsArray());
        var manual = Input() with { Delivery = Input().Delivery with { City = "روستای تازه" }, Details = Details() with { LocalityKind = "other", CityId = null, Latitude = null, Longitude = null, Plaque = "بدون پلاک" } };
        var saved = await OrderFixture.Json(await c.PutAsJsonAsync("/api/addresses/" + id, manual), HttpStatusCode.Created);
        Assert.Equal("other", saved["address"]!["details"]!["localityKind"]!.GetValue<string>());
        foreach (var name in new[] { "cityId", "latitude", "longitude" }) {
            Assert.True(saved["address"]!["details"]!.AsObject().ContainsKey(name)); Assert.Null(saved["address"]!["details"]![name]);
        }
        await Capture("address-save-manual", saved);
        using var changedReplay = await c.PutAsJsonAsync("/api/addresses/" + id, manual with { Details = manual.Details! with { Plaque = "12" } });
        Assert.Equal(HttpStatusCode.Conflict, changedReplay.StatusCode);
    }
    [Fact] public async Task ExistingV1CiphertextWithoutDetailsRemainsReadableAndCanBeUpgradedWithACasVersion()
    {
        var customer = await fixture.Customer(); using var c = customer.Client; var id = Guid.NewGuid().ToString("N"); var input = Input(); var now = DateTimeOffset.UtcNow;
        await using (var scope = fixture.Sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<SalesDbContext>();
            var protection = scope.ServiceProvider.GetRequiredService<IAddressProtection>();
            var payload = JsonSerializer.Serialize(new { SchemaVersion = 1, input.Label, input.ContactName, input.ContactPhone, input.Delivery, CreateFingerprint = new string('a',64) });
            db.AddressBooks.Add(new() { OwnerId = customer.Owner, Revision = 1, UpdatedAt = now });
            db.Addresses.Add(new() { Id = id, OwnerId = customer.Owner, IsDefault = true, CreatedAt = now, UpdatedAt = now, ProtectedData = protection.Protect(customer.Owner, id, payload) }); await db.SaveChangesAsync();
        }
        var book = await OrderFixture.Json(await c.GetAsync("/api/addresses")); var row = book["items"]!.AsArray().Single()!;
        Assert.False(row.AsObject().ContainsKey("details")); Assert.Equal(input.Delivery.Address, row["delivery"]!["address"]!.GetValue<string>());
        await Capture("address-book-legacy", book);
        var update = input with { Version = row["version"]!.GetValue<string>() };
        var result = await OrderFixture.Json(await c.PutAsJsonAsync("/api/addresses/" + id, update)); Assert.NotNull(result["address"]!["details"]);
    }
    private static async Task Capture(string name, JsonNode value)
    {
        var directory = Environment.GetEnvironmentVariable("SHOP_ADDRESS_CONTRACT_CAPTURE_DIR");
        if (string.IsNullOrEmpty(directory)) return;
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, name + ".json"), value.ToJsonString());
    }

}
