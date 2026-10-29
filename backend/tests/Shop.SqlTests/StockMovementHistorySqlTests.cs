using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Xunit;

namespace Shop.SqlTests;
public sealed class StockMovementHistorySqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    [Fact] public async Task SeekPagesCoverOldMovementsAndExcludeNewerInsertsWithoutChangingStock()
    {
        var variant = "history" + Guid.NewGuid().ToString("N"); long[] expected; byte[] version;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            db.Stock.Add(new() { VariantId = variant, OnHand = 100, Reserved = 7 });
            for (var i = 0; i < 121; i++) db.Movements.Add(new() { VariantId = variant, Delta = i % 2 == 0 ? 1 : -1, Balance = 100, Reason = "Historical receipt", ActorId = "history-test", RequestId = Guid.NewGuid().ToString("N"), At = DateTimeOffset.Parse("2026-10-23T00:00:00Z").AddMinutes(i % 10) });
            await db.SaveChangesAsync(); expected = await db.Movements.Where(x => x.VariantId == variant).OrderByDescending(x => x.Id).Select(x => x.Id).ToArrayAsync(); version = (await db.Stock.SingleAsync(x => x.VariantId == variant)).Version;
        }
        var filter = StockMovementFilter.Create(variant); var result = new List<string>(); string? cursor = null; var sizes = new List<int>();
        do {
            await using var scope = fixture.Factory.Services.CreateAsyncScope(); var reader = scope.ServiceProvider.GetRequiredService<IStockMovementHistory>(); var page = await reader.ReadAsync(filter, cursor, Ct);
            sizes.Add(page.Items.Length); result.AddRange(page.Items.Select(x => x.Id)); cursor = page.NextCursor;
            if (sizes.Count == 1) {
                var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); db.Movements.Add(new() { VariantId = variant, Delta = 1, Balance = 100, Reason = "Inserted during paging", ActorId = "history-test", RequestId = Guid.NewGuid().ToString("N") }); await db.SaveChangesAsync();
            }
        } while (cursor is not null);
        Assert.Equal(new[] { 50, 50, 21 }, sizes); Assert.Equal(expected.Select(x => x.ToString(System.Globalization.CultureInfo.InvariantCulture)), result); Assert.Equal(121, result.Distinct().Count());
        await using var final = fixture.Factory.Services.CreateAsyncScope(); var context = final.ServiceProvider.GetRequiredService<InventoryDbContext>(); var stock = await context.Stock.AsNoTracking().SingleAsync(x => x.VariantId == variant); Assert.Equal(100, stock.OnHand); Assert.Equal(7, stock.Reserved); Assert.Equal(version, stock.Version);
    }
    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        using (response) { Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); return JsonNode.Parse(await response.Content.ReadAsStringAsync())!; }
    }
    private async Task<HttpClient> Staff(string role)
    {
        var account = await fixture.CreateAdministratorAsync();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) { var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var user = (await users.FindByNameAsync(account.Username))!; Assert.True((await users.RemoveFromRoleAsync(user, "Administrator")).Succeeded); Assert.True((await users.AddToRoleAsync(user, role)).Succeeded); }
        var client = fixture.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, account.Password })); client.DefaultRequestHeaders.Authorization = new("Bearer", pending["accessToken"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/inventory/movements")).StatusCode);
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })); client.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var verified = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) })); client.DefaultRequestHeaders.Authorization = new("Bearer", verified["accessToken"]!.GetValue<string>()); return client;
    }
    [Fact] public async Task RealMfaInventoryRoleReadsFilteredHalfOpenHistoryAndLegacySnapshotCanSkipMovements()
    {
        var variant = "filter" + Guid.NewGuid().ToString("N"); var at = DateTimeOffset.Parse("2026-10-23T00:00:00Z");
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
            foreach (var offset in new[] { -1, 0, 1, 2 }) foreach (var delta in new[] { -1, 1 }) db.Movements.Add(new() { VariantId = variant, Delta = delta, Balance = 10, Reason = "Filter boundaries", ActorId = "filter-test", RequestId = Guid.NewGuid().ToString("N"), At = at.AddHours(offset) });
            db.Movements.Add(new() { VariantId = "other" + Guid.NewGuid().ToString("N"), Delta = 1, Balance = 1, Reason = "Must not match", ActorId = "filter-test", RequestId = Guid.NewGuid().ToString("N"), At = at }); await db.SaveChangesAsync();
        }
        using var staff = await Staff("InventoryManager");
        var data = await Json(await staff.GetAsync($"/api/admin/inventory/movements?variantId={variant}&direction=in&fromAt=2026-10-23T00%3A00%3A00Z&toAt=2026-10-23T02%3A00%3A00Z")); var rows = data["items"]!.AsArray(); Assert.Equal(2, rows.Count); Assert.All(rows, row => { Assert.Equal(variant, row!["variantId"]!.GetValue<string>()); Assert.Equal(1, row["delta"]!.GetValue<int>()); Assert.NotEmpty(row["id"]!.GetValue<string>()); }); Assert.Null(data["nextCursor"]);
        var empty = await Json(await staff.GetAsync("/api/admin/inventory/movements?variantId=missing-history")); Assert.Empty(empty["items"]!.AsArray());
        var omitted = await Json(await staff.GetAsync("/api/admin/inventory?includeMovements=false")); Assert.Empty(omitted["movements"]!.AsArray()); var legacy = await Json(await staff.GetAsync("/api/admin/inventory")); Assert.NotEmpty(legacy["movements"]!.AsArray());
        using var content = await Staff("ContentManager"); Assert.Equal(HttpStatusCode.Forbidden, (await content.GetAsync("/api/admin/inventory/movements")).StatusCode);
    }
}
