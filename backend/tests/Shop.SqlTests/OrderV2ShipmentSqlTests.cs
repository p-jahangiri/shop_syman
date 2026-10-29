using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Shop.Modules.Identity;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class OrderV2HttpSqlTests
{
    private async Task<HttpClient> ShipmentAdministrator()
    {
        // The domain scenario already enrolls all three operational roles and
        // reaches the real HTTP auth limit. Authenticate this additional test
        // identity through the real password and MFA services, without changing
        // any production limiter or minting a test token.
        var session = await Scope(async sp => {
            var users = sp.GetRequiredService<UserManager<ShopUser>>(); var auth = sp.GetRequiredService<AuthService>();
            var name = "shipment" + Id(); var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true, RequireMfa = true, DisplayName = "Synthetic shipment QA" };
            Assert.True((await users.CreateAsync(user, fixture.Sql.Password)).Succeeded); Assert.True((await users.AddToRoleAsync(user, "Administrator")).Succeeded);
            var pending = await auth.PasswordAsync(new(name, fixture.Sql.Password), true, true, true, default); Assert.True(pending.RequiresMfa);
            var setup = JsonSerializer.SerializeToNode(await auth.SetupMfaAsync(user.Id, (await users.GetSecurityStampAsync(user))!, false, null, default), Json)!;
            var code = Totp.Code(Text(setup, "secret"), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30);
            return await auth.VerifyMfaAsync(user.Id, (await users.GetSecurityStampAsync(user))!, false, code, "synthetic-shipment-fixture", default);
        });
        Assert.False(session.RequiresMfa); var client = fixture.Sql.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1"); client.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken); return client;
    }

    [Fact] public async Task ShipmentPreservesSnapshot2LineRightsSameSkuAcceptedPricesAndTransferredAllocation()
    {
        await using var policy = await Order2Policies(); var data = await Quote4Cart(3, true, false); var s = data.Scenario; using var customer = s.Customer;
        var quote = await Order2Quote(s, data.Cart); var order = (await Body(await customer.PostAsJsonAsync("/api/orders/v2", Order2Input(Text(quote, "quoteId"))), HttpStatusCode.Created))["order"]!; var id = Text(order["summary"]!, "id"); var prices = order["lines"]!.ToJsonString();
        await Scope(async sp => await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async () => {
            var sales = sp.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", sales.Database.GetDbConnection().Database); var row = await sales.Orders.SingleAsync(x => x.Id == id);
            var allocated = await sp.GetRequiredService<IStockOrderReservationsV2>().AllocateAsync(s.Owner, row.ReservationId, "synthetic-shipment-fixture", default); Assert.Equal(StockReservationState.Allocated, allocated.State);
            row.State = OrderState.Paid; row.ChangedAt = DateTimeOffset.UtcNow; await sales.SaveChangesAsync(); return true;
        }, inventoryOnly: true));
        using var admin = await ShipmentAdministrator(); var readRoute = $"/api/admin/orders/{s.Owner}/{id}/shipment"; var writeRoute = $"/api/admin/orders/{id}/shipment/commands";
        var ready = (await admin.GetFromJsonAsync<AdminShipmentData>(readRoute))!; Assert.True(ready.CanPack);
        var pack = new ShipmentCommandInput(s.Owner, Id(), "pack", ready.OrderVersion, null, ready.InventoryFingerprint, "Synthetic snapshot2 QA", true, null, null, null, null);
        var packed = await Body(await admin.PostAsJsonAsync(writeRoute, pack)); Assert.Equal(2, packed["shipment"]!["lines"]!.AsArray().Count); Assert.Equal(order["lines"]!.AsArray().Select(x => Text(x!, "lineId")).Order(), packed["shipment"]!["lines"]!.AsArray().Select(x => Text(x!, "lineKey")).Order());
        ready = (await admin.GetFromJsonAsync<AdminShipmentData>(readRoute))!;
        var dispatch = new ShipmentCommandInput(s.Owner, Id(), "dispatch", ready.OrderVersion, ready.Shipment!.Version, ready.InventoryFingerprint, "Synthetic complete warehouse hand-off", true, "حمل آزمون", "QA carrier", null, DateTimeOffset.UtcNow);
        await Body(await admin.PostAsJsonAsync(writeRoute, dispatch));
        await Scope(async sp => { var db = sp.GetRequiredService<InventoryDbContext>(); var stock = await db.Stock.AsNoTracking().SingleAsync(x => x.VariantId == s.Variant); Assert.Equal(0, stock.OnHand); Assert.Equal(0, stock.Reserved); Assert.Equal(0, stock.SourcingReserved); Assert.Equal("Transferred", (await db.SourcingAllocations.AsNoTracking().SingleAsync(x => x.AcceptanceId == s.Acceptance)).State); return true; });
        ready = (await admin.GetFromJsonAsync<AdminShipmentData>(readRoute))!; await Body(await admin.PostAsJsonAsync(writeRoute, new ShipmentCommandInput(s.Owner, Id(), "deliver", ready.OrderVersion, ready.Shipment!.Version, ready.InventoryFingerprint, "Synthetic delivery confirmation", true, null, null, null, DateTimeOffset.UtcNow)));
        var historical = await Body(await customer.GetAsync("/api/orders/v2/" + id)); Assert.Equal("Fulfilled", Text(historical["summary"]!, "state")); Assert.Equal(prices, historical["lines"]!.ToJsonString());
        var shipment = await Body(await customer.GetAsync("/api/orders/v2/" + id + "/shipment")); Assert.Equal("delivered", Text(shipment["shipment"]!, "state")); Assert.True(shipment["manualCarrierReport"]!.GetValue<bool>());
    }
}
