using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.AspNetCore.Identity;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;
public sealed class OrderFixture : IAsyncLifetime
{
    public SqlFixture Sql { get; } = new();
    public HttpClient Admin { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        await Sql.InitializeAsync(); var account = await Sql.CreateAdministratorAsync(); Admin = Sql.Factory.CreateClient(new() { HandleCookies = false }); Admin.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); Admin.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); Admin.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Json(await Admin.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, account.Password })); Admin.DefaultRequestHeaders.Authorization = new("Bearer", pending["accessToken"]!.GetValue<string>());
        var setup = await Json(await Admin.PostAsJsonAsync("/api/auth/mfa/setup", new { })); Admin.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var signed = await Json(await Admin.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) })); Admin.DefaultRequestHeaders.Authorization = new("Bearer", signed["accessToken"]!.GetValue<string>());
        await Json(await Admin.PutAsJsonAsync("/api/admin/checkout-charges", new CheckoutChargePolicyInput("flat", "ارسال آزمون", "Test shipping", "", "", "7", null, "exempt", null, "goods", "half_up", null)));
    }
    public async Task Settings(bool enabled = true, int minutes = 15, int max = 1)
    {
        var row = await Json(await Admin.GetAsync("/api/admin/order-settings")); var version = row["version"]?.GetValue<string>(); await Json(await Admin.PutAsJsonAsync("/api/admin/order-settings", new CheckoutOrderSettingsInput(enabled, minutes, max, string.IsNullOrEmpty(version) ? null : version)));
    }
    public static async Task<JsonNode> Json(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using (response) { var body = await response.Content.ReadAsStringAsync(); Assert.Equal(expected, response.StatusCode); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); return JsonNode.Parse(body)!; }
    }
    public async Task<(HttpClient Client, string Owner)> Customer()
    {
        await using var scope = Sql.Factory.Services.CreateAsyncScope(); var sp = scope.ServiceProvider; var users = sp.GetRequiredService<UserManager<ShopUser>>(); var name = "order" + Guid.NewGuid().ToString("N"); var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true, DisplayName = "Order SQL test" }; Assert.True((await users.CreateAsync(user, Sql.Password)).Succeeded);
        // Fixture setup uses the real password/Identity/JWT service. The order
        // endpoints still run JWT validation and all authorization policies.
        var session = await sp.GetRequiredService<AuthService>().PasswordAsync(new(name, Sql.Password), true, true, false, CancellationToken.None); Assert.False(session.RequiresMfa);
        var client = Sql.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); client.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken); return (client, user.Id);
    }
    public async Task<(string Variant, string Method)> Product(long price = 100003, int stock = 5, bool digital = false)
    {
        await using var scope = Sql.Factory.Services.CreateAsyncScope(); var sp = scope.ServiceProvider; var catalog = sp.GetRequiredService<CatalogDbContext>(); var method = await sp.GetRequiredService<PaymentsDbContext>().Methods.Where(m => m.Kind == "online" && m.Enabled && !m.RequiresApproval).Select(m => m.Id).FirstAsync();
        var product = new Product { Slug = "order-" + Guid.NewGuid().ToString("N"), CategoryId = await catalog.Categories.Where(c => c.IsActive).Select(c => c.Id).FirstAsync(), BrandId = await catalog.Brands.Where(b => b.IsActive).Select(b => b.Id).FirstAsync(), Status = "Published", IsDigital = digital, PurchaseMethods = [new() { MethodId = method }], Translations = [new() { Locale = "en", Name = "Order test product", SearchName = "order test product" }, new() { Locale = "fa", Name = "کالای سفارش آزمون", SearchName = "کالای سفارش آزمون" }] };
        var variant = new ProductVariant { Sku = "ORDER-" + Guid.NewGuid().ToString("N"), SearchSku = "order", IsActive = true, PriceRial = price, LabelFa = "تنوع", LabelEn = "Variant", WarrantyEn = "Original warranty" }; product.Variants.Add(variant); catalog.Products.Add(product); await catalog.SaveChangesAsync(); var inventory = sp.GetRequiredService<InventoryDbContext>(); inventory.Stock.Add(new() { VariantId = variant.Id, OnHand = stock }); await inventory.SaveChangesAsync(); return (variant.Id, method);
    }
    public async Task DisposeAsync() { Admin?.Dispose(); await Sql.DisposeAsync(); }
}
public sealed class OrderSqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    private static string Id() => Guid.NewGuid().ToString("N");
    private static CreateOrderInput Input(string quote, bool digital = false) => new(quote, Guid.NewGuid().ToString(), " خریدار آزمون ", "+۹۸۹۱۲۱۲۳۴۵۶۷", digital ? null : new("IR", "استان آزمون", "شهر آزمون", "نشانی آزمون؛ دادهٔ واقعی نیست", "۱۲۳۴۵۶۷۸۹۰"), "ثبت از آزمون SQL", true);
    private static async Task<JsonNode> Quote(HttpClient client, string variant, string method)
    {
        var current = await OrderFixture.Json(await client.GetAsync("/api/cart/en")); var cart = await OrderFixture.Json(await client.PutAsJsonAsync("/api/cart/en", new CartInput([new(variant, 1)], current["version"]?.GetValue<string>())));
        return await OrderFixture.Json(await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(cart["version"]!.GetValue<string>(), method, null, Guid.NewGuid().ToString())));
    }
    private async Task<(HttpClient Client, string Owner, string Variant, string Method, JsonNode Quote)> Scenario(long price = 100003, bool digital = false)
    {
        await fixture.Settings(); var person = await fixture.Customer(); var item = await fixture.Product(price, digital: digital); var quote = await Quote(person.Client, item.Variant, item.Method); Assert.True(quote["temporaryOrder"]!["canCreate"]!.GetValue<bool>()); return (person.Client, person.Owner, item.Variant, item.Method, quote);
    }
    [Fact] public async Task NativeOrderUsesSnapshotRialReservesAndClearsCartWithoutPretendingPayment()
    {
        var data = await Scenario(9007199254740993); using var client = data.Client; var input = Input(data.Quote["quoteId"]!.GetValue<string>());
        var forged = JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(input))!.AsObject(); forged["PayableTotalRial"] = "1"; forged["OwnerId"] = "forged-owner";
        var created = await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", forged), HttpStatusCode.Created); var order = created["order"]!;
        Assert.Equal("9007199254741000", order["payableTotalRial"]!.GetValue<string>()); Assert.Equal("09121234567", order["contactPhone"]!.GetValue<string>()); Assert.Equal("1234567890", order["delivery"]!["postalCode"]!.GetValue<string>()); Assert.Equal("AwaitingPayment", order["summary"]!["state"]!.GetValue<string>()); Assert.False(order["canPay"]!.GetValue<bool>()); Assert.Equal("gateway_unconfigured", order["paymentAvailability"]!.GetValue<string>());
        Assert.Empty((await OrderFixture.Json(await client.GetAsync("/api/cart/en")))["lines"]!.AsArray());
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var inv = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); var stock = await inv.Stock.AsNoTracking().SingleAsync(x => x.VariantId == data.Variant); Assert.Equal(1, stock.Reserved); Assert.Equal(5, stock.OnHand); Assert.False(await inv.Movements.AnyAsync(x => x.VariantId == data.Variant));
        var sales = scope.ServiceProvider.GetRequiredService<SalesDbContext>();
        var signal = await sales.SmsSignals.Include(x => x.OrderEvent).SingleAsync(x => x.OrderEvent.OrderId == order["summary"]!["id"]!.GetValue<string>());
        Assert.Equal("orderCreated", signal.Kind); Assert.Null(signal.ProcessedAt);
        var outbound = (await new SalesSmsSignals(sales, TimeProvider.System).PendingAsync(default)).Single(x => x.SourceId == signal.Id);
        Assert.Equal(data.Owner, outbound.OwnerId); Assert.Equal("9007199254741000", outbound.Values["amountRial"]); Assert.False(outbound.ContainsDemo);
        await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.Where(v => v.Id == data.Variant).ExecuteUpdateAsync(s => s.SetProperty(v => v.PriceRial, 1).SetProperty(v => v.WarrantyEn, "Changed warranty"));
        var read = await OrderFixture.Json(await client.GetAsync("/api/orders/" + order["summary"]!["id"]!.GetValue<string>())); Assert.Equal("9007199254740993", read["lines"]![0]!["unitPriceRial"]!.GetValue<string>()); Assert.Equal("Original warranty", read["lines"]![0]!["warranty"]!.GetValue<string>());
    }
    [Fact] public async Task ConcurrentRetryCreatesOneOrderAndDoesNotRenewDeadlineOrReservation()
    {
        var data = await Scenario(); using var client = data.Client; var input = Input(data.Quote["quoteId"]!.GetValue<string>()); var responses = await Task.WhenAll(client.PostAsJsonAsync("/api/orders", input), client.PostAsJsonAsync("/api/orders", input));
        try { Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created); Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK); var bodies = await Task.WhenAll(responses.Select(async r => JsonNode.Parse(await r.Content.ReadAsStringAsync())!)); Assert.Equal(bodies[0]["order"]!.ToJsonString(), bodies[1]["order"]!.ToJsonString()); }
        finally { foreach (var response in responses) response.Dispose(); }
        using var changed = await client.PostAsJsonAsync("/api/orders", input with { Note = "different" }); Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.CountAsync(x => x.OwnerId == data.Owner)); Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Reservations.CountAsync(x => x.OwnerId == data.Owner));
    }
    [Fact] public async Task TwoCustomersCompetingForLastUnitCannotBothReserveIt()
    {
        await fixture.Settings(); var item = await fixture.Product(stock: 1); var a = await fixture.Customer(); var b = await fixture.Customer(); using var ca = a.Client; using var cb = b.Client; var qa = await Quote(ca, item.Variant, item.Method); var qb = await Quote(cb, item.Variant, item.Method);
        var responses = await Task.WhenAll(ca.PostAsJsonAsync("/api/orders", Input(qa["quoteId"]!.GetValue<string>())), cb.PostAsJsonAsync("/api/orders", Input(qb["quoteId"]!.GetValue<string>())));
        try { Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created); Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict); }
        finally { foreach (var response in responses) response.Dispose(); }
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var stock = await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x => x.VariantId == item.Variant); Assert.Equal(1, stock.Reserved); Assert.Equal(1, stock.OnHand); Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.CountAsync(x => x.Lines.Any(l => l.VariantId == item.Variant)));
    }
    [Theory][InlineData("price")][InlineData("settings")][InlineData("cart")]
    public async Task ChangedQuoteConditionsPreventOrderCreation(string kind)
    {
        var data = await Scenario(); using var client = data.Client;
        if (kind == "settings") await fixture.Settings(minutes: 10);
        else if (kind == "cart") { var cart = await OrderFixture.Json(await client.GetAsync("/api/cart/en")); await OrderFixture.Json(await client.PutAsJsonAsync("/api/cart/en", new CartInput([new(data.Variant, 2)], cart["version"]!.GetValue<string>()))); }
        else { await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.Where(x => x.Id == data.Variant).ExecuteUpdateAsync(s => s.SetProperty(x => x.PriceRial, 100004)); }
        using var failed = await client.PostAsJsonAsync("/api/orders", Input(data.Quote["quoteId"]!.GetValue<string>())); Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode); await using var verify = fixture.Sql.Factory.Services.CreateAsyncScope(); Assert.False(await verify.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.AnyAsync(x => x.OwnerId == data.Owner)); Assert.Equal(0, (await verify.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x => x.VariantId == data.Variant)).Reserved);
    }
    [Fact] public async Task QuoteAndOrderOwnershipAreEnforcedForReadCreateAndCancel()
    {
        var data = await Scenario(); using var owner = data.Client; var other = await fixture.Customer(); using var stranger = other.Client; var input = Input(data.Quote["quoteId"]!.GetValue<string>());
        using var stolen = await stranger.PostAsJsonAsync("/api/orders", input); Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        var created = (await OrderFixture.Json(await owner.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created))["order"]!; var id = created["summary"]!["id"]!.GetValue<string>(); using var hidden = await stranger.GetAsync("/api/orders/" + id); Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        using var cancel = await stranger.PostAsJsonAsync("/api/orders/" + id + "/cancel", new CancelOrderInput(created["summary"]!["version"]!.GetValue<string>())); Assert.Equal(HttpStatusCode.NotFound, cancel.StatusCode); Assert.Empty((await OrderFixture.Json(await stranger.GetAsync("/api/orders")))["items"]!.AsArray());
    }
    [Fact] public async Task FailureAfterStockHoldRollsBackOrderReservationEventsAndCartThenRetries()
    {
        var data = await Scenario(); using var client = data.Client; var input = Input(data.Quote["quoteId"]!.GetValue<string>()); await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var sales = scope.ServiceProvider.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", sales.Database.GetDbConnection().Database); var inv = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); var original = Convert.ToBase64String((await inv.Stock.AsNoTracking().SingleAsync(x => x.VariantId == data.Variant)).Version);
        await sales.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Orders] WITH NOCHECK ADD CONSTRAINT [CK_OrderTestFailure] CHECK ([Number]<0)");
        try { using var failed = await client.PostAsJsonAsync("/api/orders", input); Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode); }
        finally { await sales.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Orders] DROP CONSTRAINT [CK_OrderTestFailure]"); }
        Assert.False(await sales.Orders.AnyAsync(x => x.OwnerId == data.Owner)); Assert.False(await inv.Reservations.AnyAsync(x => x.OwnerId == data.Owner)); var stock = await inv.Stock.AsNoTracking().SingleAsync(x => x.VariantId == data.Variant); Assert.Equal(0, stock.Reserved); Assert.Equal(original, Convert.ToBase64String(stock.Version)); Assert.Single((await OrderFixture.Json(await client.GetAsync("/api/cart/en")))["lines"]!.AsArray());
        await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created);
    }
    [Fact] public async Task ConcurrentCancellationIsIdempotentAndReleasesOnlyReservedUnits()
    {
        var data = await Scenario(); using var client = data.Client; var created = (await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", Input(data.Quote["quoteId"]!.GetValue<string>())), HttpStatusCode.Created))["order"]!; var id = created["summary"]!["id"]!.GetValue<string>(); var input = new CancelOrderInput(created["summary"]!["version"]!.GetValue<string>());
        var responses = await Task.WhenAll(client.PostAsJsonAsync("/api/orders/" + id + "/cancel", input), client.PostAsJsonAsync("/api/orders/" + id + "/cancel", input)); foreach (var response in responses) Assert.Equal("Cancelled", (await OrderFixture.Json(response))["summary"]!["state"]!.GetValue<string>());
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var inv = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); var stock = await inv.Stock.SingleAsync(x => x.VariantId == data.Variant); Assert.Equal(0, stock.Reserved); Assert.Equal(5, stock.OnHand); Assert.False(await inv.Movements.AnyAsync(x => x.VariantId == data.Variant)); Assert.Equal(2, await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Set<SalesOrderEvent>().CountAsync(x => x.OrderId == id)); Assert.Equal(2, await scope.ServiceProvider.GetRequiredService<SalesDbContext>().SmsSignals.CountAsync(x => x.OrderEvent.OrderId == id));
    }
    private sealed class Clock : TimeProvider { public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
    [Fact] public async Task ExpiryWorkersAndRequestReplayShareTheOriginalDeadlineAndReleaseOnce()
    {
        await fixture.Settings(minutes: 1); var person = await fixture.Customer(); using var originalClient = person.Client; var item = await fixture.Product(); var clock = new Clock(); await using var factory = fixture.Sql.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<TimeProvider>(); s.AddSingleton<TimeProvider>(clock); })); using var client = factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); client.DefaultRequestHeaders.Authorization = originalClient.DefaultRequestHeaders.Authorization;
        var quote = await Quote(client, item.Variant, item.Method); var input = Input(quote["quoteId"]!.GetValue<string>()); var first = (await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created))["order"]!; clock.Now = clock.Now.AddMinutes(2);
        var workers = await Task.WhenAll(factory.Services.GetRequiredService<OrderExpiryRunner>().RunAsync(CancellationToken.None), factory.Services.GetRequiredService<OrderExpiryRunner>().RunAsync(CancellationToken.None)); Assert.Equal(1, workers.Sum(x => x.Expired)); Assert.All(workers, x => Assert.Equal(0, x.Failed));
        var replay = await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", input)); Assert.True(replay["replayed"]!.GetValue<bool>()); Assert.Equal("Expired", replay["order"]!["summary"]!["state"]!.GetValue<string>()); Assert.Equal(first["summary"]!["expiresAt"]!.GetValue<string>(), replay["order"]!["summary"]!["expiresAt"]!.GetValue<string>());
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); Assert.Equal(0, (await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x => x.VariantId == item.Variant)).Reserved); Assert.Equal(2, await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Set<SalesOrderEvent>().CountAsync(x => x.OrderId == first["summary"]!["id"]!.GetValue<string>()));
    }
    [Fact] public async Task DigitalOrderHasNoShippingAddressOrFeeAndMissingPhysicalAddressIsRejected()
    {
        var digital = await Scenario(digital: true); using var client = digital.Client; var order = (await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", Input(digital.Quote["quoteId"]!.GetValue<string>(), true)), HttpStatusCode.Created))["order"]!; Assert.Null(order["delivery"]); Assert.False(order["shippingRequired"]!.GetValue<bool>()); Assert.Equal("0", order["shippingRial"]!.GetValue<string>());
        var physical = await Scenario(); using var other = physical.Client; using var missing = await other.PostAsJsonAsync("/api/orders", Input(physical.Quote["quoteId"]!.GetValue<string>(), true)); Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
    }
    [Fact] public async Task OpenOrderCapPreventsAnotherHoldUntilTheFirstOrderIsCancelled()
    {
        var data = await Scenario(); using var client = data.Client; var first = (await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", Input(data.Quote["quoteId"]!.GetValue<string>())), HttpStatusCode.Created))["order"]!; var secondItem = await fixture.Product(); var quote = await Quote(client, secondItem.Variant, secondItem.Method); var input = Input(quote["quoteId"]!.GetValue<string>()); using var limited = await client.PostAsJsonAsync("/api/orders", input); Assert.Equal(HttpStatusCode.Conflict, limited.StatusCode);
        await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders/" + first["summary"]!["id"]!.GetValue<string>() + "/cancel", new CancelOrderInput(first["summary"]!["version"]!.GetValue<string>()))); await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created);
    }
    [Theory][InlineData("disabled")][InlineData("expired")]
    public async Task DisabledOrderingAndExpiredQuotesCannotReserveStock(string kind)
    {
        await fixture.Settings(); var person = await fixture.Customer(); using var originalClient = person.Client; var item = await fixture.Product(); var clock = new Clock();
        await using var factory = fixture.Sql.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<TimeProvider>(); s.AddSingleton<TimeProvider>(clock); }));
        using var client = factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); client.DefaultRequestHeaders.Authorization = originalClient.DefaultRequestHeaders.Authorization;
        var quote = await Quote(client, item.Variant, item.Method); if (kind == "disabled") await fixture.Settings(enabled: false); else clock.Now = clock.Now.AddMinutes(6);
        using var failed = await client.PostAsJsonAsync("/api/orders", Input(quote["quoteId"]!.GetValue<string>())); Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode);
        Assert.Single((await OrderFixture.Json(await client.GetAsync("/api/cart/en")))["lines"]!.AsArray());
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.AnyAsync(x => x.OwnerId == person.Owner)); Assert.Equal(0, (await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x => x.VariantId == item.Variant)).Reserved);
    }
    [Fact] public async Task FailedAdministrativeAuditRollsBackCancellationAndInventoryRelease()
    {
        var data = await Scenario(); using var client = data.Client; var order = (await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", Input(data.Quote["quoteId"]!.GetValue<string>())), HttpStatusCode.Created))["order"]!;
        var id = order["summary"]!["id"]!.GetValue<string>(); var version = order["summary"]!["version"]!.GetValue<string>();
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_OrderAuditFailure] CHECK ([Action]=N'GET')");
        try { using var failed = await fixture.Admin.PostAsJsonAsync("/api/admin/orders/" + id + "/cancel", new AdminCancelOrderInput(data.Owner, version)); Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode); }
        finally { await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_OrderAuditFailure]"); }
        var unchanged = await db.Orders.AsNoTracking().SingleAsync(x => x.Id == id); Assert.Equal(OrderState.AwaitingPayment, unchanged.State); Assert.Equal(version, Convert.ToBase64String(unchanged.Version));
        Assert.Equal(1, (await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x => x.VariantId == data.Variant)).Reserved); Assert.Equal(1, await db.Set<SalesOrderEvent>().CountAsync(x => x.OrderId == id));
        var cancelled = await OrderFixture.Json(await fixture.Admin.PostAsJsonAsync("/api/admin/orders/" + id + "/cancel", new AdminCancelOrderInput(data.Owner, version))); Assert.Equal("Cancelled", cancelled["summary"]!["state"]!.GetValue<string>());
        Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x => x.Resource == "/api/admin/orders/" + id + "/cancel"));
    }
    [Fact] public async Task CustomerOrderPagesUseStableSeekCursorsWithoutDuplicatesOrContactData()
    {
        await fixture.Settings(); var person = await fixture.Customer(); using var client = person.Client; var item = await fixture.Product(stock: 30); var expected = new HashSet<string>();
        for (var i = 0; i < 21; i++) {
            var quote = await Quote(client, item.Variant, item.Method); var order = (await OrderFixture.Json(await client.PostAsJsonAsync("/api/orders", Input(quote["quoteId"]!.GetValue<string>())), HttpStatusCode.Created))["order"]!; var id = order["summary"]!["id"]!.GetValue<string>(); expected.Add(id);
            // Domain cancellation keeps the test below the public HTTP limiter;
            // it still uses the real shared SQL transaction and stock contract.
            await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<SalesTransactionCoordinator>().RunAsync(() => scope.ServiceProvider.GetRequiredService<OrderService>().CancelAsync(person.Owner, id, order["summary"]!["version"]!.GetValue<string>(), person.Owner, CancellationToken.None));
        }
        var first = await OrderFixture.Json(await client.GetAsync("/api/orders")); var cursor = first["nextCursor"]!.GetValue<string>(); Assert.Equal(20, first["items"]!.AsArray().Count);
        var second = await OrderFixture.Json(await client.GetAsync("/api/orders?cursor=" + Uri.EscapeDataString(cursor))); Assert.Single(second["items"]!.AsArray()); Assert.Null(second["nextCursor"]);
        var seen = first["items"]!.AsArray().Concat(second["items"]!.AsArray()).Select(x => x!["id"]!.GetValue<string>()).ToArray(); Assert.Equal(21, seen.Distinct().Count()); Assert.True(expected.SetEquals(seen));
        foreach (var row in first["items"]!.AsArray()) foreach (var key in new[] { "ownerId", "contactName", "contactPhone", "delivery", "note" }) Assert.Null(row![key]);
        using var invalid = await client.GetAsync("/api/orders?cursor=not-a-cursor"); Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var oldest = second["items"]![0]!;
        var reference = Uri.EscapeDataString(oldest["reference"]!.GetValue<string>());
        var staffMatch = await OrderFixture.Json(await fixture.Admin.GetAsync($"/api/admin/orders/v2?state=Cancelled&reference={reference}"));
        var staffOrder = Assert.Single(staffMatch["items"]!.AsArray())!;
        Assert.Equal(oldest["id"]!.GetValue<string>(), staffOrder["id"]!.GetValue<string>());
        Assert.Equal(person.Owner, staffOrder["ownerId"]!.GetValue<string>());
        foreach (var key in new[] { "contactName", "contactPhone", "delivery", "note" }) Assert.Null(staffOrder[key]);
        var wrongState = await OrderFixture.Json(await fixture.Admin.GetAsync($"/api/admin/orders/v2?state=AwaitingPayment&reference={reference}"));
        Assert.Empty(wrongState["items"]!.AsArray());
        using var invalidState = await fixture.Admin.GetAsync("/api/admin/orders/v2?state=0");
        Assert.Equal(HttpStatusCode.BadRequest, invalidState.StatusCode);
        using var unauthorized = await client.GetAsync($"/api/admin/orders/v2?reference={reference}");
        Assert.Equal(HttpStatusCode.Forbidden, unauthorized.StatusCode);
    }
}
