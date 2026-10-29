using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests
{
    [Fact] public async Task ConcurrentDispatchCommandsHaveOneLedgerEffectAndSameCommandReplayIsHistorical()
    {
        var s = await Create(); using var customer = s.Customer; await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(await Read(s), "pack"))); var packed = await Read(s); var before = await Stock(s.Variant); var input = Input(packed, "dispatch");
        var responses = await Task.WhenAll(fixture.Admin.PostAsJsonAsync(Route(s.OrderId), input), fixture.Admin.PostAsJsonAsync(Route(s.OrderId), input));
        var results = new List<ShipmentCommandResult>(); foreach (var response in responses) results.Add(await Body<ShipmentCommandResult>(response)); Assert.Single(results, x => !x.Replayed); Assert.Single(results, x => x.Replayed); Assert.Equal(before.Movements + 1, (await Stock(s.Variant)).Movements);
        var second = await Create(); using var other = second.Customer; await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(second.OrderId), Input(await Read(second), "pack"))); var state = await Read(second); var a = Input(state, "dispatch"); var beforeSecond = await Stock(second.Variant);
        var race = await Task.WhenAll(fixture.Admin.PostAsJsonAsync(Route(second.OrderId), a), fixture.Admin.PostAsJsonAsync(Route(second.OrderId), a with { CommandId = Id() }));
        try { Assert.Single(race, x => x.StatusCode == HttpStatusCode.OK); Assert.Single(race, x => x.StatusCode == HttpStatusCode.Conflict); } finally { foreach (var response in race) response.Dispose(); }
        Assert.Equal(beforeSecond.Movements + 1, (await Stock(second.Variant)).Movements);
    }
    [Theory][InlineData("audit")][InlineData("receipt")][InlineData("shipment")]
    public async Task FailureAfterWarehouseLedgerRollsEverythingBackAndSameBodyRetries(string failure)
    {
        var s = await Create(); using var customer = s.Customer; await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), Input(await Read(s), "pack"))); var packed = await Read(s); var before = await Stock(s.Variant); var input = Input(packed, "dispatch");
        await Scope(async sp => {
            var sales = sp.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", sales.Database.GetDbConnection().Database);
            if (failure == "audit") await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_ShipmentAuditFailure] CHECK (1=0)");
            else if (failure == "receipt") await sales.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[OrderShipmentCommands] WITH NOCHECK ADD CONSTRAINT [CK_ShipmentReceiptFailure] CHECK ([Action]<>'dispatch')");
            else await sales.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[OrderShipments] WITH NOCHECK ADD CONSTRAINT [CK_ShipmentHeaderFailure] CHECK ([State]='packed')");
            return true;
        });
        try { using var failed = await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), input); Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode); }
        finally {
            await Scope(async sp => { var sales = sp.GetRequiredService<SalesDbContext>(); if (failure == "audit") await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_ShipmentAuditFailure]"); else if (failure == "receipt") await sales.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[OrderShipmentCommands] DROP CONSTRAINT [CK_ShipmentReceiptFailure]"); else await sales.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[OrderShipments] DROP CONSTRAINT [CK_ShipmentHeaderFailure]"); return true; });
        }
        Assert.Equal(before, await Stock(s.Variant)); Assert.Equal(JsonSerializer.Serialize(packed), JsonSerializer.Serialize(await Read(s)));
        await Scope(async sp => { Assert.False(await sp.GetRequiredService<SalesDbContext>().OrderShipmentCommands.AnyAsync(x => x.CommandId == input.CommandId)); return true; });
        var retry = await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), input)); Assert.False(retry.Replayed); Assert.Equal(before.Movements + 1, (await Stock(s.Variant)).Movements);
    }
    [Fact] public async Task ReceiptHashCorruptionFailsClosedAndPackingHistoryCannotBeEditedThroughEf()
    {
        var s = await Create(); using var customer = s.Customer; var input = Input(await Read(s), "pack"); await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), input));
        await Scope(async sp => { var db = sp.GetRequiredService<SalesDbContext>(); var line = await db.OrderShipmentLines.SingleAsync(x => x.ShipmentId == db.OrderShipments.Where(h => h.OrderId == s.OrderId).Select(h => h.Id).Single()); line.Name = "Tampered"; await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync()); return true; });
        await Scope(async sp => { var db = sp.GetRequiredService<SalesDbContext>(); var receipt = await db.OrderShipmentCommands.SingleAsync(x => x.CommandId == input.CommandId); receipt.ResponseJson = "{}"; Assert.Throws<InvalidOperationException>(() => db.SaveChanges(false)); return true; });
        await Scope(async sp => { var db = sp.GetRequiredService<SalesDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database); await db.OrderShipmentCommands.Where(x => x.CommandId == input.CommandId).ExecuteUpdateAsync(x => x.SetProperty(c => c.ResponseJson, "{}")); return true; });
        using var bad = await fixture.Admin.GetAsync(Route(s.OrderId) + "/" + input.CommandId); Assert.Equal(HttpStatusCode.ServiceUnavailable, bad.StatusCode); var before = await Stock(s.Variant);
        using var replay = await fixture.Admin.PostAsJsonAsync(Route(s.OrderId), input); Assert.Equal(HttpStatusCode.ServiceUnavailable, replay.StatusCode); Assert.Equal(before, await Stock(s.Variant));
    }
}
