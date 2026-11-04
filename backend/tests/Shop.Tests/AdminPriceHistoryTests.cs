using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class AdminPriceHistoryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset At = DateTimeOffset.Parse("2026-10-30T10:00:00.1234567Z");
    private static AdminPriceHistoryFilter Filter() => AdminPriceHistoryFilter.Create("product", "variant", "increase", "2026-10-29T00:00:00Z", "2026-10-31T00:00:00.000Z");
    private static string Token(string json) => Convert.ToBase64String(Encoding.UTF8.GetBytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    [Theory]
    [InlineData("bad/id", null, "all")]
    [InlineData("product", "", "all")]
    [InlineData("product", "bad id", "all")]
    [InlineData("product", "variant", "Increase")]
    [InlineData("product", "variant", "")]
    public void InvalidIdentifiersAndDirectionsFail(string product, string? variant, string direction) => Assert.Equal("invalid_price_history_filter", Assert.Throws<BusinessException>(() => AdminPriceHistoryFilter.Create(product, variant, direction)).Code);

    [Theory]
    [InlineData("2026-10-30")]
    [InlineData("2026-10-30T10:00:00+00:00")]
    [InlineData("2026-10-30T10:00:00z")]
    [InlineData("2026-10-30T10:00:00.12345678Z")]
    [InlineData("2026-02-30T10:00:00Z")]
    [InlineData("2026-10-30T25:00:00Z")]
    [InlineData(" 2026-10-30T10:00:00Z")]
    public void NonCanonicalOrImpossibleUtcTimesFail(string text) => Assert.Throws<BusinessException>(() => AdminPriceHistoryFilter.Create("product", fromAt: text));

    [Fact]
    public void TimeFractionsAndCaseNormalizeWithoutDiscardingTicksAndEqualBoundsAreEmpty()
    {
        var first = AdminPriceHistoryFilter.Create("product", "variant", fromAt: "2026-10-30T10:00:00.123Z", toAt: "2026-10-30T10:00:00.1230000Z");
        var second = AdminPriceHistoryFilter.Create("PRODUCT", "VARIANT", fromAt: "2026-10-30T10:00:00.1230000Z", toAt: "2026-10-30T10:00:00.123Z");
        Assert.Equal(first.Binding, second.Binding);
        Assert.Equal("2026-10-30T10:00:00.1234567Z", AdminPriceHistoryFilter.Time(At));
        Assert.Equal(7, (AdminPriceHistoryFilter.ParseTime("2026-10-30T10:00:00.0000007Z") - AdminPriceHistoryFilter.ParseTime("2026-10-30T10:00:00Z")).Ticks);
        Assert.Throws<BusinessException>(() => AdminPriceHistoryFilter.Create("product", fromAt: "2026-10-30T10:00:00.0000001Z", toAt: "2026-10-30T10:00:00Z"));
    }

    [Fact]
    public void CursorRetainsExactTimeAndRowversionAndBindsEveryFilter()
    {
        var filter = Filter();
        var position = new AdminPriceHistoryPosition(At, [0, 0, 0, 0, 0, 0, 0, 8], At.AddTicks(-1), "event");
        var cursor = AdminPriceHistoryPaging.Encode(position, filter);
        Assert.True(cursor.Length <= AdminPriceHistoryPaging.MaximumCursorLength);
        var decoded = AdminPriceHistoryPaging.Decode(cursor, filter)!;
        Assert.Equal(position.AsOfAt, decoded.AsOfAt); Assert.Equal(position.BeforeAt, decoded.BeforeAt); Assert.Equal(position.BeforeId, decoded.BeforeId); Assert.Equal(position.Watermark, decoded.Watermark);
        foreach (var other in new[] {
            AdminPriceHistoryFilter.Create("other", "variant", "increase", "2026-10-29T00:00:00Z", "2026-10-31T00:00:00Z"),
            AdminPriceHistoryFilter.Create("product", "other", "increase", "2026-10-29T00:00:00Z", "2026-10-31T00:00:00Z"),
            AdminPriceHistoryFilter.Create("product", "variant", "decrease", "2026-10-29T00:00:00Z", "2026-10-31T00:00:00Z"),
            AdminPriceHistoryFilter.Create("product", "variant", "increase", "2026-10-29T00:00:00.0000001Z", "2026-10-31T00:00:00Z"),
            AdminPriceHistoryFilter.Create("product", "variant", "increase", "2026-10-29T00:00:00Z", "2026-10-31T00:00:00.0000001Z")
        }) Assert.Equal("invalid_price_history_cursor", Assert.Throws<BusinessException>(() => AdminPriceHistoryPaging.Decode(cursor, other)).Code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("=")]
    [InlineData("bad/cursor")]
    [InlineData("e30")]
    [InlineData("bm90LWpzb24")]
    public async Task BadCursorsNeverOpenSql(string cursor)
    {
        await using var db = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var reader = new AdminPriceHistory(db, TimeProvider.System);
        Assert.Equal("invalid_price_history_cursor", (await Assert.ThrowsAsync<BusinessException>(() => reader.ReadAsync(Filter(), cursor, CancellationToken.None))).Code);
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }

    [Fact]
    public void CursorRejectsDuplicateUnknownNullAndImpossiblePositionFields()
    {
        var encoded = AdminPriceHistoryPaging.Encode(new(At, new byte[8], At, "event"), Filter()).Replace('-', '+').Replace('_', '/');
        var valid = Encoding.UTF8.GetString(Convert.FromBase64String(encoded.PadRight((encoded.Length + 3) / 4 * 4, '=')));
        foreach (var invalid in new[] { valid.Insert(1, "\"Version\":1,"), valid.Insert(1, "\"extra\":1,"), valid.Replace("\"BeforeId\":\"event\"", "\"BeforeId\":null"), valid.Replace("\"Watermark\":\"AAAAAAAAAAA=\"", "\"Watermark\":\"AQ==\""), valid.Replace("\"BeforeAt\":\"2026-10-30T10:00:00.1234567Z\"", "\"BeforeAt\":\"2027-01-01T00:00:00.0000000Z\"") })
            Assert.Equal("invalid_price_history_cursor", Assert.Throws<BusinessException>(() => AdminPriceHistoryPaging.Decode(Token(invalid), Filter())).Code);
    }

    [Fact]
    public void SqlHasExclusiveVersionBoundaryExactKeysetAndOnlyBoundedOwnedCatalogReads()
    {
        using var db = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var sql = AdminPriceHistoryQuery.Read(db, Filter(), At, new byte[8], new(At, new byte[8], At.AddTicks(-1), "event")).ToQueryString();
        foreach (var expected in new[] { "TOP", "51", "[Version] <", "[ProductId]", "[VariantId]", "[NewPrice] >", "[CreatedAt] >=", "[CreatedAt] <", "COLLATE Latin1_General_100_BIN2", "ORDER BY", "DESC" }) Assert.Contains(expected, sql);
        foreach (var forbidden in new[] { "OFFSET", "[identity]", "[inventory]", "[Sales]", "[ProductMedia]", "[Description]" }) Assert.DoesNotContain(forbidden, sql);
    }

    private sealed class Reader : IAdminPriceHistory
    {
        public int Reads;
        public Task<AdminPriceHistoryPage> ReadAsync(AdminPriceHistoryFilter filter, string? cursor, CancellationToken ct)
        {
            Reads++;
            return Task.FromResult(new AdminPriceHistoryPage(1, "product", AdminPriceHistoryFilter.Time(At), 50, [new("variant", "SKU-CURRENT", false, "9223372036854775807")], [new("event", "variant", "9007199254740993", "9007199254740994", "private-staff", AdminPriceHistoryFilter.Time(At.AddTicks(-1)))], null));
        }
    }
    private static HttpClient Client(WebApplicationFactory<Program> app, string? kind = "access", string? permission = "catalog.read", string? role = "CatalogManager")
    {
        var client = app.CreateClient();
        if (kind is not null) client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        if (permission is not null) client.DefaultRequestHeaders.Add("X-Test-Permissions", permission);
        if (role is not null) client.DefaultRequestHeaders.Add("X-Test-Roles", role);
        return client;
    }

    [Theory]
    [InlineData(null, null, null, 401)]
    [InlineData("mfa_pending", "catalog.read", "Administrator", 403)]
    [InlineData("access", "catalog.write", "CatalogManager", 403)]
    [InlineData("access", "inventory.read", "InventoryManager", 403)]
    [InlineData("access", "catalog.read", null, 403)]
    public async Task StaffRoleCompletedMfaAndReadPermissionAreRequiredBeforeReader(string? kind, string? permission, string? role, int expected)
    {
        var reader = new Reader();
        await using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<IAdminPriceHistory>(); s.AddSingleton<IAdminPriceHistory>(reader); }));
        using var client = Client(app, kind, permission, role);
        using var result = await client.GetAsync("/api/admin/products/product/price-history?unknown=1");
        Assert.Equal(expected, (int)result.StatusCode); Assert.Equal(0, reader.Reads);
        Assert.Contains("no-store", result.Headers.CacheControl!.ToString()); Assert.Contains("noindex", string.Join(",", result.Headers.GetValues("X-Robots-Tag")));
        Assert.Contains("Cookie", result.Headers.Vary); Assert.Contains("Authorization", result.Headers.Vary);
    }

    [Fact]
    public async Task ReadOnlyEndpointPreservesStringMoneyCanonicalDatesAndExplicitNullWithoutPublicAlias()
    {
        var reader = new Reader();
        await using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<IAdminPriceHistory>(); s.AddSingleton<IAdminPriceHistory>(reader); }));
        using var client = Client(app);
        using var result = await client.GetAsync("/api/admin/products/product/price-history?variantId=variant&fromAt=2026-10-30T09%3A00%3A00.000Z");
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        var body = await result.Content.ReadAsStringAsync(); await ContractWireCapture.SaveAsync("admin-price-history-page", body);
        var json = JsonNode.Parse(body)!;
        Assert.Equal("9223372036854775807", json["variants"]![0]!["currentPriceRial"]!.GetValue<string>());
        Assert.Equal("9007199254740993", json["items"]![0]!["oldPriceRial"]!.GetValue<string>());
        Assert.Equal("9007199254740994", json["items"]![0]!["newPriceRial"]!.GetValue<string>());
        Assert.Equal("2026-10-30T10:00:00.1234566Z", json["items"]![0]!["changedAt"]!.GetValue<string>());
        Assert.True(json.AsObject().ContainsKey("nextCursor")); Assert.Null(json["nextCursor"]);
        using var anonymous = app.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/catalog/fa/products/product/price-history")).StatusCode);
        Assert.Equal(1, reader.Reads);
    }

    [Theory]
    [InlineData("unknown=value")]
    [InlineData("Direction=all")]
    [InlineData("direction=all&direction=increase")]
    [InlineData("cursor=a&cursor=b")]
    [InlineData("variantId=")]
    [InlineData("fromAt=2026-10-30T10%3A00%3A00%2B00%3A00")]
    [InlineData("fromAt=2026-10-31T00%3A00%3A00Z&toAt=2026-10-30T00%3A00%3A00Z")]
    [InlineData("cursor=bad")]
    public async Task UnknownDuplicateInvalidQueriesNeverReachReader(string query)
    {
        var reader = new Reader();
        await using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<IAdminPriceHistory>(); s.AddSingleton<IAdminPriceHistory>(reader); }));
        using var client = Client(app); using var result = await client.GetAsync("/api/admin/products/product/price-history?" + query);
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode); Assert.Equal(0, reader.Reads);
    }
}
