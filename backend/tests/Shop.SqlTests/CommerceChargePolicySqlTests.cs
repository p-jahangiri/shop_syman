using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// This class gets its own SaymanTest_<GUID> database. The configurable caps,
// artificial prices and policies below are fixtures, never initial shop data.
public sealed class CommerceChargePolicySqlTests(SqlFixture fixture)
    : CreditRequirementsSqlBase(fixture), IClassFixture<SqlFixture>, IDisposable
{
    private WebApplicationFactory<Program>? authFactory;
    private Task<HttpClient> Administrator() => Staff("Administrator", authFactory ??= sql.Factory.WithWebHostBuilder(_ => { }));
    public void Dispose() => authFactory?.Dispose();
    private static string Text(JsonNode node, string key) => node[key]!.GetValue<string>();
    private static DateTimeOffset At(JsonNode node, string key) => DateTimeOffset.Parse(Text(node, key), CultureInfo.InvariantCulture);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private async Task<T> Scope<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        Assert.StartsWith("SaymanTest_", scope.ServiceProvider.GetRequiredService<SalesDbContext>().Database.GetDbConnection().Database);
        return await action(scope.ServiceProvider);
    }
    private static async Task<JsonNode> Body(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using (response) {
            var raw = await response.Content.ReadAsStringAsync();
            Assert.True(response.StatusCode == expected, $"HTTP {(int)response.StatusCode}; expected {(int)expected}: {raw}");
            Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
            if (Environment.GetEnvironmentVariable("SHOP_COMMERCE_POLICY_WIRE_DIR") is { Length: > 0 } directory) {
                Directory.CreateDirectory(directory); var file = Guid.NewGuid().ToString("N");
                await File.WriteAllTextAsync(Path.Combine(directory, file + ".json"), raw);
                await File.WriteAllTextAsync(Path.Combine(directory, file + ".meta.json"), JsonSerializer.Serialize(new { actualSqlHttpResponse = true, syntheticQaOnly = true, status = (int)response.StatusCode, method = response.RequestMessage!.Method.Method, path = response.RequestMessage.RequestUri!.PathAndQuery, cacheControl = response.Headers.CacheControl.ToString() }));
            }
            return JsonNode.Parse(raw)!;
        }
    }
    private static CheckoutChargePolicyInput Postpaid(string? version = null) => new(
        "postpaid", "پس‌کرایهٔ ساختگی آزمون", "Synthetic postpaid delivery",
        "کرایهٔ شرکت حمل جداگانه و نامعلوم است؛ دادهٔ آزمون", "External carrier fee is unknown; synthetic QA only",
        null, null, "included_unitemized", null, "goods", "half_up", version);
    private static CheckoutChargePolicyInput Known(string? version = null) => new(
        "flat", "ارسال ثابت ساختگی", "Synthetic fixed delivery", "فقط آزمون", "QA only", "7", null,
        "exempt", null, "goods", "half_up", version);
    private static async Task<JsonNode> SetPolicy(HttpClient admin, CheckoutChargePolicyInput? input = null)
    {
        var current = await Body(await admin.GetAsync("/api/admin/checkout-charges"));
        var version = current["version"]?.GetValue<string>();
        return await Body(await admin.PutAsJsonAsync("/api/admin/checkout-charges", (input ?? Postpaid()) with { Version = string.IsNullOrEmpty(version) ? null : version }));
    }
    private static async Task<JsonNode> SetSettings(HttpClient admin, int cap = 2, int minutes = 60, bool cheque = false)
    {
        var current = await Body(await admin.GetAsync("/api/admin/order-settings"));
        var version = current["version"]?.GetValue<string>();
        return await Body(await admin.PutAsJsonAsync("/api/admin/order-settings", new CheckoutOrderSettingsInput(true, minutes, cap, string.IsNullOrEmpty(version) ? null : version, cheque)));
    }
    [Fact]
    public async Task MissingChargeTextReturnsValidationAndPreservesVersion()
    {
        using var admin = await Administrator();
        var initial = await Body(await admin.GetAsync("/api/admin/checkout-charges"));
        var version = Text(initial, "version");
        var invalid = Postpaid(string.IsNullOrEmpty(version) ? null : version) with { ShippingDescriptionEn = null! };
        var rejected = await Body(await admin.PutAsJsonAsync("/api/admin/checkout-charges", invalid), HttpStatusCode.BadRequest);
        Assert.Equal("invalid_input", Text(rejected, "title"));
        Assert.Equal(version, Text(await Body(await admin.GetAsync("/api/admin/checkout-charges")), "version"));
    }

    private async Task<(string Variant, string Method)> Product(long price = 100003, int quantity = 5, bool digital = false, string? methodId = null, string? planId = null)
        => await Scope(async sp => {
            var catalog = sp.GetRequiredService<CatalogDbContext>();
            var method = methodId ?? await sp.GetRequiredService<PaymentsDbContext>().Methods.Where(m => m.Kind == "online" && m.Enabled && !m.RequiresApproval).Select(m => m.Id).FirstAsync();
            var product = new Product {
                Slug = "commerce-policy-" + Id(), CategoryId = await catalog.Categories.Where(c => c.IsActive).Select(c => c.Id).FirstAsync(),
                BrandId = await catalog.Brands.Where(b => b.IsActive).Select(b => b.Id).FirstAsync(), Status = "Published", IsDigital = digital,
                PurchaseMethods = [new() { MethodId = method }],
                Translations = [new() { Locale = "fa", Name = "کالای ساختگی سیاست تجاری", SearchName = "ساختگی" }, new() { Locale = "en", Name = "Synthetic commerce policy item", SearchName = "synthetic" }]
            };
            if (planId is not null) product.CreditPlans.Add(new() { PlanId = planId });
            var variant = new ProductVariant { Sku = "COMMERCE-POLICY-" + Id(), IsActive = true, PriceRial = price, LabelFa = "ساختگی", LabelEn = "Synthetic" };
            product.Variants.Add(variant); catalog.Products.Add(product); await catalog.SaveChangesAsync();
            var inventory = sp.GetRequiredService<InventoryDbContext>(); inventory.Stock.Add(new() { VariantId = variant.Id, OnHand = quantity }); await inventory.SaveChangesAsync();
            return (variant.Id, method);
        });
    private static async Task<JsonNode> Cart(HttpClient client, string variant, string locale = "en", int quantity = 1)
    {
        var current = await Body(await client.GetAsync("/api/cart/" + locale));
        return await Body(await client.PutAsJsonAsync("/api/cart/" + locale, new CartInput([new(variant, quantity)], current["version"]?.GetValue<string>())));
    }
    private static async Task<JsonNode> Quote(HttpClient client, JsonNode cart, string method, string locale = "en", string? request = null)
        => await Body(await client.PostAsJsonAsync("/api/cart/" + locale + "/quote", new CheckoutQuoteInput(Text(cart, "version"), method, null, request ?? Id())));
    private static CreateOrderInput OrderInput(string quote, bool digital = false) => new(quote, Id(), "Synthetic commerce QA customer", "09100000000",
        digital ? null : new("IR", "تهران", "تهران", "نشانی کاملاً ساختگی آزمون سیاست تجاری", "1234567890"), "Synthetic QA; no real purchase", true);
    private Task<CashOrderPaymentReadiness> CashReadiness(string owner, string order)
        => Scope(sp => sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(
            () => sp.GetRequiredService<ICashPaymentOrders>().ReadAsync(owner, order, default), inventoryOnly: true));
    private static void AssertIncludedQuote(JsonNode quote, bool digital = false)
    {
        Assert.Equal("0", Text(quote, "shippingRial"));
        Assert.Null(quote["taxRial"]);
        Assert.Equal(Text(quote, "goodsTotalRial"), Text(quote, "payableTotalRial"));
        var rules = quote["chargeRules"]!;
        Assert.Equal("postpaid", Text(rules, "shippingMode")); Assert.Equal(digital ? "digital" : "postpaid", Text(rules, "shippingReason"));
        Assert.Null(rules["shippingFeeRial"]); Assert.Null(rules["shippingFreeFromRial"]);
        Assert.Equal("included_unitemized", Text(rules, "taxMode")); Assert.True(rules["taxIncluded"]!.GetValue<bool>()); Assert.Null(rules["taxRateBasisPoints"]);
        var blockers = quote["blockers"]!.AsArray().Select(b => b!.GetValue<string>()).ToArray();
        Assert.DoesNotContain("tax_unconfigured", blockers); Assert.DoesNotContain("tax_basis_unavailable", blockers); Assert.DoesNotContain("shipping_unconfigured", blockers);
        Assert.False(quote["canPlaceOrder"]!.GetValue<bool>());
        if (quote["schemaVersion"]!.GetValue<int>() >= 4) Assert.False(quote["canPay"]!.GetValue<bool>());
    }
    private static void AssertIncludedHistory(JsonNode order, bool digital = false)
    {
        Assert.Equal("0", Text(order, "shippingRial")); Assert.True(order.AsObject().ContainsKey("taxRial")); Assert.Null(order["taxRial"]);
        Assert.True(order["taxIncluded"]!.GetValue<bool>()); Assert.False(order["taxBreakdownKnown"]!.GetValue<bool>());
        Assert.Equal(Text(order, "goodsTotalRial"), Text(order, "payableTotalRial"));
        if (digital) Assert.False(order.AsObject().ContainsKey("shippingMode")); else Assert.Equal("postpaid", Text(order, "shippingMode"));
        Assert.False(order["canPay"]!.GetValue<bool>());
    }

    [Fact]
    public async Task ExplicitPoliciesAndSixtyMinuteSettingsRequireTheirCurrentCasVersionsAndPersistNoInventedFeesOrRate()
    {
        using var admin = await Administrator(); var policy = await SetPolicy(admin); var settings = await SetSettings(admin, cap: 3);
        Assert.Equal("postpaid", Text(policy, "shippingMode")); Assert.Null(policy["shippingFeeRial"]); Assert.Null(policy["shippingFreeFromRial"]);
        Assert.Equal("included_unitemized", Text(policy, "taxMode")); Assert.Null(policy["taxRateBasisPoints"]);
        Assert.Equal(60, settings["reservationMinutes"]!.GetValue<int>()); Assert.Equal(3, settings["maxOpenOrdersPerCustomer"]!.GetValue<int>());
        await Body(await admin.PutAsJsonAsync("/api/admin/order-settings", new CheckoutOrderSettingsInput(true, 60, 4, Text(settings, "version"), false)));
        using (var stale = await admin.PutAsJsonAsync("/api/admin/order-settings", new CheckoutOrderSettingsInput(true, 1, 1, Text(settings, "version"), false))) Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        await SetPolicy(admin, Postpaid() with { ShippingNameEn = "Changed synthetic description" });
        using (var stale = await admin.PutAsJsonAsync("/api/admin/checkout-charges", Known(Text(policy, "version")))) Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        await Scope(async sp => {
            var sales = sp.GetRequiredService<SalesDbContext>(); var stored = await sales.ChargePolicies.AsNoTracking().SingleAsync();
            Assert.Equal("postpaid", stored.ShippingMode); Assert.Null(stored.ShippingFeeRial); Assert.Null(stored.ShippingFreeFromRial); Assert.Null(stored.TaxRateBasisPoints);
            var configured = await sales.OrderSettings.AsNoTracking().SingleAsync(); Assert.Equal(60, configured.ReservationMinutes); Assert.Equal(4, configured.MaxOpenOrdersPerCustomer); return true;
        });
    }

    [Theory]
    [InlineData("fee")][InlineData("threshold")][InlineData("tax_rate")]
    public async Task PostpaidAndUnitemizedPolicyRejectPretendAmountsThroughHttpAndSqlChecks(string kind)
    {
        using var admin = await Administrator(); var before = await SetPolicy(admin);
        var invalid = kind switch { "fee" => Postpaid(Text(before, "version")) with { ShippingFeeRial = "1" }, "threshold" => Postpaid(Text(before, "version")) with { ShippingFreeFromRial = "1" }, _ => Postpaid(Text(before, "version")) with { TaxRateBasisPoints = 1000 } };
        using (var response = await admin.PutAsJsonAsync("/api/admin/checkout-charges", invalid)) Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await Scope(async sp => {
            var db = sp.GetRequiredService<SalesDbContext>();
            var error = await Assert.ThrowsAsync<SqlException>(() => kind switch {
                "fee" => db.Database.ExecuteSqlRawAsync("UPDATE [sales].[CheckoutChargePolicies] SET [ShippingFeeRial]=1 WHERE [Id]=1"),
                "threshold" => db.Database.ExecuteSqlRawAsync("UPDATE [sales].[CheckoutChargePolicies] SET [ShippingFreeFromRial]=1 WHERE [Id]=1"),
                _ => db.Database.ExecuteSqlRawAsync("UPDATE [sales].[CheckoutChargePolicies] SET [TaxRateBasisPoints]=1000 WHERE [Id]=1")
            }); Assert.Equal(547, error.Number); return true;
        });
        Assert.Equal(before.ToJsonString(), (await Body(await admin.GetAsync("/api/admin/checkout-charges"))).ToJsonString());
    }

    [Theory][InlineData(false)][InlineData(true)]
    public async Task Quote3InBothLanguagesRetainsUnknownIncludedTaxWithKnownMerchantPayableWithoutAnyHold(bool digital)
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin);
        var person = await Customer(); using var customer = person.Client; var goods = await Product(9007199254740993, digital: digital);
        var cart = await Cart(customer, goods.Variant); var retained = new List<(string Locale, string Request, string Response)>();
        foreach (var locale in new[] { "fa", "en" }) {
            var request = Id(); var quote = await Quote(customer, cart, goods.Method, locale, request); retained.Add((locale, request, quote.ToJsonString())); AssertIncludedQuote(quote, digital); Assert.Equal("9007199254740993", Text(quote, "payableTotalRial")); Assert.True(quote["temporaryOrder"]!["canCreate"]!.GetValue<bool>());
            await Scope(async sp => { var stored = await sp.GetRequiredService<SalesDbContext>().Quotes.AsNoTracking().SingleAsync(q => q.Id == Text(quote, "quoteId")); Assert.Null(stored.TaxRial); Assert.True(stored.TaxIncluded); Assert.Equal(9007199254740993, stored.PayableTotalRial); Assert.Null(stored.TaxRateBasisPoints); return true; });
        }
        await SetPolicy(admin, Known());
        foreach (var saved in retained) Assert.Equal(saved.Response, (await Quote(customer, cart, goods.Method, saved.Locale, saved.Request)).ToJsonString());
        await Scope(async sp => { var inventory = sp.GetRequiredService<InventoryDbContext>(); Assert.False(await inventory.Reservations.AnyAsync(r => r.OwnerId == person.Owner)); Assert.Equal(0, (await inventory.Stock.AsNoTracking().SingleAsync(s => s.VariantId == goods.Variant)).Reserved); return true; });
    }

    [Theory][InlineData(false)][InlineData(true)]
    public async Task Order1AndItsV2HistoryAdapterKeepNullTaxAndImmutableDeliveryDisclosureAfterPolicyChanges(bool digital)
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin);
        var person = await Customer(); using var customer = person.Client; var goods = await Product(digital: digital);
        var quote = await Quote(customer, await Cart(customer, goods.Variant), goods.Method); var input = OrderInput(Text(quote, "quoteId"), digital);
        var created = await Body(await customer.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created); var order = created["order"]!; AssertIncludedHistory(order, digital); var id = Text(order["summary"]!, "id");
        var v2 = await Body(await customer.GetAsync("/api/orders/v2/" + id)); AssertIncludedHistory(v2, digital); Assert.Equal(1, v2["originalSnapshotVersion"]!.GetValue<int>());
        var immutable = await Scope(async sp => { var row = await sp.GetRequiredService<SalesDbContext>().Orders.AsNoTracking().SingleAsync(o => o.Id == id); Assert.Null(row.TaxRial); Assert.False(row.TaxBreakdownKnown); return row.QuoteSnapshotJson; });
        var payment = await CashReadiness(person.Owner, id); Assert.True(payment.CanInitiate); Assert.Empty(payment.Blockers); Assert.Equal(100003, payment.AmountRial);
        await SetPolicy(admin, Known());
        Assert.Equal(order.ToJsonString(), (await Body(await customer.GetAsync("/api/orders/" + id))).ToJsonString());
        Assert.Equal(v2.ToJsonString(), (await Body(await customer.GetAsync("/api/orders/v2/" + id))).ToJsonString());
        var replay = await Body(await customer.PostAsJsonAsync("/api/orders", input)); Assert.True(replay["replayed"]!.GetValue<bool>()); Assert.Equal(order.ToJsonString(), replay["order"]!.ToJsonString());
        Assert.Equal(JsonSerializer.Serialize(payment, Json), JsonSerializer.Serialize(await CashReadiness(person.Owner, id), Json));
        await Scope(async sp => { var sales = sp.GetRequiredService<SalesDbContext>(); Assert.Equal(immutable, (await sales.Orders.AsNoTracking().SingleAsync(o => o.Id == id)).QuoteSnapshotJson); Assert.False(await sales.OrderCashPayments.AnyAsync(p => p.OrderId == id)); return true; });
    }

    [Fact]
    public async Task KnownLegacyHistoryOmitsBothAdditiveDisclosuresEvenWhenTodaysPolicyIsPostpaidAndUnitemized()
    {
        using var admin = await Administrator(); await SetPolicy(admin, Known()); await SetSettings(admin);
        var person = await Customer(); using var customer = person.Client; var goods = await Product();
        var quote = await Quote(customer, await Cart(customer, goods.Variant), goods.Method);
        var input = OrderInput(Text(quote, "quoteId")); var order = (await Body(await customer.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created))["order"]!; var id = Text(order["summary"]!, "id");
        Assert.Equal("7", Text(order, "shippingRial")); Assert.Equal("0", Text(order, "taxRial"));
        foreach (var key in new[] { "shippingMode", "taxBreakdownKnown" }) Assert.False(order.AsObject().ContainsKey(key));
        await SetPolicy(admin);
        var v2 = await Body(await customer.GetAsync("/api/orders/v2/" + id)); foreach (var key in new[] { "shippingMode", "taxBreakdownKnown" }) Assert.False(v2.AsObject().ContainsKey(key));
        Assert.Equal("7", Text(v2, "shippingRial")); Assert.Equal("0", Text(v2, "taxRial"));
        Assert.Equal(order.ToJsonString(), (await Body(await customer.PostAsJsonAsync("/api/orders", input)))["order"]!.ToJsonString());
        await Scope(async sp => { var stored = await sp.GetRequiredService<SalesDbContext>().Orders.AsNoTracking().SingleAsync(o => o.Id == id); Assert.True(stored.TaxBreakdownKnown); Assert.Equal(0, stored.TaxRial); return true; });
    }

    [Theory]
    [InlineData("zero_tax")][InlineData("known_null")][InlineData("known_zero")][InlineData("not_included")][InlineData("wrong_mode")][InlineData("missing_mode")]
    public async Task UnknownIncludedOrderSqlChecksRejectInventedTaxOrMissingSnapshotAuthorityWithoutChangingItsReceipt(string kind)
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin);
        var person = await Customer(); using var customer = person.Client; var goods = await Product();
        var quote = await Quote(customer, await Cart(customer, goods.Variant), goods.Method);
        var order = (await Body(await customer.PostAsJsonAsync("/api/orders", OrderInput(Text(quote, "quoteId"))), HttpStatusCode.Created))["order"]!; var id = Text(order["summary"]!, "id");
        await Scope(async sp => {
            var db = sp.GetRequiredService<SalesDbContext>(); var original = await db.Orders.AsNoTracking().SingleAsync(o => o.Id == id); var version = Convert.ToBase64String(original.Version);
            var error = await Assert.ThrowsAsync<SqlException>(() => kind switch {
                "zero_tax" => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[Orders] SET [TaxRial]=0 WHERE [Id]={id}"),
                "known_null" => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[Orders] SET [TaxBreakdownKnown]=1 WHERE [Id]={id}"),
                "known_zero" => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[Orders] SET [TaxBreakdownKnown]=1,[TaxRial]=0 WHERE [Id]={id}"),
                "not_included" => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[Orders] SET [TaxIncluded]=0 WHERE [Id]={id}"),
                "wrong_mode" => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[Orders] SET [QuoteSnapshotJson]=JSON_MODIFY([QuoteSnapshotJson],'$.ChargeRules.TaxMode','exempt') WHERE [Id]={id}"),
                _ => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[Orders] SET [QuoteSnapshotJson]=JSON_MODIFY([QuoteSnapshotJson],'$.ChargeRules.TaxMode',NULL) WHERE [Id]={id}")
            }); Assert.Equal(547, error.Number);
            var after = await db.Orders.AsNoTracking().SingleAsync(o => o.Id == id); Assert.Equal(version, Convert.ToBase64String(after.Version)); Assert.Equal(original.QuoteSnapshotJson, after.QuoteSnapshotJson); Assert.Null(after.TaxRial); Assert.False(after.TaxBreakdownKnown); return true;
        });
        Assert.Equal(order.ToJsonString(), (await Body(await customer.GetAsync("/api/orders/" + id))).ToJsonString()); Assert.True((await CashReadiness(person.Owner, id)).CanInitiate);
    }

    [Fact]
    public async Task ValidLateQuoteStartsAFullSixtyMinuteOrdinaryHoldAndItsReplayNeverRenewsIt()
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin);
        var person = await Customer(); using var original = person.Client; var goods = await Product(); var clock = new Clock();
        using var shifted = sql.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<TimeProvider>(); s.AddSingleton<TimeProvider>(clock); }));
        using var customer = shifted.CreateClient(new() { HandleCookies = false }); foreach (var header in original.DefaultRequestHeaders) customer.DefaultRequestHeaders.TryAddWithoutValidation(header.Key, header.Value);
        var quote = await Quote(customer, await Cart(customer, goods.Variant), goods.Method); var quoteUntil = At(quote, "expiresAt"); clock.Now = At(quote, "createdAt").AddMinutes(4);
        var input = OrderInput(Text(quote, "quoteId")); var order = (await Body(await customer.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created))["order"]!; var summary = order["summary"]!; var id = Text(summary, "id");
        Assert.Equal(clock.Now.AddMinutes(60), At(summary, "expiresAt")); Assert.True(At(summary, "expiresAt") > quoteUntil.AddMinutes(50));
        clock.Now = quoteUntil.AddMinutes(1);
        var replay = await Body(await customer.PostAsJsonAsync("/api/orders", input)); Assert.True(replay["replayed"]!.GetValue<bool>()); Assert.Equal(order.ToJsonString(), replay["order"]!.ToJsonString());
        await Scope(async sp => {
            var sales = sp.GetRequiredService<SalesDbContext>(); var inventory = sp.GetRequiredService<InventoryDbContext>();
            Assert.Single(await sales.Orders.Where(o => o.OwnerId == person.Owner).ToArrayAsync()); var hold = Assert.Single(await inventory.Reservations.Where(r => r.OwnerId == person.Owner).ToArrayAsync());
            Assert.Equal(At(summary, "createdAt"), hold.CreatedAt); Assert.Equal(At(summary, "expiresAt"), hold.ExpiresAt); Assert.Equal(TimeSpan.FromMinutes(60), hold.ExpiresAt - hold.CreatedAt); Assert.Equal(StockReservationState.Active, hold.State);
            Assert.Equal(1, (await inventory.Stock.AsNoTracking().SingleAsync(s => s.VariantId == goods.Variant)).Reserved); Assert.Single(await sales.Set<SalesOrderEvent>().Where(e => e.OrderId == id).ToArrayAsync()); return true;
        });
    }

    [Fact]
    public async Task AnExpiredQuoteCannotUseTheLongerReservationSettingToCreateAnyOrderOrHold()
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin);
        var person = await Customer(); using var original = person.Client; var goods = await Product(); var clock = new Clock();
        using var shifted = sql.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<TimeProvider>(); s.AddSingleton<TimeProvider>(clock); }));
        using var customer = shifted.CreateClient(new() { HandleCookies = false }); foreach (var header in original.DefaultRequestHeaders) customer.DefaultRequestHeaders.TryAddWithoutValidation(header.Key, header.Value);
        var cart = await Cart(customer, goods.Variant); var quote = await Quote(customer, cart, goods.Method); clock.Now = At(quote, "expiresAt");
        var stockVersion = await Scope(async sp => Convert.ToBase64String((await sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(s => s.VariantId == goods.Variant)).Version));
        await Body(await customer.PostAsJsonAsync("/api/orders", OrderInput(Text(quote, "quoteId"))), HttpStatusCode.Conflict);
        Assert.Equal(Text(cart, "version"), Text(await Body(await customer.GetAsync("/api/cart/en")), "version"));
        await Scope(async sp => { var sales = sp.GetRequiredService<SalesDbContext>(); var inventory = sp.GetRequiredService<InventoryDbContext>(); Assert.False(await sales.Orders.AnyAsync(o => o.OwnerId == person.Owner)); Assert.False(await inventory.Reservations.AnyAsync(r => r.OwnerId == person.Owner)); var stock = await inventory.Stock.AsNoTracking().SingleAsync(s => s.VariantId == goods.Variant); Assert.Equal(0, stock.Reserved); Assert.Equal(stockVersion, Convert.ToBase64String(stock.Version)); return true; });
    }

    [Fact]
    public async Task OpenOrderCapIsAConfigurableCasPolicyAndARejectedThirdOrderDoesNotTakeStock()
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin, cap: 2);
        var person = await Customer(); using var customer = person.Client; var goods = await Product(quantity: 5);
        for (var i = 0; i < 2; i++) { var quote = await Quote(customer, await Cart(customer, goods.Variant), goods.Method); await Body(await customer.PostAsJsonAsync("/api/orders", OrderInput(Text(quote, "quoteId"))), HttpStatusCode.Created); }
        var cart = await Cart(customer, goods.Variant); var third = await Quote(customer, cart, goods.Method); var denied = await Body(await customer.PostAsJsonAsync("/api/orders", OrderInput(Text(third, "quoteId"))), HttpStatusCode.Conflict); Assert.Equal("open_order_limit_conflict", Text(denied, "title"));
        await Scope(async sp => { Assert.Equal(2, await sp.GetRequiredService<SalesDbContext>().Orders.CountAsync(o => o.OwnerId == person.Owner)); Assert.Equal(2, (await sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(s => s.VariantId == goods.Variant)).Reserved); return true; });
        await SetSettings(admin, cap: 3); var fresh = await Quote(customer, cart, goods.Method); await Body(await customer.PostAsJsonAsync("/api/orders", OrderInput(Text(fresh, "quoteId"))), HttpStatusCode.Created);
        await Scope(async sp => { Assert.Equal(3, await sp.GetRequiredService<SalesDbContext>().Orders.CountAsync(o => o.OwnerId == person.Owner)); Assert.Equal(3, (await sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(s => s.VariantId == goods.Variant)).Reserved); return true; });
    }

    private sealed record AcceptedCart(HttpClient Customer, string Owner, string Variant, string Acceptance, JsonNode Cart);
    private async Task<AcceptedCart> MixedCart(HttpClient admin)
    {
        var key = Id(); var model = new CatalogModelInput("phones", "samsung", "commerce-policy-market-" + key,
            [new("fa", "مدل ساختگی سیاست تجاری " + key, "فقط آزمون"), new("en", "Synthetic commerce policy model " + key, "QA only")],
            [new("battery", TextFa: "باتری ساختگی", TextEn: "Synthetic battery")], ["/products/phone-green.svg"], null);
        var listing = Text(await Body(await admin.PostAsJsonAsync("/api/admin/market/models", new CreateMarketModelInput(model, new("Published", "qa-commerce-policy", key, "منبع ساختگی", "Synthetic source", null, "unknown", null, null, null, true)))), "id");
        var person = await Customer(); var customer = person.Client;
        try {
            var cart = await Body(await customer.GetAsync("/api/cart/en/sourcing")); cart = await Body(await customer.PutAsJsonAsync("/api/cart/en/sourcing", new CartSourcingInput([new(listing, 1)], cart["version"]?.GetValue<string>())));
            var candidate = cart["lines"]![0]!["candidate"]!; var productId = Text(candidate["model"]!, "id"); var request = Text(await Body(await customer.PostAsJsonAsync("/api/cart/en/sourcing/submit", new SourcingSubmitInput(Id(), Text(cart, "version"), [new(listing, Text(candidate, "fingerprint"))])), HttpStatusCode.Created), "id");
            var variant = Id();
            await Scope(async sp => { var catalog = sp.GetRequiredService<CatalogDbContext>(); var product = await catalog.Products.Include(p => p.PurchaseMethods).SingleAsync(p => p.Id == productId); product.Status = "Published"; product.PurchaseMethods.Add(new() { ProductId = productId, MethodId = "online" }); catalog.Variants.Add(new() { Id = variant, ProductId = productId, Sku = "COMMERCE-MIXED-" + key, IsActive = true, PriceRial = 100003, LabelFa = "ساختگی", LabelEn = "Synthetic" }); await catalog.SaveChangesAsync(); return true; });
            var parent = await Body(await admin.GetAsync($"/api/admin/sourcing/requests/{request}")); var sku = await Body(await admin.GetAsync($"/api/admin/sourcing/requests/{request}/offer-skus/{variant}?listingId={listing}")); var offer = Id(); var line = Id(); var path = $"/api/admin/sourcing/requests/{request}/offers/{offer}"; var now = DateTimeOffset.UtcNow;
            await Body(await admin.PutAsJsonAsync(path, new SourcingOfferSaveInput(Id(), Text(parent["summary"]!, "version"), null, [new(line, listing, variant, 1, "1234", Text(sku, "materialFingerprint"), Text(sku, "currentFingerprint"))], "توافق ساختگی آزمون سیاست تجاری", "Synthetic commerce policy agreement", now.AddMinutes(20), now.AddHours(2))));
            var draft = await Body(await admin.GetAsync(path)); await Body(await admin.PostAsJsonAsync(path + "/publish", new SourcingOfferPublishInput(Id(), Text(draft, "requestVersion"), Text(draft["offer"]!["summary"]!, "version"), Text(draft["offer"]!["summary"]!, "termsHash"))));
            var ownPath = $"/api/sourcing/requests/{request}/offers/{offer}"; var published = await Body(await customer.GetAsync(ownPath)); await Body(await customer.PostAsJsonAsync(ownPath + "/accept", new SourcingOfferActionInput(Id(), Text(published, "requestVersion"), Text(published["offer"]!["summary"]!, "version"), Text(published["offer"]!["summary"]!, "termsHash"))));
            var accepted = await Body(await customer.GetAsync(ownPath)); var summary = accepted["offer"]!["summary"]!; var acceptance = Text(accepted["offer"]!, "acceptanceId"); var task = Id();
            await Body(await admin.PutAsJsonAsync(path + "/supply/" + task, new SourcingSupplyStartInput(Id(), Text(accepted, "requestVersion"), Text(summary, "version"), Text(summary, "termsHash"))));
            await Body(await admin.PostAsJsonAsync($"/api/admin/inventory/{variant}/adjust", new StockAdjustment(3, "Synthetic D60 commerce physical quantity", Id(), null)));
            var allocation = await Body(await admin.GetAsync("/api/admin/inventory/sourcing-tasks/" + task + "/allocation")); var stock = allocation["stock"]![0]!;
            await Body(await admin.PutAsJsonAsync($"/api/admin/inventory/sourcing-requests/{request}/tasks/{task}/allocations/{Id()}", new SourcingAllocationInput(Id(), Text(allocation, "requestVersion"), Text(allocation, "taskVersion"), Text(allocation, "offerVersion"), acceptance, Text(allocation, "termsHash"), DateTimeOffset.UtcNow.AddMinutes(12), "Synthetic D60 acceptance cap", [new(line, Text(stock, "version"), Text(stock, "trackingMode"), [])])));
            var purchase = await Body(await customer.GetAsync(ownPath + "/purchase")); await Body(await customer.PostAsJsonAsync(ownPath + "/convert", new SourcingConversionInput(Id(), Text(purchase, "taskId"), Text(purchase, "requestVersion"), Text(purchase, "taskVersion"), Text(purchase, "offerVersion"), Text(purchase, "acceptanceId"), Text(purchase["agreement"]!, "id"), Text(purchase["agreement"]!, "version"), Text(purchase["allocation"]!, "allocationId"), Text(purchase["allocation"]!, "version"), Text(purchase, "termsHash"), purchase["cartVersion"]?.GetValue<string>())));
            cart = await Body(await customer.GetAsync("/api/cart/en/v2")); cart = await Body(await customer.PutAsJsonAsync("/api/cart/en/v2", new CartV2Input([new(variant, 1)], Text(cart, "version"))));
            return new(customer, person.Owner, variant, acceptance, cart);
        }
        catch { customer.Dispose(); throw; }
    }

    [Fact]
    public async Task MixedQuote4AndQuote5KeepExactUnknownTaxAndOrder2UsesAcceptanceDeadlineRatherThanFiveMinuteQuoteExpiry()
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin); var data = await MixedCart(admin); using var customer = data.Customer;
        foreach (var locale in new[] { "fa", "en" }) { var quote4 = await Body(await customer.PostAsJsonAsync($"/api/cart/{locale}/v2/quote", new CheckoutQuoteInput(Text(data.Cart, "version"), "online", null, Id()))); Assert.Equal(4, quote4["schemaVersion"]!.GetValue<int>()); AssertIncludedQuote(quote4); Assert.False(quote4["temporaryOrder"]!["canCreate"]!.GetValue<bool>()); }
        var quote = await Body(await customer.PostAsJsonAsync("/api/cart/en/v2/order-quote", new CheckoutQuoteInput(Text(data.Cart, "version"), "online", null, Id()))); AssertIncludedQuote(quote); Assert.Equal("101237", Text(quote, "payableTotalRial")); Assert.True(quote["temporaryOrder"]!["canCreate"]!.GetValue<bool>());
        var accepted = Assert.Single(quote["lines"]!.AsArray(), l => Text(l!, "lineKind") == "acceptedOffer")!["accepted"]!;
        var input = OrderInput(Text(quote, "quoteId")); var order = (await Body(await customer.PostAsJsonAsync("/api/orders/v2", input), HttpStatusCode.Created))["order"]!; AssertIncludedHistory(order); var id = Text(order["summary"]!, "id"); var until = At(order["summary"]!, "expiresAt");
        Assert.Equal(At(accepted, "allocationExpiresAt"), until); Assert.True(until <= At(accepted, "purchaseUntil")); Assert.True(until > At(quote, "expiresAt").AddMinutes(5));
        var payment = await CashReadiness(data.Owner, id); Assert.True(payment.CanInitiate); Assert.Empty(payment.Blockers); Assert.Equal(101237, payment.AmountRial);
        await SetPolicy(admin, Known()); Assert.Equal(order.ToJsonString(), (await Body(await customer.GetAsync("/api/orders/v2/" + id))).ToJsonString());
        var replay = await Body(await customer.PostAsJsonAsync("/api/orders/v2", input)); Assert.True(replay["replayed"]!.GetValue<bool>()); Assert.Equal(order.ToJsonString(), replay["order"]!.ToJsonString());
        Assert.Equal(JsonSerializer.Serialize(payment, Json), JsonSerializer.Serialize(await CashReadiness(data.Owner, id), Json));
        await Scope(async sp => { var sales = sp.GetRequiredService<SalesDbContext>(); var row = await sales.Orders.AsNoTracking().SingleAsync(o => o.Id == id); Assert.False(row.TaxBreakdownKnown); Assert.Null(row.TaxRial); Assert.Equal(2, row.SnapshotVersion); var inventory = sp.GetRequiredService<InventoryDbContext>(); var hold = await inventory.Reservations.AsNoTracking().SingleAsync(r => r.OrderId == id); Assert.Equal(until, hold.ExpiresAt); Assert.Equal(2, (await inventory.Stock.AsNoTracking().SingleAsync(s => s.VariantId == data.Variant)).Reserved); Assert.Equal("Transferred", (await inventory.SourcingAllocations.AsNoTracking().SingleAsync(a => a.AcceptanceId == data.Acceptance)).State); return true; });
    }

    [Fact]
    public async Task ExpiredQuote5LeavesAcceptedAllocationAndAllOrdinaryStockUntouchedDespiteSixtyMinuteSetting()
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin); var data = await MixedCart(admin); using var original = data.Customer;
        var quote = await Body(await original.PostAsJsonAsync("/api/cart/en/v2/order-quote", new CheckoutQuoteInput(Text(data.Cart, "version"), "online", null, Id())));
        var before = await Scope(async sp => { var inventory = sp.GetRequiredService<InventoryDbContext>(); return JsonSerializer.Serialize(new { Stock = await inventory.Stock.AsNoTracking().SingleAsync(s => s.VariantId == data.Variant), Allocation = await inventory.SourcingAllocations.AsNoTracking().SingleAsync(a => a.AcceptanceId == data.Acceptance) }, Json); });
        var clock = new Clock { Now = At(quote, "expiresAt") }; using var shifted = sql.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<TimeProvider>(); s.AddSingleton<TimeProvider>(clock); }));
        using var customer = shifted.CreateClient(new() { HandleCookies = false }); foreach (var header in original.DefaultRequestHeaders) customer.DefaultRequestHeaders.TryAddWithoutValidation(header.Key, header.Value);
        await Body(await customer.PostAsJsonAsync("/api/orders/v2", OrderInput(Text(quote, "quoteId"))), HttpStatusCode.Conflict);
        await Scope(async sp => { var inventory = sp.GetRequiredService<InventoryDbContext>(); var sales = sp.GetRequiredService<SalesDbContext>(); Assert.False(await sales.Orders.AnyAsync(o => o.OwnerId == data.Owner)); Assert.False(await inventory.Reservations.AnyAsync(r => r.OwnerId == data.Owner)); Assert.Equal("Active", (await sales.SourcingPriceAgreements.AsNoTracking().SingleAsync(a => a.AcceptanceId == data.Acceptance)).State); Assert.Equal(before, JsonSerializer.Serialize(new { Stock = await inventory.Stock.AsNoTracking().SingleAsync(s => s.VariantId == data.Variant), Allocation = await inventory.SourcingAllocations.AsNoTracking().SingleAsync(a => a.AcceptanceId == data.Acceptance) }, Json)); return true; });
    }

    [Fact]
    public async Task ChequeQuoteAndActualOrderAcceptKnownPayableWithUnitemizedTaxWhileRetainingTheirEarlierCreditCap()
    {
        using var admin = await Administrator(); await SetPolicy(admin); await SetSettings(admin, cheque: true); var plan = await Plan();
        var method = await Scope(async sp => { var payments = sp.GetRequiredService<PaymentsDbContext>(); var row = new PurchaseMethod { NameFa = "چک ساختگی سیاست تجاری", NameEn = "Synthetic commerce cheque", Kind = "cheque", Enabled = true, RequiresApproval = true }; payments.Methods.Add(row); await payments.SaveChangesAsync(); return row.Id; });
        var goods = await Product(methodId: method, planId: plan.Id); var person = await Customer(); using var customer = person.Client;
        var scope = await CreditCheckoutQuoteQa.Scope(customer, admin, admin, plan.Id, plan.Version, until: DateTimeOffset.UtcNow.AddMinutes(20));
        var cart = await Cart(customer, goods.Variant); var quote = (await Body(await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()), CreditCheckoutQuoteQa.Input(scope, Text(cart, "version"), goods.Method, plan.Id))))["quote"]!;
        AssertIncludedQuote(quote["ordinaryQuote"]!); Assert.Equal(Text(quote["ordinaryQuote"]!, "payableTotalRial"), Text(quote["assessment"]!, "assessedAmountRial")); Assert.True(quote["assessment"]!["withinLimit"]!.GetValue<bool>());
        var input = new CreditOrderInput(Text(quote, "id"), Text(quote, "fingerprint"), "Synthetic cheque policy buyer", "09100000000", new("IR", "تهران", "تهران", "نشانی کاملاً ساختگی آزمون چک", "1234567890"), "Synthetic QA; no real cheque", true, true);
        var path = "/api/credit-orders/commands/" + Id(); var created = await Body(await customer.PostAsJsonAsync(path, input)); var order = created["order"]!; AssertIncludedHistory(order); var id = Text(order["summary"]!, "id");
        Assert.True(At(order["summary"]!, "expiresAt") <= At(quote, "expiresAt")); Assert.True(At(order["summary"]!, "expiresAt") < At(order["summary"]!, "createdAt").AddMinutes(60));
        await SetPolicy(admin, Known()); var replay = await Body(await customer.PostAsJsonAsync(path, input)); Assert.True(replay["replayed"]!.GetValue<bool>()); Assert.Equal(order.ToJsonString(), replay["order"]!.ToJsonString());
        await Scope(async sp => { var sales = sp.GetRequiredService<SalesDbContext>(); var stored = await sales.Orders.AsNoTracking().SingleAsync(o => o.Id == id); Assert.False(stored.TaxBreakdownKnown); Assert.Null(stored.TaxRial); Assert.Single(await sales.CreditOrderLinks.Where(l => l.OrderId == id).ToArrayAsync()); Assert.Single(await sp.GetRequiredService<CreditDbContext>().PurchaseScopeUses.Where(u => u.OrderId == id).ToArrayAsync()); return true; });
    }
}
