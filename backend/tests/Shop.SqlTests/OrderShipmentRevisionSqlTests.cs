using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests
{
    [Fact] public async Task EmptySkuTrackingChangesAfterWarehouseHandoffCannotRewriteDevicesOrBlockCustomerDelivery()
    {
        var s = await Create(mode: "imei"); using var customer = s.Customer; var packed = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(await Read(s), "pack")));
        await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(await Read(s), "dispatch"))); var before = await Stock(s.Variant);
        var path = $"/api/admin/inventory/variants/{s.Variant}"; var page = await Get<SerialUnitPage>(fixture.Admin, path + "/serials?state=all");
        await Body<SerialCommandResult>(await fixture.Admin.PutAsJsonAsync(path + "/serial-mode", new SerialModeInput("none", page.Stock.Version, Id())));
        var ready = await Read(s); Assert.True(ready.CanDeliver); Assert.Equal("imei", Assert.Single(ready.Shipment!.Lines).TrackingMode); Assert.Equal(JsonSerializer.Serialize(packed.Shipment.Units), JsonSerializer.Serialize(ready.Shipment.Units));
        var stockAfterMode = await Stock(s.Variant); Assert.Equal(before.Movements, stockAfterMode.Movements);
        var delivered = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(ready, "deliver"))); Assert.Equal("delivered", delivered.Shipment.State); Assert.Equal(stockAfterMode, await Stock(s.Variant));
    }
    [Fact] public async Task ChangedReviewedUnitsRequireNewConfirmationAndRepackingRetainsBothImmutableSnapshots()
    {
        var s = await Create(mode: "imei"); using var customer = s.Customer; var original = await Read(s); var oldInput = Input(original, "pack"); var stock = await Stock(s.Variant);
        async Task ChangeWarranty(int years) => await Scope(async sp => { var db = sp.GetRequiredService<InventoryDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database); await db.SerialUnits.Where(x => x.Id == s.Unit!.Id).ExecuteUpdateAsync(x => x.SetProperty(u => u.WarrantyUntil, DateTimeOffset.UtcNow.AddYears(years))); return true; });
        await ChangeWarranty(2); using (var stale = await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), oldInput)) Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode); Assert.Equal(stock, await Stock(s.Variant));
        var fresh = await Read(s); var packInput = Input(fresh, "pack"); var packed = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), packInput)); Assert.Equal(1, packed.Shipment.PackingRevision);
        await ChangeWarranty(3); var changed = await Read(s); Assert.False(changed.CanDispatch); Assert.True(changed.CanRepack); Assert.Contains("packed_inventory_changed", changed.Blockers);
        var repack = Input(changed, "repack"); var revised = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), repack)); Assert.Equal(2, revised.Shipment.PackingRevision); Assert.Equal(packed.Shipment.Id, revised.Shipment.Id); Assert.NotEqual(packed.Shipment.Units[0].WarrantyUntil, revised.Shipment.Units[0].WarrantyUntil); Assert.Equal(stock, await Stock(s.Variant));
        var historical = await Get<ShipmentCommandResult>(fixture.Admin, Route(s.OrderId) + "/" + packInput.CommandId); Assert.Equal(JsonSerializer.Serialize(packed with { Replayed = true }), JsonSerializer.Serialize(historical));
        await Scope(async sp => { var db = sp.GetRequiredService<SalesDbContext>(); Assert.Equal(2, await db.OrderShipmentLines.CountAsync(x => x.ShipmentId == packed.Shipment.Id)); Assert.Equal(2, await db.OrderShipmentUnits.CountAsync(x => x.ShipmentId == packed.Shipment.Id)); return true; });
        Assert.True((await Read(s)).CanDispatch); await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(await Read(s), "dispatch"))); Assert.Equal(stock.Movements + 1, (await Stock(s.Variant)).Movements);
        var replay = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), repack)); Assert.Equal("packed", replay.Shipment.State); Assert.Equal(2, replay.Shipment.PackingRevision);
    }
}
