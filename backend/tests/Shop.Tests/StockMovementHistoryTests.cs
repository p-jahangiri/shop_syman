using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class StockMovementHistoryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory][InlineData("invalid/id", "all")][InlineData("ok", "everything")][InlineData("ok", "IN")]
    public void InvalidFiltersFail(string variant, string direction) => Assert.Equal("invalid_movement_filter", Assert.Throws<BusinessException>(() => StockMovementFilter.Create(variant, direction)).Code);
    [Fact] public void FiltersNormalizeIdentifiersAndOffsetsAndRejectReversedTimes()
    {
        var time = DateTimeOffset.Parse("2026-10-23T12:00:00+03:30");
        var value = StockMovementFilter.Create(" v-1 ", "in", time, time.AddHours(1));
        Assert.Equal("V-1", value.VariantId); Assert.Equal(TimeSpan.Zero, value.FromAt!.Value.Offset);
        Assert.Equal(value.Binding, StockMovementFilter.Create("V-1", "in", time.ToUniversalTime(), time.AddHours(1).ToUniversalTime()).Binding);
        Assert.Throws<BusinessException>(() => StockMovementFilter.Create(fromAt: time, toAt: time));
        Assert.Throws<BusinessException>(() => StockMovementFilter.Create(new string('a', 65)));
    }
    [Theory][InlineData(1)][InlineData(9007199254740993)][InlineData(long.MaxValue)]
    public void CursorRoundTripsWithoutJavascriptNumberLossAndBindsEveryFilter(long id)
    {
        var filter = StockMovementFilter.Create("v1", "out", DateTimeOffset.Parse("2026-01-01T00:00:00Z"), DateTimeOffset.Parse("2027-01-01T00:00:00Z"));
        var cursor = StockMovementPaging.Encode(id, filter); Assert.Equal(id, StockMovementPaging.Decode(cursor, filter));
        foreach (var other in new[] { StockMovementFilter.Create("v2", "out", filter.FromAt, filter.ToAt), StockMovementFilter.Create("v1", "in", filter.FromAt, filter.ToAt), StockMovementFilter.Create("v1", "out", filter.FromAt?.AddTicks(1), filter.ToAt), StockMovementFilter.Create("v1", "out", filter.FromAt, filter.ToAt?.AddTicks(1)) })
            Assert.Equal("invalid_movement_cursor", Assert.Throws<BusinessException>(() => StockMovementPaging.Decode(cursor, other)).Code);
    }
    [Theory][InlineData("")][InlineData("=")][InlineData("abc/")][InlineData("bm90LWpzb24")][InlineData("e30")]
    public async Task BadCursorsFailWithoutOpeningSql(string cursor)
    {
        await using var db = new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));
        Assert.Equal("invalid_movement_cursor", (await Assert.ThrowsAsync<BusinessException>(() => new StockMovementHistory(db).ReadAsync(StockMovementFilter.Create(), cursor, CancellationToken.None))).Code);
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }
    [Fact] public void SeekQueryHasAllFiltersAndBoundedRowsWithoutOffsetOrGraph()
    {
        using var db = new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));
        var sql = StockMovementPaging.Query(db, StockMovementFilter.Create("v1", "out", DateTimeOffset.Parse("2026-01-01Z"), DateTimeOffset.Parse("2027-01-01Z")), 123).ToQueryString();
        foreach (var expected in new[] { "TOP", "51", "[VariantId] =", "[Delta] < 0", "[At] >=", "[At] <", "[Id] <", "ORDER BY", "DESC" }) Assert.Contains(expected, sql);
        foreach (var forbidden in new[] { "OFFSET", "[catalog]", "[identity]", "[Stock]", "[Reservations]" }) Assert.DoesNotContain(forbidden, sql);
    }
    [Theory][InlineData(null, null, 401)][InlineData("mfa_pending", "inventory.read", 403)][InlineData("access", "catalog.read", 403)][InlineData("access", "inventory.write", 403)]
    public async Task PermissionIsCheckedBeforeHistoryReader(string? kind, string? permission, int expected)
    {
        using var client = factory.CreateClient(); if (kind is not null) client.DefaultRequestHeaders.Add("X-Test-Kind", kind); if (permission is not null) client.DefaultRequestHeaders.Add("X-Test-Permissions", permission);
        using var result = await client.GetAsync("/api/admin/inventory/movements"); Assert.Equal(expected, (int)result.StatusCode); Assert.Contains("no-store", result.Headers.CacheControl!.ToString());
    }
    private sealed class Reader : IStockMovementHistory
    {
        public Task<StockMovementPage> ReadAsync(StockMovementFilter filter, string? cursor, CancellationToken ct) => Task.FromResult(new StockMovementPage(1, 50, [new("9007199254740993", filter.VariantId ?? "v1", -1, 5, "test reason", "staff", "request", DateTimeOffset.Parse("2026-10-23T00:00:00Z"))], null));
    }
    [Fact] public async Task AuthorizedContractSerializesLargeIdAsStringAndInvalidInputNeverUsesSql()
    {
        await using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<IStockMovementHistory>(); s.AddSingleton<IStockMovementHistory, Reader>(); }));
        using var client = app.CreateClient(); client.DefaultRequestHeaders.Add("X-Test-Kind", "access"); client.DefaultRequestHeaders.Add("X-Test-Permissions", "inventory.read");
        using var result = await client.GetAsync("/api/admin/inventory/movements?variantId=v1&direction=out"); Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        await ContractWireCapture.SaveAsync("movement-page",await result.Content.ReadAsStringAsync());using var json = JsonDocument.Parse(await result.Content.ReadAsStringAsync()); Assert.Equal("9007199254740993", json.RootElement.GetProperty("items")[0].GetProperty("id").GetString()); Assert.Equal("V1", json.RootElement.GetProperty("items")[0].GetProperty("variantId").GetString());Assert.True(json.RootElement.TryGetProperty("nextCursor",out var lastCursor));Assert.Equal(JsonValueKind.Null,lastCursor.ValueKind);
        foreach (var query in new[] { "direction=unknown", "variantId=bad%2Fid", "fromAt=2026-10-23T00%3A00%3A00Z&toAt=2026-10-22T00%3A00%3A00Z", "cursor=invalid" }) { using var invalid = await client.GetAsync("/api/admin/inventory/movements?" + query); Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode); }
    }
}
