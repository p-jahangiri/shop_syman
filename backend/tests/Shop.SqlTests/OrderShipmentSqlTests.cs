using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    private sealed record Scenario(HttpClient Customer, string Owner, string OrderId, string Variant, SerialUnitData? Unit);
    private sealed record StockFacts(int OnHand, int Reserved, int SourcingReserved, string Version, int Movements);
    private static string Id() => Guid.NewGuid().ToString("N");
    private static string SyntheticImei()
    {
        var body = "990000" + System.Security.Cryptography.RandomNumberGenerator.GetInt32(100000000).ToString("D8", System.Globalization.CultureInfo.InvariantCulture);
        var sum = body.Select((c, i) => { var n = c - '0'; if (i % 2 == 1) n *= 2; return n / 10 + n % 10; }).Sum();
        return body + ((10 - sum % 10) % 10).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    private static string Route(string id) => "/api/admin/orders/" + id + "/shipment/commands";
    private async Task<T> Scope<T>(Func<IServiceProvider, Task<T>> action) { await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); return await action(scope.ServiceProvider); }
    private static async Task<T> Body<T>(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using (response) { var raw = await response.Content.ReadAsStringAsync(); Assert.True(response.StatusCode == expected, $"HTTP {(int)response.StatusCode}, expected {(int)expected}: {raw}"); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); return JsonSerializer.Deserialize<T>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web))!; }
    }
    private Task<AdminShipmentData> Read(Scenario s) => Get<AdminShipmentData>(fixture.Admin, $"/api/admin/orders/{s.Owner}/{s.OrderId}/shipment");
    private static async Task<T> Get<T>(HttpClient client, string path) => await Body<T>(await client.GetAsync(path));
    private Task<StockFacts> Stock(string id) => Scope(async sp => { var db = sp.GetRequiredService<InventoryDbContext>(); var stock = await db.Stock.AsNoTracking().SingleAsync(x => x.VariantId == id); return new StockFacts(stock.OnHand, stock.Reserved, stock.SourcingReserved, Convert.ToBase64String(stock.Version), await db.Movements.CountAsync(x => x.VariantId == id)); });
    private static ShipmentCommandInput Input(AdminShipmentData state, string action, string? command = null) => new(state.OwnerId, command ?? Id(), action, state.OrderVersion, state.Shipment?.Version, state.InventoryFingerprint, "Synthetic QA shipment; not a real transaction", true, action == "dispatch" ? "حمل‌کنندهٔ نمونه" : null, action == "dispatch" ? "Synthetic carrier" : null, action == "dispatch" ? "QA-001" : null, action is "pack" or "repack" ? null : DateTimeOffset.UtcNow);
    private async Task<Scenario> Create(bool paid = true, string? mode = null, int quantity = 1)
    {
        await fixture.Settings(max: 10); var item = await fixture.Product(stock: mode is null ? Math.Max(5,quantity) : 0); SerialUnitData? unit = null; SerialUnitData[] receivedUnits = [];
        if (mode is not null) {
            var page = await Get<SerialUnitPage>(fixture.Admin, $"/api/admin/inventory/variants/{item.Variant}/serials?state=all");
            await Body<SerialCommandResult>(await fixture.Admin.PutAsJsonAsync($"/api/admin/inventory/variants/{item.Variant}/serial-mode", new SerialModeInput(mode, page.Stock.Version, Id())));
            page = await Get<SerialUnitPage>(fixture.Admin, $"/api/admin/inventory/variants/{item.Variant}/serials?state=all");
            var receipt = await Body<SerialCommandResult>(await fixture.Admin.PostAsJsonAsync($"/api/admin/inventory/variants/{item.Variant}/serials", new SerialReceiptInput(Enumerable.Range(0,quantity).Select(_=>mode == "imei" ? new SerialUnitInput(null, SyntheticImei()) : new SerialUnitInput("SHIP-" + Id())).ToArray(), "Synthetic receipt", page.Stock.Version, Id()))); receivedUnits=receipt.Units; unit = receivedUnits[0];
        }
        var customer = await fixture.Customer();
        var cart = await OrderFixture.Json(await customer.Client.GetAsync("/api/cart/en")); cart = await OrderFixture.Json(await customer.Client.PutAsJsonAsync("/api/cart/en", new CartInput([new(item.Variant, quantity)], cart["version"]?.GetValue<string>())));
        var quote = await Body<System.Text.Json.Nodes.JsonNode>(await customer.Client.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(cart["version"]!.GetValue<string>(), item.Method, null, Guid.NewGuid().ToString())));
        var order = (await OrderFixture.Json(await customer.Client.PostAsJsonAsync("/api/orders", new CreateOrderInput(quote["quoteId"]!.GetValue<string>(), Id(), "Synthetic QA customer", "09121234567", new("IR", "QA province", "QA city", "Synthetic address; not a real delivery", "1234567890"), null, true)), HttpStatusCode.Created))["order"]!;
        var result = new Scenario(customer.Client, customer.Owner, order["summary"]!["id"]!.GetValue<string>(), item.Variant, unit);
        if (paid) await Scope(async sp => await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async () => {
            var db = sp.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            var row = await db.Orders.SingleAsync(x => x.Id == result.OrderId); var hold = await sp.GetRequiredService<IStockReservations>().AllocateAsync(result.Owner, row.ReservationId, "synthetic-shipment-fixture", default); Assert.Equal(StockReservationState.Allocated, hold.State);
            // Test-only fact. No product endpoint/adapter can mark an order paid.
            row.State = OrderState.Paid; row.ChangedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync();
            if (unit is not null) await sp.GetRequiredService<IStockSerialAssignments>().AssignAsync(new(result.Owner, row.ReservationId, "synthetic-shipment-fixture", Id(), receivedUnits.Select(u=>new StockSerialPick(u.Id,u.Version,DateTimeOffset.UtcNow.AddYears(1))).ToArray()), default);
            return true;
        }, inventoryOnly: true));
        return result;
    }
    [Fact] public async Task PhysicalOrderPacksWithoutStockWriteDispatchesOnceAndKeepsHistoricalReceiptAfterDelivery()
    {
        var s = await Create(); using var customer = s.Customer; var before = await Stock(s.Variant); var ready = await Read(s); Assert.True(ready.CanPack); Assert.False(ready.CanDispatch);
        var pack = Input(ready, "pack"); var packed = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), pack)); Assert.Equal(before, await Stock(s.Variant)); Assert.Equal("packed", packed.Shipment.State);
        var dispatch = Input(await Read(s), "dispatch"); var sent = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), dispatch)); var after = await Stock(s.Variant); Assert.Equal(before.OnHand - 1, after.OnHand); Assert.Equal(0, after.Reserved); Assert.Equal(before.Movements + 1, after.Movements); Assert.Equal("Paid", (await Read(s)).OrderState);
        var replay = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), dispatch)); Assert.True(replay.Replayed); Assert.Equal(JsonSerializer.Serialize(sent with { Replayed = true }), JsonSerializer.Serialize(replay)); Assert.Equal(after, await Stock(s.Variant));
        var delivered = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(await Read(s), "deliver"))); Assert.Equal("delivered", delivered.Shipment.State); Assert.Equal("Fulfilled", (await Read(s)).OrderState); Assert.Equal(after, await Stock(s.Variant));
        var historical = await Get<ShipmentCommandResult>(fixture.Admin, Route(s.OrderId) + "/" + pack.CommandId); Assert.Equal("packed", historical.Shipment.State); Assert.Null(historical.Shipment.DispatchedAt); Assert.Equal(packed.OrderVersion, historical.OrderVersion);
        var oldReplay = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), pack)); Assert.Equal(JsonSerializer.Serialize(historical), JsonSerializer.Serialize(oldReplay));
        var own = await Get<CustomerShipmentData>(customer, "/api/orders/v2/" + s.OrderId + "/shipment"); Assert.Equal("delivered", own.Shipment!.State); Assert.True(own.ManualCarrierReport);
    }
    [Theory][InlineData("serial")][InlineData("imei")]
    public async Task ExactTrackedUnitIsPrivateUntilWarehouseHandoffAndPreservesExplicitWarranty(string mode)
    {
        var s = await Create(mode: mode); using var customer = s.Customer; var state = await Read(s); var packed = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(state, "pack"))); var unit = Assert.Single(packed.Shipment.Units); Assert.Equal(s.Unit!.Id, unit.UnitId); Assert.NotNull(unit.WarrantyUntil);
        var hidden = await Get<CustomerShipmentData>(customer, "/api/orders/" + s.OrderId + "/shipment"); Assert.False(hidden.Shipment!.UnitDetailsVisible); Assert.Empty(hidden.Shipment.Units);
        var sent = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(await Read(s), "dispatch"))); var visible = await Get<CustomerShipmentData>(customer, "/api/orders/" + s.OrderId + "/shipment"); Assert.True(visible.Shipment!.UnitDetailsVisible); Assert.Equal(JsonSerializer.Serialize(unit), JsonSerializer.Serialize(Assert.Single(visible.Shipment.Units))); Assert.Equal("dispatched", sent.Shipment.State);
        var stranger = await fixture.Customer(); using var strangerClient = stranger.Client; using var denied = await strangerClient.GetAsync("/api/orders/" + s.OrderId + "/shipment"); Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        using var staffOnly = await customer.GetAsync($"/api/admin/orders/{s.Owner}/{s.OrderId}/shipment"); Assert.Equal(HttpStatusCode.Forbidden, staffOnly.StatusCode);
        await Scope(async sp => { var db = sp.GetRequiredService<InventoryDbContext>(); var row = await db.SerialUnits.AsNoTracking().SingleAsync(x => x.Id == unit.UnitId); Assert.Equal("delivered", row.State); Assert.Equal(s.OrderId, row.OrderId); Assert.Equal(unit.WarrantyUntil, row.WarrantyUntil); return true; });
    }
    [Fact] public async Task UnpaidOrdersAndUnconfirmedStaleOrFutureCommandsCannotChangeInventory()
    {
        var s = await Create(paid: false); using var customer = s.Customer; var before = await Stock(s.Variant); var state = await Read(s); Assert.False(state.CanPack); Assert.Contains("payment_not_confirmed", state.Blockers);
        using (var unpaid = await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(state, "pack"))) Assert.Equal(HttpStatusCode.Conflict, unpaid.StatusCode); Assert.Equal(before, await Stock(s.Variant));
        var paid = await Create(); using var other = paid.Customer; var ready = await Read(paid);
        using (var missingAck = await fixture.Admin.PostAsJsonAsync(Route(paid.OrderId), Input(ready, "pack") with { Acknowledge = false })) Assert.Equal(HttpStatusCode.BadRequest, missingAck.StatusCode);
        using (var stale = await fixture.Admin.PostAsJsonAsync(Route(paid.OrderId), Input(ready, "pack") with { OrderVersion = "AAAAAAAAAAA=" })) Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(paid.OrderId), Input(ready, "pack"))); var packed = await Read(paid); var old = await Stock(paid.Variant);
        using (var future = await fixture.Admin.PostAsJsonAsync(Route(paid.OrderId), Input(packed, "dispatch") with { OccurredAt = DateTimeOffset.UtcNow.AddHours(1) })) Assert.Equal(HttpStatusCode.Conflict, future.StatusCode); Assert.Equal(old, await Stock(paid.Variant));
    }
}
