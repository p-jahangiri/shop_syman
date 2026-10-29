using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class CartSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static string Id() => Guid.NewGuid().ToString("N");
    private static CartIdentity Guest() => new(null, CartService.CreateGuestToken());
    private async Task<T> Run<T>(Func<CartService, Task<T>> action)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); return await action(scope.ServiceProvider.GetRequiredService<CartService>());
    }
    private async Task<(string Variant, string Product)> Product(long price = 125000000, int stock = 100)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var product = new Product { Slug = "cart-" + Id(), CategoryId = await db.Categories.Where(c => c.IsActive).Select(c => c.Id).FirstAsync(), BrandId = await db.Brands.Where(b => b.IsActive).Select(b => b.Id).FirstAsync(), Status = "Published", Translations = [new() { Locale = "fa", Name = "کالای سبد", SearchName = "کالای سبد" }, new() { Locale = "en", Name = "Cart product", SearchName = "cart product" }] };
        var variant = new ProductVariant { Sku = "CART-" + Id(), SearchSku = "cart test", PriceRial = price, IsActive = true, LabelFa = "تنوع", LabelEn = "Variant" }; product.Variants.Add(variant); db.Products.Add(product); await db.SaveChangesAsync();
        var inventory = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); inventory.Stock.Add(new() { VariantId = variant.Id, OnHand = stock }); await inventory.SaveChangesAsync(); return (variant.Id, product.Id);
    }
    private async Task SetPriceAndStock(string id, long price, int stock)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        await db.Variants.Where(x => x.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PriceRial, price));
        await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.Where(x => x.VariantId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.OnHand, stock));
    }
    private async Task AssertCartQuantities(CartIdentity identity, params int[] quantities)
    {
        var cart = await Run(s => s.ReadAsync(identity, "en", Ct)); Assert.Equal(quantities.Order(), cart.Lines.Select(x => x.Quantity).Order());
    }
    private async Task<HttpClient> Customer()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var name = "cart" + Id();
        var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true, DisplayName = "Cart SQL test" }; Assert.True((await users.CreateAsync(user, fixture.Password)).Succeeded);
        var client = fixture.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        using var login = await client.PostAsJsonAsync("/api/auth/password", new { Identifier = name, fixture.Password }); Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var json = JsonNode.Parse(await login.Content.ReadAsStringAsync())!; Assert.False(json["requiresMfa"]!.GetValue<bool>()); client.DefaultRequestHeaders.Authorization = new("Bearer", json["accessToken"]!.GetValue<string>()); return client;
    }
    [Fact] public async Task GuestCookieCrudUsesCurrentServerMoneyAndDoesNotReserveStock()
    {
        var item = await Product(9007199254740993, 5); using var client = fixture.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        using var empty = await client.GetAsync("/api/cart/en"); Assert.Equal(HttpStatusCode.OK, empty.StatusCode); Assert.False(empty.Headers.Contains("Set-Cookie"));
        using var response = await client.PutAsJsonAsync("/api/cart/en", new { Lines = new[] { new { VariantId = item.Variant, Quantity = 2, PriceRial = "1" } }, Version = (string?)null, OwnerId = "forged-owner", CartId = "forged-cart" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        var cookie = response.Headers.GetValues("Set-Cookie").Single(); Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase); Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase); Assert.Contains("path=/api/cart", cookie, StringComparison.OrdinalIgnoreCase);
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!; Assert.Equal("18014398509481986", body["subtotalRial"]!.GetValue<string>()); Assert.Equal("9007199254740993", body["lines"]![0]!["unitPriceRial"]!.GetValue<string>());
        client.DefaultRequestHeaders.Add("Cookie", cookie.Split(';')[0]);
        using var localized = await client.GetAsync("/api/cart/fa"); var fa = JsonNode.Parse(await localized.Content.ReadAsStringAsync())!; Assert.Equal("کالای سبد", fa["lines"]![0]!["name"]!.GetValue<string>());
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<SalesDbContext>(); var saved = await db.Carts.SingleAsync(x => x.GuestTokenHash != null && x.Lines.Any(l => l.VariantId == item.Variant));
        var token = cookie.Split(';')[0].Split('=', 2)[1]; Assert.NotEqual(token, saved.GuestTokenHash); Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))), saved.GuestTokenHash);
        Assert.Null(saved.OwnerId); Assert.Equal(0, (await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x => x.VariantId == item.Variant)).Reserved);
        using var cleared = await client.PutAsJsonAsync("/api/cart/en", new { Lines = Array.Empty<object>(), Version = body["version"]!.GetValue<string>() }); Assert.Equal(HttpStatusCode.OK, cleared.StatusCode); Assert.Empty(JsonNode.Parse(await cleared.Content.ReadAsStringAsync())!["lines"]!.AsArray());
    }
    [Fact] public async Task ConcurrentEditsUseVersionAndExactPutReplayDoesNotChangeIt()
    {
        var item = await Product(); var owner = Guest(); var first = await Run(s => s.ReplaceAsync(owner, "en", new([new(item.Variant, 1)], null), Ct));
        async Task<string?> Edit(int quantity) { try { await Run(s => s.ReplaceAsync(owner, "en", new([new(item.Variant, quantity)], first.Version), Ct)); return null; } catch (BusinessException e) { return e.Code; } }
        var results = await Task.WhenAll(Edit(2), Edit(3)); Assert.Single(results, x => x is null); Assert.Single(results, x => x == "cart_version_conflict");
        var current = await Run(s => s.ReadAsync(owner, "en", Ct));
        var replay = await Run(s => s.ReplaceAsync(owner, "en", new(current.Lines.Select(x => new CartLineInput(x.VariantId, x.Quantity)).ToArray(), first.Version), Ct)); Assert.Equal(current.Version, replay.Version);
    }
    [Fact] public async Task ReadRepricesAndRetainsUnavailableOrInsufficientLines()
    {
        var item = await Product(10, 5); var owner = Guest(); var first = await Run(s => s.ReplaceAsync(owner, "en", new([new(item.Variant, 4)], null), Ct));
        await SetPriceAndStock(item.Variant, 19, 1); var changed = await Run(s => s.ReadAsync(owner, "en", Ct));
        Assert.Equal("76", changed.SubtotalRial); Assert.Equal(4, changed.Lines[0].Quantity); Assert.Equal("insufficient_stock", changed.Lines[0].Issue); Assert.True(changed.HasIssues); Assert.Equal(first.Version, changed.Version);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.Where(x => x.Id == item.Product).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, "Draft"));
        var unavailable = await Run(s => s.ReadAsync(owner, "en", Ct)); Assert.Equal("unavailable", unavailable.Lines[0].Issue); Assert.Null(unavailable.Lines[0].Name); Assert.Null(unavailable.SubtotalRial);
        var removed = await Run(s => s.ReplaceAsync(owner, "en", new([], unavailable.Version), Ct)); Assert.Empty(removed.Lines); Assert.Equal("0", removed.SubtotalRial);
    }
    [Fact] public async Task MergeIsOneTimeAcrossConcurrentRequestsAndConsumedGuestCannotRead()
    {
        var item = await Product(); var guest = Guest(); var member = new CartIdentity(Id(), null);
        await Run(s => s.ReplaceAsync(guest, "en", new([new(item.Variant, 3)], null), Ct)); await Run(s => s.ReplaceAsync(member, "en", new([new(item.Variant, 2)], null), Ct));
        var results = await Task.WhenAll(Run(s => s.MergeAsync(member.OwnerId!, guest.GuestToken, "en", Ct)), Run(s => s.MergeAsync(member.OwnerId!, guest.GuestToken, "en", Ct)));
        Assert.All(results, r => Assert.Equal(5, Assert.Single(r.Lines).Quantity)); await AssertCartQuantities(member, 5);
        Assert.Equal("cart_session_expired", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.ReadAsync(guest, "en", Ct)))).Code);
        Assert.Equal("cart_session_expired", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.MergeAsync(Id(), guest.GuestToken, "en", Ct)))).Code);
        var current = results[0]; var edited = await Run(s => s.ReplaceAsync(member, "en", new([new(item.Variant, 6)], current.Version), Ct)); var replay = await Run(s => s.MergeAsync(member.OwnerId!, guest.GuestToken, "en", Ct)); Assert.Equal(6, Assert.Single(replay.Lines).Quantity); Assert.Equal(edited.Version, replay.Version);
    }
    [Fact] public async Task CustomerHttpMergeRequiresOwnTokenAndClearsGuestCookie()
    {
        var item = await Product(); var guest = Guest(); await Run(s => s.ReplaceAsync(guest, "en", new([new(item.Variant, 2)], null), Ct));
        using var customer = await Customer(); customer.DefaultRequestHeaders.Add("Cookie", "sayman_cart=" + guest.GuestToken);
        using var merged = await customer.PostAsJsonAsync("/api/cart/en/merge", new { OwnerId = "someone-else" }); Assert.Equal(HttpStatusCode.OK, merged.StatusCode);
        Assert.Equal(2, JsonNode.Parse(await merged.Content.ReadAsStringAsync())!["lines"]![0]!["quantity"]!.GetValue<int>()); Assert.Contains("expires=", merged.Headers.GetValues("Set-Cookie").Single(), StringComparison.OrdinalIgnoreCase);
        using var other = await Customer(); using var separate = await other.GetAsync("/api/cart/en"); Assert.Empty(JsonNode.Parse(await separate.Content.ReadAsStringAsync())!["lines"]!.AsArray());
    }
    [Fact] public async Task MergeFailureRollsBackMemberAndPreservesGuestForRetry()
    {
        var item = await Product(); var guest = Guest(); var member = new CartIdentity(Id(), null);
        await Run(s => s.ReplaceAsync(guest, "en", new([new(item.Variant, 2)], null), Ct)); await Run(s => s.ReplaceAsync(member, "en", new([new(item.Variant, 1)], null), Ct));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Carts] WITH NOCHECK ADD CONSTRAINT [CK_CartTestMergeFail] CHECK ([MergedIntoCartId] IS NULL)");
            try { await Assert.ThrowsAsync<DbUpdateException>(() => Run(s => s.MergeAsync(member.OwnerId!, guest.GuestToken, "en", Ct))); }
            finally { await db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Carts] DROP CONSTRAINT [CK_CartTestMergeFail]"); }
        }
        await AssertCartQuantities(member, 1); await AssertCartQuantities(guest, 2);
        Assert.Equal(3, Assert.Single((await Run(s => s.MergeAsync(member.OwnerId!, guest.GuestToken, "en", Ct))).Lines).Quantity);
    }
    [Fact] public async Task OverflowIsRejectedOnWriteAndReportedAfterServerPriceChange()
    {
        var item = await Product(long.MaxValue, 10); var owner = Guest();
        Assert.Equal("cart_amount_limit", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.ReplaceAsync(owner, "en", new([new(item.Variant, 2)], null), Ct)))).Code);
        await SetPriceAndStock(item.Variant, 1, 10); var accepted = await Run(s => s.ReplaceAsync(owner, "en", new([new(item.Variant, 2)], null), Ct)); await SetPriceAndStock(item.Variant, long.MaxValue, 10);
        var read = await Run(s => s.ReadAsync(owner, "en", Ct)); Assert.Null(read.SubtotalRial); Assert.True(read.HasIssues); Assert.Equal("amount_limit", Assert.Single(read.Lines).Issue);
        Assert.Empty((await Run(s => s.ReplaceAsync(owner, "en", new([], accepted.Version), Ct))).Lines);
    }
    [Fact] public async Task InvalidNewVariantsAndExcessQuantityDoNotChangeExistingCart()
    {
        var item = await Product(1, 2); var owner = Guest(); var cart = await Run(s => s.ReplaceAsync(owner, "en", new([new(item.Variant, 1)], null), Ct));
        Assert.Equal("insufficient_stock", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.ReplaceAsync(owner, "en", new([new(item.Variant, 3)], cart.Version), Ct)))).Code);
        Assert.Equal("cart_variant_unavailable", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.ReplaceAsync(owner, "en", new([new("unknown-variant", 1)], cart.Version), Ct)))).Code);
        await AssertCartQuantities(owner, 1); Assert.Empty((await Run(s => s.ReadAsync(Guest(), "en", Ct))).Lines); Assert.Empty((await Run(s => s.ReadAsync(new(Id(), null), "en", Ct))).Lines);
    }
    [Fact] public async Task ExpiredGuestSessionCannotBeReadChangedOrMerged()
    {
        var item = await Product(); var guest = Guest(); await Run(s => s.ReplaceAsync(guest, "en", new([new(item.Variant, 1)], null), Ct));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Carts.Where(x => x.GuestTokenHash == Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(guest.GuestToken!)))).ExecuteUpdateAsync(s => s.SetProperty(x => x.GuestExpiresAt, DateTimeOffset.UtcNow.AddDays(-1)));
        Assert.Equal("cart_session_expired", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.ReadAsync(guest, "en", Ct)))).Code);
        Assert.Equal("cart_session_expired", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.ReplaceAsync(guest, "en", new([], null), Ct)))).Code);
        Assert.Equal("cart_session_expired", (await Assert.ThrowsAsync<BusinessException>(() => Run(s => s.MergeAsync(Id(), guest.GuestToken, "en", Ct)))).Code);
    }
}
