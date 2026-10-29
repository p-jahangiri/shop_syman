using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;
public sealed class QuoteSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static string Id() => Guid.NewGuid().ToString("N");
    private sealed record Items(string Variant, string Product, string Category, string Cash, string Cheque, string Plan);
    private async Task<Items> Product(long price = 100003, bool digital = false)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var sp = scope.ServiceProvider; var db = sp.GetRequiredService<CatalogDbContext>();
        var cash = new PurchaseMethod { NameFa = "نقدی", NameEn = "Cash", Enabled = true }; var cheque = new PurchaseMethod { NameFa = "چک", NameEn = "Cheque", Kind = "cheque", Enabled = true, RequiresApproval = true }; var payments = sp.GetRequiredService<PaymentsDbContext>(); payments.Methods.AddRange(cash, cheque); await payments.SaveChangesAsync();
        var plan = new ChequePlan { NameFa = "شش ماهه", NameEn = "Six months", Enabled = true, Months = 6, IntervalMonths = 2, MarkupBasisPoints = 1250, DownPaymentBasisPoints = 2500 }; var credit = sp.GetRequiredService<CreditDbContext>(); credit.Plans.Add(plan); await credit.SaveChangesAsync();
        var category = await db.Categories.Where(c => c.IsActive).Select(c => c.Id).FirstAsync();
        var product = new Product { Slug = "quote-" + Id(), CategoryId = category, BrandId = await db.Brands.Where(b => b.IsActive).Select(b => b.Id).FirstAsync(), Status = "Published", IsDigital = digital, Translations = [new() { Locale = "fa", Name = "کالای محاسبه", SearchName = "کالای محاسبه" }, new() { Locale = "en", Name = new string('N', 250), SearchName = "quote product" }], PurchaseMethods = [new() { MethodId = cash.Id }, new() { MethodId = cheque.Id }], CreditPlans = [new() { PlanId = plan.Id }] };
        var variant = new ProductVariant { Sku = "QUOTE-" + Id(), SearchSku = "quote test", PriceRial = price, IsActive = true, LabelFa = "تنوع", LabelEn = "Variant", WarrantyEn = new string('W', 600) }; product.Variants.Add(variant); db.Products.Add(product); await db.SaveChangesAsync();
        var inventory = sp.GetRequiredService<InventoryDbContext>(); inventory.Stock.Add(new() { VariantId = variant.Id, OnHand = 20 }); await inventory.SaveChangesAsync(); return new(variant.Id, product.Id, category, cash.Id, cheque.Id, plan.Id);
    }
    private HttpClient Client() { var client = fixture.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); return client; }
    private static async Task<JsonNode> Cart(HttpClient client, Items item, int quantity = 1, string? version = null)
    {
        using var response = await client.PutAsJsonAsync("/api/cart/en", new { Lines = new[] { new { VariantId = item.Variant, Quantity = quantity } }, Version = version }); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        if (response.Headers.TryGetValues("Set-Cookie", out var cookies)) { client.DefaultRequestHeaders.Remove("Cookie"); client.DefaultRequestHeaders.Add("Cookie", cookies.Single().Split(';')[0]); }
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    }
    private static async Task<JsonNode> Quote(HttpClient client, string version, string? method = null, string? plan = null, string? request = null)
    {
        using var response = await client.PostAsJsonAsync("/api/cart/en/quote", new { CartVersion = version, MethodId = method, PlanId = plan, RequestId = request, UnitPriceRial = "1", PayableTotalRial = "1", OwnerId = "forged" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    }
    [Fact] public async Task ServerRepricesWithoutTreatingUnknownChargesAsZero()
    {
        var item = await Product(9007199254740993); using var client = Client(); var cart = await Cart(client, item, 2); var result = await Quote(client, cart["version"]!.GetValue<string>());
        Assert.Equal("18014398509481986", result["itemsSubtotalRial"]!.GetValue<string>()); Assert.Null(result["quoteId"]); Assert.Null(result["taxRial"]); Assert.Null(result["shippingRial"]); Assert.Null(result["payableTotalRial"]); Assert.False(result["canPlaceOrder"]!.GetValue<bool>());
        Assert.True(result["shippingRequired"]!.GetValue<bool>()); Assert.Contains("shipping_unconfigured", result["blockers"]!.AsArray().Select(x => x!.GetValue<string>()));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Quotes.AnyAsync(q => q.Lines.Any(l => l.VariantId == item.Variant))); Assert.Equal(0, (await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x => x.VariantId == item.Variant)).Reserved);
    }
    [Fact] public async Task DigitalCashSnapshotPreservesFullNamesAndNoPhysicalShipping()
    {
        var item = await Product(digital: true); using var client = Client(); var cart = await Cart(client, item); var result = await Quote(client, cart["version"]!.GetValue<string>(), item.Cash, request: Id());
        Assert.Equal("0", result["shippingRial"]!.GetValue<string>()); Assert.False(result["shippingRequired"]!.GetValue<bool>()); Assert.Null(result["taxRial"]); Assert.Null(result["payableTotalRial"]); Assert.Empty(result["installments"]!.AsArray());
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var quote = await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Quotes.Include(q => q.Lines).SingleAsync(q => q.Id == result["quoteId"]!.GetValue<string>());
        Assert.Equal(250, Assert.Single(quote.Lines).Name.Length); Assert.Equal(600, quote.Lines[0].Warranty.Length); Assert.Equal(100003, quote.GoodsTotalRial); Assert.Null(quote.TaxRial); Assert.Null(quote.PayableTotalRial);
    }
    [Fact] public async Task ChequeSnapshotReplayIsAtomicConcurrentAndKeepsOriginalTerms()
    {
        var item = await Product(); using var client = Client(); var cart = await Cart(client, item); var version = cart["version"]!.GetValue<string>(); var request = Id();
        var responses = await Task.WhenAll(Quote(client, version, item.Cheque, item.Plan, request), Quote(client, version, item.Cheque, item.Plan, request)); Assert.Equal(responses[0].ToJsonString(), responses[1].ToJsonString()); var first = responses[0];
        Assert.Equal("25010", first["downPaymentRial"]!.GetValue<string>()); Assert.Equal("109383", first["goodsTotalRial"]!.GetValue<string>()); Assert.Equal(new[] { "28120", "28120", "28133" }, first["installments"]!.AsArray().Select(x => x!["amountRial"]!.GetValue<string>()));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var sp = scope.ServiceProvider; var db = sp.GetRequiredService<SalesDbContext>(); var quote = await db.Quotes.Include(q => q.Lines).Include(q => q.Installments).SingleAsync(q => q.Id == first["quoteId"]!.GetValue<string>()); Assert.Single(quote.Lines); Assert.Equal(3, quote.Installments.Count); Assert.Equal(1, await db.Quotes.CountAsync(q => q.RequestId == request));
            await sp.GetRequiredService<CatalogDbContext>().Variants.Where(v => v.Id == item.Variant).ExecuteUpdateAsync(s => s.SetProperty(v => v.PriceRial, 200003)); await sp.GetRequiredService<CreditDbContext>().Plans.Where(p => p.Id == item.Plan).ExecuteUpdateAsync(s => s.SetProperty(p => p.Enabled, false));
        }
        var replay = await Quote(client, version, item.Cheque, item.Plan, request); Assert.Equal(first.ToJsonString(), replay.ToJsonString());
        using var conflict = await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(version, item.Cash, null, request)); Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        var current = await Quote(client, version, item.Cash, request: Id()); Assert.Equal("200003", current["itemsSubtotalRial"]!.GetValue<string>());
    }
    [Fact] public async Task EligibilityIncludesVariantCategoryAmountAndProductPlanRules()
    {
        var item = await Product(); using var client = Client(); var cart = await Cart(client, item); var version = cart["version"]!.GetValue<string>();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>(); db.Set<VariantPurchaseMethod>().Add(new() { VariantId = item.Variant, MethodId = item.Cheque }); await db.SaveChangesAsync();
        }
        var restricted = await Quote(client, version); Assert.Equal(item.Cheque, Assert.Single(restricted["methods"]!.AsArray())!["id"]!.GetValue<string>()); Assert.Equal(item.Plan, Assert.Single(restricted["plans"]!.AsArray())!["id"]!.GetValue<string>());
        using var invalidCash = await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(version, item.Cash, null, Id())); Assert.Equal(HttpStatusCode.Conflict, invalidCash.StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var payments = scope.ServiceProvider.GetRequiredService<PaymentsDbContext>(); payments.Set<MethodCategory>().Add(new() { MethodId = item.Cheque, CategoryId = "other-category" }); await payments.SaveChangesAsync();
        }
        Assert.Empty((await Quote(client, version))["methods"]!.AsArray());
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var sp = scope.ServiceProvider; var payments = sp.GetRequiredService<PaymentsDbContext>(); await payments.Set<MethodCategory>().Where(m => m.MethodId == item.Cheque).ExecuteDeleteAsync(); await payments.Methods.Where(m => m.Id == item.Cheque).ExecuteUpdateAsync(s => s.SetProperty(m => m.MinAmountRial, 100004));
        }
        Assert.Empty((await Quote(client, version))["methods"]!.AsArray());
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var sp = scope.ServiceProvider; await sp.GetRequiredService<PaymentsDbContext>().Methods.Where(m => m.Id == item.Cheque).ExecuteUpdateAsync(s => s.SetProperty(m => m.MinAmountRial, (long?)null)); await sp.GetRequiredService<CreditDbContext>().Plans.Where(p => p.Id == item.Plan).ExecuteUpdateAsync(s => s.SetProperty(p => p.MaxAmountRial, 100002));
        }
        var noPlan = await Quote(client, version); Assert.Empty(noPlan["methods"]!.AsArray()); Assert.Empty(noPlan["plans"]!.AsArray());
    }
    [Fact] public async Task ChangedCartStockAndPublicationPreventNewQuote()
    {
        var item = await Product(); using var client = Client(); var first = await Cart(client, item); var current = await Cart(client, item, 2, first["version"]!.GetValue<string>());
        using var stale = await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(first["version"]!.GetValue<string>(), item.Cash, null, Id())); Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.Where(s => s.VariantId == item.Variant).ExecuteUpdateAsync(s => s.SetProperty(x => x.OnHand, 1));
        using var stock = await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(current["version"]!.GetValue<string>(), item.Cash, null, Id())); Assert.Equal(HttpStatusCode.Conflict, stock.StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.Where(p => p.Id == item.Product).ExecuteUpdateAsync(s => s.SetProperty(p => p.Status, "Draft"));
        using var hidden = await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(current["version"]!.GetValue<string>(), item.Cash, null, Id())); Assert.Equal(HttpStatusCode.Conflict, hidden.StatusCode);
    }
    [Fact] public async Task SameRequestIdentifierBelongsToItsOwnGuestAndNotAnotherCart()
    {
        var item = await Product(); using var firstClient = Client(); using var secondClient = Client(); using var emptyClient = Client(); var first = await Cart(firstClient, item); var second = await Cart(secondClient, item, 2); var request = Id();
        var a = await Quote(firstClient, first["version"]!.GetValue<string>(), item.Cash, request: request); var b = await Quote(secondClient, second["version"]!.GetValue<string>(), item.Cash, request: request);
        Assert.NotEqual(a["quoteId"]!.GetValue<string>(), b["quoteId"]!.GetValue<string>()); Assert.NotEqual(a["itemsSubtotalRial"]!.GetValue<string>(), b["itemsSubtotalRial"]!.GetValue<string>());
        using var empty = await emptyClient.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(first["version"]!.GetValue<string>(), item.Cash, null, request)); Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
    }
    [Fact] public async Task ChildInsertFailureRollsBackHeaderAndLeavesStockAndCartUnchanged()
    {
        var item = await Product(); using var client = Client(); var cart = await Cart(client, item); var request = Id();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database); await db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[CheckoutQuoteInstallments] WITH NOCHECK ADD CONSTRAINT [CK_QuoteTestFailure] CHECK ([AmountRial]=0)");
            try { using var fail = await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(cart["version"]!.GetValue<string>(), item.Cheque, item.Plan, request)); Assert.Equal(HttpStatusCode.Conflict, fail.StatusCode); Assert.Equal("data_constraint", JsonNode.Parse(await fail.Content.ReadAsStringAsync())!["title"]!.GetValue<string>()); }
            finally { await db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[CheckoutQuoteInstallments] DROP CONSTRAINT [CK_QuoteTestFailure]"); }
            Assert.False(await db.Quotes.AnyAsync(q => q.RequestId == request)); Assert.False(await db.Set<CheckoutQuoteLine>().AnyAsync(l => l.VariantId == item.Variant)); Assert.False(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Reservations.AnyAsync());
        }
        var retry = await Quote(client, cart["version"]!.GetValue<string>(), item.Cheque, item.Plan, request); Assert.NotNull(retry["quoteId"]);
    }
    private sealed class Clock : TimeProvider { public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task ExpiredOrMergedGuestCannotReplayItsPreviousQuote(bool merged)
    {
        var item = await Product(); using var client = Client(); var cart = await Cart(client, item); var request = Id(); await Quote(client, cart["version"]!.GetValue<string>(), item.Cash, request: request);
        var token = client.DefaultRequestHeaders.GetValues("Cookie").Single().Split('=', 2)[1];
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            if (merged) await scope.ServiceProvider.GetRequiredService<CartService>().MergeAsync(Id(), token, "en", CancellationToken.None);
            else await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Carts.Where(c => c.Lines.Any(l => l.VariantId == item.Variant)).ExecuteUpdateAsync(s => s.SetProperty(c => c.GuestExpiresAt, DateTimeOffset.UtcNow.AddDays(-1)));
        }
        using var replay = await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(cart["version"]!.GetValue<string>(), item.Cash, null, request)); Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode); Assert.Equal("cart_session_expired", JsonNode.Parse(await replay.Content.ReadAsStringAsync())!["title"]!.GetValue<string>()); Assert.Contains("expires=", replay.Headers.GetValues("Set-Cookie").Single(), StringComparison.OrdinalIgnoreCase);
    }
    [Fact] public async Task ExpiredReplayDoesNotRenewDeadlineOrCreateAnotherSnapshot()
    {
        var item = await Product(); var clock = new Clock(); await using var factory = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<TimeProvider>(); s.AddSingleton<TimeProvider>(clock); }));
        using var client = factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); var cart = await Cart(client, item); var request = Id(); var first = await Quote(client, cart["version"]!.GetValue<string>(), item.Cash, request: request); clock.Now = clock.Now.AddMinutes(6); var replay = await Quote(client, cart["version"]!.GetValue<string>(), item.Cash, request: request);
        Assert.Equal(first["expiresAt"]!.GetValue<string>(), replay["expiresAt"]!.GetValue<string>()); Assert.Equal(first["quoteId"]!.GetValue<string>(), replay["quoteId"]!.GetValue<string>()); Assert.Contains("quote_expired", replay["blockers"]!.AsArray().Select(x => x!.GetValue<string>())); Assert.False(replay["canPlaceOrder"]!.GetValue<bool>());
    }
}
