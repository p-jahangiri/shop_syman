using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;

// Real SQL regression proof for the existing Enabled contract. The storefront
// masks new-purchase promotions independently; historical receipts stay immutable.
public sealed class PurchaseMethodAvailabilitySqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    [Fact]
    public async Task DisabledKindsRejectFreshChoicesAndOldCashQuoteCannotReserveWhilePublicLocalesReflectTheChange()
    {
        await fixture.Settings();
        foreach (var kind in new[] { "online", "cheque", "installment" })
        {
            var method = await AddMethod(kind);
            var item = await Product([method]);
            var customer = await fixture.Customer();
            using var client = customer.Client;
            var cart = await Cart(client, item.Variant);
            var input = new CheckoutQuoteInput(cart["version"]!.GetValue<string>(), method,
                kind == "cheque" ? item.Plan : null, Id());
            var quote = await Json(await client.PostAsJsonAsync("/api/cart/en/quote", input));
            Assert.Equal(method, quote["selectedMethod"]!["id"]!.GetValue<string>());
            if (kind == "online") Assert.True(quote["temporaryOrder"]!["canCreate"]!.GetValue<bool>());

            await SetEnabled(method, false);
            foreach (var locale in new[] { "fa", "en" })
            {
                var snapshot = await Json(await client.GetAsync($"/api/storefront/{locale}?metadataOnly=true"));
                var current = snapshot["purchaseMethods"]!.AsArray().Single(m => m!["id"]!.GetValue<string>() == method)!;
                Assert.False(current["enabled"]!.GetValue<bool>());
                Assert.Equal(kind, current["kind"]!.GetValue<string>());
                Capture($"disabled-{kind}-{locale}", snapshot);
            }
            await Conflict(await client.PostAsJsonAsync("/api/cart/en/quote", input with { RequestId = Id() }), "quote_choice_conflict");
            if (kind == "online")
                await Conflict(await client.PostAsJsonAsync("/api/orders", Order(quote)), "quote_choice_conflict");

            // A replay is a receipt of the original calculation, not a grant
            // to buy under disabled conditions. New order validation above
            // rejects that receipt while its stored monetary terms stay exact.
            var replay = await Json(await client.PostAsJsonAsync("/api/cart/en/quote", input));
            Assert.Equal(quote.ToJsonString(), replay.ToJsonString());
            await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope();
            var sales = scope.ServiceProvider.GetRequiredService<SalesDbContext>();
            var stock = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
            Assert.False(await sales.Orders.AnyAsync(o => o.OwnerId == customer.Owner));
            Assert.False(await stock.Reservations.AnyAsync(r => r.OwnerId == customer.Owner));
            Assert.Equal(0, (await stock.Stock.AsNoTracking().SingleAsync(s => s.VariantId == item.Variant)).Reserved);
            Assert.Single((await Json(await client.GetAsync("/api/cart/en")))["lines"]!.AsArray());
        }
    }

    [Fact]
    public async Task DisablingOneMethodDoesNotDisableAnotherOfTheSameKindAndReenableUsesCurrentVersion()
    {
        var first = await AddMethod("online");
        var second = await AddMethod("online");
        var item = await Product([first, second]);
        var customer = await fixture.Customer();
        using var client = customer.Client;
        var cart = await Cart(client, item.Variant);
        var version = cart["version"]!.GetValue<string>();
        Assert.Equal(new[] { first, second }.Order(), (await Choices(client, version)).Order());

        var stale = await Method(first);
        await SetEnabled(first, false);
        Assert.Equal(second, Assert.Single(await Choices(client, version)));
        var available = await Json(await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(version, second, null, Id())));
        Assert.Equal(second, available["selectedMethod"]!["id"]!.GetValue<string>());
        var snapshot = await Json(await client.GetAsync("/api/storefront/en?metadataOnly=true"));
        Assert.Contains(snapshot["purchaseMethods"]!.AsArray(), m => m!["id"]!.GetValue<string>() == second && m["enabled"]!.GetValue<bool>());
        Capture("same-kind-one-enabled-en", snapshot);

        await SetEnabled(second, false);
        Assert.Empty(await Choices(client, version));
        await Conflict(await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(version, second, null, Id())), "quote_choice_conflict");
        await SetEnabled(first, true);
        Assert.Equal(first, Assert.Single(await Choices(client, version)));
        await Conflict(await fixture.Admin.PutAsJsonAsync("/api/admin/purchase-methods/" + first, Input(stale, false)), "version_conflict");
        Assert.True((await Method(first))["enabled"]!.GetValue<bool>());
    }

    [Fact]
    public async Task DisabledMethodPreservesCreatedOrderSnapshotsHistoryIdempotentReplayAndCancellation()
    {
        await fixture.Settings();
        var method = await AddMethod("online");
        var item = await Product([method]);
        var customer = await fixture.Customer();
        using var client = customer.Client;
        var cart = await Cart(client, item.Variant);
        var quote = await Json(await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(cart["version"]!.GetValue<string>(), method, null, Id())));
        var input = Order(quote);
        var created = await Json(await client.PostAsJsonAsync("/api/orders", input), HttpStatusCode.Created);
        var original = created["order"]!;
        var id = original["summary"]!["id"]!.GetValue<string>();
        string immutableSnapshot;
        await using (var scope = fixture.Sql.Factory.Services.CreateAsyncScope())
            immutableSnapshot = await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.Where(o => o.Id == id).Select(o => o.QuoteSnapshotJson).SingleAsync();

        await SetEnabled(method, false);
        var detail = await Json(await client.GetAsync("/api/orders/" + id));
        Assert.Equal(original.ToJsonString(), detail.ToJsonString());
        var history = await Json(await client.GetAsync("/api/orders"));
        Assert.Contains(history["items"]!.AsArray(), o => o!["id"]!.GetValue<string>() == id);
        var replay = await Json(await client.PostAsJsonAsync("/api/orders", input));
        Assert.True(replay["replayed"]!.GetValue<bool>());
        Assert.Equal(original.ToJsonString(), replay["order"]!.ToJsonString());

        var cancellation = new CancelOrderInput(original["summary"]!["version"]!.GetValue<string>());
        var cancelled = await Json(await client.PostAsJsonAsync("/api/orders/" + id + "/cancel", cancellation));
        Assert.Equal("Cancelled", cancelled["summary"]!["state"]!.GetValue<string>());
        var cancelledAgain = await Json(await client.PostAsJsonAsync("/api/orders/" + id + "/cancel", cancellation));
        Assert.Equal(cancelled.ToJsonString(), cancelledAgain.ToJsonString());
        await using var check = fixture.Sql.Factory.Services.CreateAsyncScope();
        var sales = check.ServiceProvider.GetRequiredService<SalesDbContext>();
        var inventory = check.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var stock = await inventory.Stock.AsNoTracking().SingleAsync(s => s.VariantId == item.Variant);
        Assert.Equal(0, stock.Reserved);
        Assert.Equal(5, stock.OnHand);
        Assert.False(await inventory.Movements.AnyAsync(m => m.VariantId == item.Variant));
        Assert.Equal(1, await sales.Orders.CountAsync(o => o.OwnerId == customer.Owner));
        Assert.Equal(2, await sales.Set<SalesOrderEvent>().CountAsync(e => e.OrderId == id));
        Assert.Equal(immutableSnapshot, await sales.Orders.Where(o => o.Id == id).Select(o => o.QuoteSnapshotJson).SingleAsync());
    }

    private static string Id() => Guid.NewGuid().ToString("N");
    private static Task<JsonNode> Json(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK) => OrderFixture.Json(response, expected);
    private static CreateOrderInput Order(JsonNode quote) => new(quote["quoteId"]!.GetValue<string>(), Id(),
        "Purchasing regression fixture", "09121234567", new("IR", "Test province", "Test city", "Disposable SQL fixture address", "1234567890"), "Synthetic test only", true);

    private async Task<string> AddMethod(string kind)
    {
        var created = await Json(await fixture.Admin.PostAsJsonAsync("/api/admin/purchase-methods", new PurchaseMethodInput(
            kind, "روش نمونهٔ آزمون " + Id(), "SQL method " + Id(), "فقط fixture موقت", "Disposable fixture only", true, false, null, null, [], null)));
        return created["id"]!.GetValue<string>();
    }

    private async Task<JsonNode> Method(string id) => (await Json(await fixture.Admin.GetAsync("/api/admin/purchase-methods/" + id)))["method"]!;
    private static PurchaseMethodInput Input(JsonNode m, bool enabled) => new(m["kind"]!.GetValue<string>(), m["nameFa"]!.GetValue<string>(),
        m["nameEn"]!.GetValue<string>(), m["descriptionFa"]!.GetValue<string>(), m["descriptionEn"]!.GetValue<string>(), enabled,
        m["requiresApproval"]!.GetValue<bool>(), m["minAmountRial"]?.GetValue<string>(), m["maxAmountRial"]?.GetValue<string>(),
        m["categoryIds"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray(), m["version"]!.GetValue<string>());

    private async Task SetEnabled(string id, bool enabled)
    {
        var before = await Method(id);
        await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/purchase-methods/" + id, Input(before, enabled)));
        var after = await Method(id);
        Assert.Equal(enabled, after["enabled"]!.GetValue<bool>());
        Assert.NotEqual(before["version"]!.GetValue<string>(), after["version"]!.GetValue<string>());
    }

    private async Task<(string Variant, string Plan)> Product(string[] methods)
    {
        var item = await fixture.Product();
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope();
        var catalog = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var product = await catalog.Products.Include(p => p.PurchaseMethods).SingleAsync(p => p.Variants.Any(v => v.Id == item.Variant));
        catalog.RemoveRange(product.PurchaseMethods);
        product.PurchaseMethods = methods.Select(method => new ProductPurchaseMethod { MethodId = method }).ToList();
        var credit = scope.ServiceProvider.GetRequiredService<CreditDbContext>();
        var plan = new ChequePlan { NameFa = "طرح نمونهٔ آزمون", NameEn = "Disposable SQL plan", Months = 6, IntervalMonths = 2,
            MarkupBasisPoints = 1000, DownPaymentBasisPoints = 2500, Enabled = true };
        credit.Plans.Add(plan);
        await credit.SaveChangesAsync();
        product.CreditPlans.Add(new() { PlanId = plan.Id });
        await catalog.SaveChangesAsync();
        return (item.Variant, plan.Id);
    }

    private static async Task<JsonNode> Cart(HttpClient client, string variant)
    {
        var before = await Json(await client.GetAsync("/api/cart/en"));
        return await Json(await client.PutAsJsonAsync("/api/cart/en", new CartInput([new(variant, 1)], before["version"]?.GetValue<string>())));
    }

    private static async Task<string[]> Choices(HttpClient client, string version) =>
        (await Json(await client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(version, null, null, null))))["methods"]!
        .AsArray().Select(m => m!["id"]!.GetValue<string>()).ToArray();

    private static async Task Conflict(HttpResponseMessage response, string code)
    {
        var problem = await Json(response, HttpStatusCode.Conflict);
        Assert.Equal(code, problem["title"]!.GetValue<string>());
    }

    private static void Capture(string name, JsonNode snapshot)
    {
        if (Environment.GetEnvironmentVariable("SHOP_PURCHASE_METHOD_WIRE_DIR") is not { Length: > 0 } directory) return;
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, name + ".json"), snapshot.ToJsonString());
    }
}
