using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Xunit;
using IdentityContext = Shop.Modules.Identity.IdentityDbContext;

namespace Shop.SqlTests;
public sealed class ChargeFixture : IAsyncLifetime
{
    public SqlFixture Sql { get; } = new();
    public HttpClient Admin { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        await Sql.InitializeAsync(); var account = await Sql.CreateAdministratorAsync(); Admin = Sql.Factory.CreateClient(new() { HandleCookies = false }); Admin.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); Admin.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); Admin.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Json(await Admin.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, account.Password })); Admin.DefaultRequestHeaders.Authorization = new("Bearer", pending["accessToken"]!.GetValue<string>());
        var setup = await Json(await Admin.PostAsJsonAsync("/api/auth/mfa/setup", new { })); Admin.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var session = await Json(await Admin.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) })); Admin.DefaultRequestHeaders.Authorization = new("Bearer", session["accessToken"]!.GetValue<string>());
        var initial = await Json(await Admin.GetAsync("/api/admin/checkout-charges")); Assert.Equal("unconfigured", initial["shippingMode"]!.GetValue<string>()); Assert.Equal("unconfigured", initial["taxMode"]!.GetValue<string>()); Assert.Null(initial["shippingFeeRial"]); Assert.Null(initial["taxRateBasisPoints"]);
        await using var scope = Sql.Factory.Services.CreateAsyncScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<SalesDbContext>().ChargePolicies.AnyAsync());
    }
    public static async Task<JsonNode> Json(HttpResponseMessage response) { using (response) { var body = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {body}"); return JsonNode.Parse(body)!; } }
    public async Task DisposeAsync() { Admin?.Dispose(); await Sql.DisposeAsync(); }
}
public sealed class ChargeSqlTests(ChargeFixture fixture) : IClassFixture<ChargeFixture>
{
    private static string Id() => Guid.NewGuid().ToString("N");
    private static CheckoutChargePolicyInput Policy(string? version = null) => new("flat", "ارسال ثابت", "Flat delivery", "هزینهٔ ثابت برای هر سفارش", "Fixed charge per order", "1999", null, "exclusive", 925, "goods_shipping", "half_up", version);
    private async Task<JsonNode> Set(CheckoutChargePolicyInput? policy = null)
    {
        var current = await ChargeFixture.Json(await fixture.Admin.GetAsync("/api/admin/checkout-charges")); var version = current["version"]?.GetValue<string>(); return await ChargeFixture.Json(await fixture.Admin.PutAsJsonAsync("/api/admin/checkout-charges", (policy ?? Policy()) with { Version = string.IsNullOrEmpty(version) ? null : version }));
    }
    private async Task<(HttpClient Client, string Version, string Variant, string Method)> Cart(bool digital = false)
    {
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var sp = scope.ServiceProvider; var catalog = sp.GetRequiredService<CatalogDbContext>(); var method = await sp.GetRequiredService<PaymentsDbContext>().Methods.Where(m => m.Kind == "online" && m.Enabled).Select(m => m.Id).FirstAsync();
        var product = new Product { Slug = "charges-" + Id(), CategoryId = await catalog.Categories.Where(c => c.IsActive).Select(c => c.Id).FirstAsync(), BrandId = await catalog.Brands.Where(b => b.IsActive).Select(b => b.Id).FirstAsync(), Status = "Published", IsDigital = digital, PurchaseMethods = [new() { MethodId = method }], Translations = [new() { Locale = "en", Name = "Charge test", SearchName = "charge test" }, new() { Locale = "fa", Name = "آزمون هزینه", SearchName = "آزمون هزینه" }] };
        var variant = new ProductVariant { Sku = "CHARGE-" + Id(), SearchSku = "charge", IsActive = true, PriceRial = 10003, LabelFa = "تنوع", LabelEn = "Variant" }; product.Variants.Add(variant); catalog.Products.Add(product); await catalog.SaveChangesAsync(); var inventory = sp.GetRequiredService<InventoryDbContext>(); inventory.Stock.Add(new() { VariantId = variant.Id, OnHand = 5 }); await inventory.SaveChangesAsync();
        var client = fixture.Sql.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); using var added = await client.PutAsJsonAsync("/api/cart/en", new { Lines = new[] { new { VariantId = variant.Id, Quantity = 1 } }, Version = (string?)null }); Assert.Equal(HttpStatusCode.OK, added.StatusCode); client.DefaultRequestHeaders.Add("Cookie", added.Headers.GetValues("Set-Cookie").Single().Split(';')[0]); var cart = JsonNode.Parse(await added.Content.ReadAsStringAsync())!;
        return (client, cart["version"]!.GetValue<string>(), variant.Id, method);
    }
    private static async Task<JsonNode> Quote(HttpClient client, string version, string method, string request) => await ChargeFixture.Json(await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(version, method, null, request)));
    [Fact] public async Task PolicyChangesNewQuotesButNeverMutatesAnEarlierSnapshot()
    {
        var policy = await Set(); Assert.Equal("1999", policy["shippingFeeRial"]!.GetValue<string>()); var cart = await Cart(); using var client = cart.Client; var request = Id(); var first = await Quote(client, cart.Version, cart.Method, request);
        Assert.Equal(3, first["schemaVersion"]!.GetValue<int>()); Assert.Equal("1999", first["shippingRial"]!.GetValue<string>()); Assert.Equal("1110", first["taxRial"]!.GetValue<string>()); Assert.Equal("13112", first["payableTotalRial"]!.GetValue<string>()); Assert.False(first["canPlaceOrder"]!.GetValue<bool>());
        Assert.DoesNotContain("shipping_unconfigured", first["blockers"]!.AsArray().Select(x => x!.GetValue<string>())); Assert.DoesNotContain("tax_unconfigured", first["blockers"]!.AsArray().Select(x => x!.GetValue<string>()));
        await Set(Policy() with { ShippingFeeRial = "2001" }); var replay = await Quote(client, cart.Version, cart.Method, request); Assert.Equal(first.ToJsonString(), replay.ToJsonString()); var fresh = await Quote(client, cart.Version, cart.Method, Id()); Assert.Equal("2001", fresh["shippingRial"]!.GetValue<string>()); Assert.NotEqual(first["pricingFingerprint"]!.GetValue<string>(), fresh["pricingFingerprint"]!.GetValue<string>());
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var stored = await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Quotes.AsNoTracking().SingleAsync(q => q.Id == first["quoteId"]!.GetValue<string>()); Assert.Equal(13112, stored.PayableTotalRial); Assert.Equal(12002, stored.TaxableBaseRial); Assert.Equal(925, stored.TaxRateBasisPoints); Assert.Equal(policy["version"]!.GetValue<string>(), stored.ChargePolicyVersion); Assert.Equal(0, (await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(s => s.VariantId == cart.Variant)).Reserved);
    }
    [Fact] public async Task DigitalInclusiveTaxIsRecordedWithoutDoubleChargeOrPhysicalShipping()
    {
        await Set(Policy() with { TaxMode = "inclusive", TaxRateBasisPoints = 10000 }); var cart = await Cart(true); using var client = cart.Client; var quote = await Quote(client, cart.Version, cart.Method, Id());
        Assert.Equal("0", quote["shippingRial"]!.GetValue<string>()); Assert.Equal("5002", quote["taxRial"]!.GetValue<string>()); Assert.Equal("10003", quote["payableTotalRial"]!.GetValue<string>()); Assert.True(quote["chargeRules"]!["taxIncluded"]!.GetValue<bool>()); Assert.Equal("digital", quote["chargeRules"]!["shippingReason"]!.GetValue<string>());
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); Assert.True((await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Quotes.SingleAsync(q => q.Id == quote["quoteId"]!.GetValue<string>())).TaxIncluded);
    }
    [Fact] public async Task FailedAuditRollsBackPolicyValuesAndRowVersion()
    {
        var before = await Set(); await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var identity = scope.ServiceProvider.GetRequiredService<IdentityContext>(); Assert.StartsWith("SaymanTest_", identity.Database.GetDbConnection().Database); var count = await identity.Audit.CountAsync();
        await identity.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_ChargeAuditFailure] CHECK ([Action]=N'GET')");
        try { using var failed = await fixture.Admin.PutAsJsonAsync("/api/admin/checkout-charges", Policy(before["version"]!.GetValue<string>()) with { ShippingFeeRial = "9999" }); Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode); }
        finally { await identity.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_ChargeAuditFailure]"); }
        var after = await ChargeFixture.Json(await fixture.Admin.GetAsync("/api/admin/checkout-charges")); Assert.Equal(before.ToJsonString(), after.ToJsonString()); Assert.Equal(count, await identity.Audit.CountAsync());
    }
    [Fact] public async Task ConcurrentSameVersionWritesHaveOneWinnerAndOneAudit()
    {
        var before = await Set(); await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var identity = scope.ServiceProvider.GetRequiredService<IdentityContext>(); var count = await identity.Audit.CountAsync(); var version = before["version"]!.GetValue<string>();
        var responses = await Task.WhenAll(fixture.Admin.PutAsJsonAsync("/api/admin/checkout-charges", Policy(version) with { ShippingFeeRial = "1001" }), fixture.Admin.PutAsJsonAsync("/api/admin/checkout-charges", Policy(version) with { ShippingFeeRial = "1002" }));
        try { Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict); Assert.Equal(count + 1, await identity.Audit.CountAsync()); }
        finally { foreach (var response in responses) response.Dispose(); }
    }
    [Fact] public async Task InvalidOrStaleUpdateDoesNotChangePolicyOrWriteAudit()
    {
        var before = await Set(); await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var identity = scope.ServiceProvider.GetRequiredService<IdentityContext>(); var count = await identity.Audit.CountAsync();
        using var invalid = await fixture.Admin.PutAsJsonAsync("/api/admin/checkout-charges", Policy(before["version"]!.GetValue<string>()) with { TaxRateBasisPoints = 0 }); Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var stale = await fixture.Admin.PutAsJsonAsync("/api/admin/checkout-charges", Policy("AAAAAAAAAAA=")); Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(before.ToJsonString(), (await ChargeFixture.Json(await fixture.Admin.GetAsync("/api/admin/checkout-charges"))).ToJsonString()); Assert.Equal(count, await identity.Audit.CountAsync());
    }
    [Fact] public async Task HistoricalSchemaOneQuoteStillReplaysAfterTheAdditiveMigration()
    {
        await Set(new("unconfigured", "", "", "", "", null, null, "unconfigured", null, "goods", "half_up", null)); var cart = await Cart(); using var client = cart.Client; var request = Id(); var original = await Quote(client, cart.Version, cart.Method, request); original["schemaVersion"] = 1; original.AsObject().Remove("chargeRules"); original.AsObject().Remove("temporaryOrder"); foreach(var line in original["lines"]!.AsArray()) line!.AsObject().Remove("priceVersion");
        await using (var scope = fixture.Sql.Factory.Services.CreateAsyncScope()) { var db = scope.ServiceProvider.GetRequiredService<SalesDbContext>(); var row = await db.Quotes.SingleAsync(q => q.Id == original["quoteId"]!.GetValue<string>()); var projection = JsonNode.Parse(row.ResponseJson)!; projection["SchemaVersion"] = 1; projection.AsObject().Remove("ChargeRules"); projection.AsObject().Remove("TemporaryOrder"); foreach(var line in projection["Lines"]!.AsArray()) line!.AsObject().Remove("PriceVersion"); row.ResponseJson = projection.ToJsonString(); await db.SaveChangesAsync(); }
        var replay = await Quote(client, cart.Version, cart.Method, request); Assert.Equal(original.ToJsonString(), replay.ToJsonString()); Assert.Null(replay["payableTotalRial"]);
    }
}
