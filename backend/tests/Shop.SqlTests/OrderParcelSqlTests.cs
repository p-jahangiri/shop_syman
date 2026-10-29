using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests:IDisposable
{
    private WebApplicationFactory<Program>? parcelFactory;
    private HttpClient? parcelClient;
    private HttpClient ParcelStaff {
        get {if(parcelClient is not null)return parcelClient;parcelFactory=fixture.Sql.Factory.WithWebHostBuilder(_=>{});parcelClient=parcelFactory.CreateClient(new(){HandleCookies=false});foreach(var h in fixture.Admin.DefaultRequestHeaders)parcelClient.DefaultRequestHeaders.TryAddWithoutValidation(h.Key,h.Value);return parcelClient;}
    }
    public void Dispose(){parcelClient?.Dispose();parcelFactory?.Dispose();}
    private Task<T> ParcelSeedRead<T>(Func<OrderParcelService,Task<T>> read)=>Scope(sp=>sp.GetRequiredService<OrderParcelCoordinator>().ReadAsync(read,default));
    private Task<ParcelCommandResult> ParcelSeedWrite(Scenario s,ParcelCommandInput input)=>Scope(sp=>sp.GetRequiredService<OrderParcelCoordinator>().WriteAsync(new JwtSecurityTokenHandler().ReadJwtToken(fixture.Admin.DefaultRequestHeaders.Authorization!.Parameter).Subject,s.Owner,s.OrderId,input.CommandId,input,ParcelBase(s)+"/commands/"+input.CommandId,"synthetic-parcel-history-fixture",default));
    private static string ParcelBase(Scenario s)=>$"/api/admin/orders/{s.Owner}/{s.OrderId}/fulfillment";
    private Task<ParcelPage> Parcels(Scenario s)=>Get<ParcelPage>(ParcelStaff,ParcelBase(s));
    private static ParcelCommandInput ParcelInput(ParcelPage p,string action,ParcelSummary? parcel=null,params PartialDispatchSelection[] lines)=>new(p.OwnerId,Id(),action,p.OrderVersion,parcel?.Id,parcel?.Version,p.InventoryFingerprint,"Synthetic parcel QA; no real goods",true,action=="pack"?"SYNTHETIC-PARCEL":null,lines,action=="dispatch"?"حمل آزمایشی":null,action=="dispatch"?"Synthetic carrier":null,action=="dispatch"?"SYNTHETIC-TRACKING":null,action is"dispatch"or"deliver"?DateTimeOffset.UtcNow:null);
    private async Task<ParcelCommandResult> ParcelWrite(Scenario s,ParcelCommandInput input)=>await Body<ParcelCommandResult>(await ParcelStaff.PostAsJsonAsync(ParcelBase(s)+"/commands/"+input.CommandId,input));
    [Fact]public async Task TwoParcelsDispatchOnceAndOrderCompletesOnlyAfterBothDeliveries()
    {
        var s=await Create(quantity:2);using var customer=s.Customer;var before=await Stock(s.Variant);var page=await Parcels(s);var key=page.Lines.Single().LineKey;var a=await ParcelWrite(s,ParcelInput(page,"pack",null,new PartialDispatchSelection(key,1,[])));Assert.Equal(before,await Stock(s.Variant));
        page=await Parcels(s);var b=await ParcelWrite(s,ParcelInput(page,"pack",null,new PartialDispatchSelection(key,1,[])));Assert.Equal(before,await Stock(s.Variant));Assert.Equal(2,(await Parcels(s)).Lines.Single().Packed);
        using(var old=await fixture.Admin.GetAsync($"/api/admin/orders/{s.Owner}/{s.OrderId}/shipment"))Assert.Equal(HttpStatusCode.Conflict,old.StatusCode);
        page=await Parcels(s);var dispatch=ParcelInput(page,"dispatch",page.Parcels.Single(x=>x.Id==a.Detail.Parcel.Id));var race=await Task.WhenAll(ParcelWrite(s,dispatch),ParcelWrite(s,dispatch));Assert.Single(race,x=>x.Replayed);Assert.Single(race,x=>!x.Replayed);Assert.Equal(before.OnHand-1,(await Stock(s.Variant)).OnHand);
        page=await Parcels(s);var stale=ParcelInput(page,"dispatch",page.Parcels.Single(x=>x.Id==b.Detail.Parcel.Id));using(var denied=await ParcelStaff.PostAsJsonAsync(ParcelBase(s)+"/commands/"+stale.CommandId,stale))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        await ParcelWrite(s,ParcelInput(page,"repack",page.Parcels.Single(x=>x.Id==b.Detail.Parcel.Id),new PartialDispatchSelection(key,1,[])));
        page=await Parcels(s);await ParcelWrite(s,ParcelInput(page,"deliver",page.Parcels.Single(x=>x.Id==a.Detail.Parcel.Id)));Assert.Equal("Paid",(await Parcels(s)).OrderState);
        page=await Parcels(s);await ParcelWrite(s,ParcelInput(page,"dispatch",page.Parcels.Single(x=>x.Id==b.Detail.Parcel.Id)));Assert.Equal("Paid",(await Parcels(s)).OrderState);Assert.Equal(0,(await Stock(s.Variant)).Reserved);
        page=await Parcels(s);await ParcelWrite(s,ParcelInput(page,"deliver",page.Parcels.Single(x=>x.Id==b.Detail.Parcel.Id)));page=await Parcels(s);Assert.Equal("Fulfilled",page.OrderState);Assert.Equal(2,page.Lines.Single().Delivered);Assert.Equal(before.Movements+2,(await Stock(s.Variant)).Movements);
        var historical=await Get<ParcelCommandResult>(ParcelStaff,ParcelBase(s)+"/commands/"+a.CommandId);Assert.Equal("packed",historical.Detail.Parcel.State);Assert.Equal(JsonSerializer.Serialize(a with{Replayed=true}),JsonSerializer.Serialize(historical));Assert.True((await ParcelWrite(s,dispatch)).Replayed);
        var own=await Get<CustomerFulfillmentData>(customer,"/api/orders/v2/"+s.OrderId+"/fulfillment");Assert.Equal("parcels",own.Mode);Assert.Equal(2,own.Parcels.Length);Assert.True(own.ManualCarrierReport);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.Single(await db.Orders.Where(x=>x.Id==s.OrderId&&x.State==OrderState.Fulfilled).ToArrayAsync());Assert.Equal(1,await sp.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.Resource==ParcelBase(s)+"/commands/"+dispatch.CommandId));return true;});
    }
    [Theory][InlineData("serial")][InlineData("imei")]
    public async Task TrackedParcelSelectionIsExclusiveAndCustomerDevicesAppearOnlyAfterHandoff(string mode)
    {
        var s=await Create(mode:mode,quantity:2);using var customer=s.Customer;var page=await Parcels(s);var key=page.Lines.Single().LineKey;var device=page.AvailableUnits[0];var first=await ParcelWrite(s,ParcelInput(page,"pack",null,new PartialDispatchSelection(key,1,[device.Id])));
        var hidden=await Get<ParcelDetail>(customer,$"/api/orders/{s.OrderId}/fulfillment/parcels/{first.Detail.Parcel.Id}");Assert.False(hidden.UnitDetailsVisible);Assert.Empty(hidden.Units);
        page=await Parcels(s);Assert.DoesNotContain(page.AvailableUnits,u=>u.Id==device.Id);var duplicate=ParcelInput(page,"pack",null,new PartialDispatchSelection(key,1,[device.Id]));using(var denied=await ParcelStaff.PostAsJsonAsync(ParcelBase(s)+"/commands/"+duplicate.CommandId,duplicate))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        var sent=await ParcelWrite(s,ParcelInput(page,"dispatch",page.Parcels.Single()));var visible=await Get<ParcelDetail>(customer,$"/api/orders/v2/{s.OrderId}/fulfillment/parcels/{first.Detail.Parcel.Id}");Assert.True(visible.UnitDetailsVisible);Assert.Equal(device.Id,Assert.Single(visible.Units).UnitId);Assert.Equal(device.WarrantyUntil,visible.Units[0].WarrantyUntil);
        page=await Parcels(s);Assert.Single(page.AvailableUnits);var next=await ParcelWrite(s,ParcelInput(page,"pack",null,new PartialDispatchSelection(key,1,[page.AvailableUnits[0].Id])));var voided=await ParcelWrite(s,ParcelInput(await Parcels(s),"void",next.Detail.Parcel));Assert.Equal("void",voided.Detail.Parcel.State);Assert.Single((await Parcels(s)).AvailableUnits);
    }
    [Fact]public async Task FullAndParcelPackingRaceChoosesExactlyOneWorkflow()
    {
        var s=await Create(quantity:2);using var customer=s.Customer;var old=Input(await Read(s),"pack");var page=await Parcels(s);var input=ParcelInput(page,"pack",null,new PartialDispatchSelection(page.Lines[0].LineKey,1,[]));var before=await Stock(s.Variant);
        var race=await Task.WhenAll(fixture.Admin.PostAsJsonAsync(Route(s.OrderId),old),ParcelStaff.PostAsJsonAsync(ParcelBase(s)+"/commands/"+input.CommandId,input));try{Assert.Single(race,x=>x.IsSuccessStatusCode);Assert.Single(race,x=>x.StatusCode==HttpStatusCode.Conflict);}finally{foreach(var r in race)r.Dispose();}Assert.Equal(before,await Stock(s.Variant));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.Equal(1,await db.OrderShipments.CountAsync(x=>x.OrderId==s.OrderId)+await db.FulfillmentHeaders.CountAsync(x=>x.OrderId==s.OrderId));return true;});
    }
    [Theory][InlineData("audit")][InlineData("receipt")][InlineData("header")]
    public async Task PartialDispatchFailureRollsBackFirstHandoffLedgerStockClaimsAndReceipt(string failure)
    {
        var s=await Create(quantity:2);using var customer=s.Customer;var page=await Parcels(s);await ParcelWrite(s,ParcelInput(page,"pack",null,new PartialDispatchSelection(page.Lines[0].LineKey,1,[])));page=await Parcels(s);var before=await Stock(s.Variant);var input=ParcelInput(page,"dispatch",page.Parcels.Single());
        var sql=failure=="audit"?"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_ParcelQaFailure] CHECK ([Action]<>'ORDER_PARCEL_DISPATCH')":failure=="receipt"?"ALTER TABLE [sales].[ParcelCommands] WITH NOCHECK ADD CONSTRAINT [CK_ParcelQaFailure] CHECK ([Action]<>'dispatch')":"ALTER TABLE [sales].[FulfillmentHeaders] WITH NOCHECK ADD CONSTRAINT [CK_ParcelQaFailure] CHECK ([FirstDispatchRecordedAt] IS NULL)";
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync(sql);return true;});try{using var denied=await ParcelStaff.PostAsJsonAsync(ParcelBase(s)+"/commands/"+input.CommandId,input);Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);}finally{await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync(failure=="audit"?"ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_ParcelQaFailure]":failure=="receipt"?"ALTER TABLE [sales].[ParcelCommands] DROP CONSTRAINT [CK_ParcelQaFailure]":"ALTER TABLE [sales].[FulfillmentHeaders] DROP CONSTRAINT [CK_ParcelQaFailure]");return true;});}
        Assert.Equal(before,await Stock(s.Variant));Assert.Equal(JsonSerializer.Serialize(page),JsonSerializer.Serialize(await Parcels(s)));await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.Null((await db.FulfillmentHeaders.AsNoTracking().SingleAsync(x=>x.OrderId==s.OrderId)).FirstDispatchRecordedAt);Assert.False(await sp.GetRequiredService<InventoryDbContext>().PartialDispatches.AnyAsync(x=>x.OrderId==s.OrderId));return true;});Assert.False((await ParcelWrite(s,input)).Replayed);
    }
    [Fact]public async Task VoidHistoryIsPagedReceiptsStayImmutableAndDownCannotDropNonemptyParcels()
    {
        var s=await Create(quantity:2);using var customer=s.Customer;var before=await Stock(s.Variant);var ids=new List<string>();for(var i=0;i<21;i++){var p=await ParcelSeedRead(service=>service.ReadAdminAsync(s.Owner,s.OrderId,null,default));var packed=await ParcelSeedWrite(s,ParcelInput(p,"pack",null,new PartialDispatchSelection(p.Lines[0].LineKey,1,[])));ids.Add(packed.Detail.Parcel.Id);var current=await ParcelSeedRead(service=>service.ReadAdminAsync(s.Owner,s.OrderId,null,default));await ParcelSeedWrite(s,ParcelInput(current,"void",packed.Detail.Parcel));}Assert.Equal(before,await Stock(s.Variant));var page=await Parcels(s);Assert.Equal(20,page.Parcels.Length);Assert.Equal("20",page.NextAfter);var next=await Get<ParcelPage>(ParcelStaff,ParcelBase(s)+"?after="+page.NextAfter);Assert.Single(next.Parcels);Assert.Null(next.NextAfter);Assert.Equal(ids[^1],next.Parcels[0].Id);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.False(db.Database.HasPendingModelChanges());var line=await db.ParcelLines.FirstAsync(x=>ids.Contains(x.ParcelId));line.Quantity=2;await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());return true;});
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var migrations=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var parcelMigration=Array.FindIndex(migrations,x=>x.EndsWith("_OrderParcels",StringComparison.Ordinal));Assert.True(parcelMigration>0);var migrator=db.GetService<IMigrator>();
            // EF commits each later empty migration independently. Exercise this
            // guard at its own boundary and restore the full shared fixture.
            try{await migrator.MigrateAsync(migrations[parcelMigration]);var ownBoundary=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var error=await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>migrator.MigrateAsync(migrations[parcelMigration-1]));Assert.Equal(51000,error.Number);Assert.Equal(ownBoundary,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(21,await db.Parcels.CountAsync(x=>x.OrderId==s.OrderId));}
            finally{await db.Database.MigrateAsync();}
            Assert.Equal(migrations,await db.Database.GetAppliedMigrationsAsync());return true;});
    }
}
