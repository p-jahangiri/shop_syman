using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderV2HttpSqlTests
{
    [Fact]public async Task PartialParcelsKeepSeparateSameSkuSnapshot2RightsAndOriginalAcceptedPrices()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(3,true,false);var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);var order=(await Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Created))["order"]!;var id=Text(order["summary"]!,"id");var originalLines=order["lines"]!.ToJsonString();
        await Scope(async sp=>await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.Orders.SingleAsync(x=>x.Id==id);Assert.Equal(StockReservationState.Allocated,(await sp.GetRequiredService<IStockOrderReservationsV2>().AllocateAsync(s.Owner,row.ReservationId,"synthetic-parcel-v2",default)).State);row.State=OrderState.Paid;row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();return true;},inventoryOnly:true));
        using var admin=await ShipmentAdministrator();var path=$"/api/admin/orders/{s.Owner}/{id}/fulfillment";
        async Task<ParcelPage> Page()=> (await admin.GetFromJsonAsync<ParcelPage>(path))!;
        async Task<ParcelCommandResult> Write(ParcelPage p,string action,ParcelSummary? previous=null,PartialDispatchSelection[]? selected=null){var input=new ParcelCommandInput(s.Owner,Id(),action,p.OrderVersion,previous?.Id,previous?.Version,p.InventoryFingerprint,"Synthetic same-SKU rights review",true,action=="pack"?"SYNTHETIC-V2":null,selected??[],action=="dispatch"?"حمل ساختگی":null,action=="dispatch"?"Synthetic carrier":null,null,action is"dispatch"or"deliver"?DateTimeOffset.UtcNow:null);using var response=await admin.PostAsJsonAsync(path+"/commands/"+input.CommandId,input);Assert.Equal(HttpStatusCode.OK,response.StatusCode);return(await response.Content.ReadFromJsonAsync<ParcelCommandResult>())!;}
        var page=await Page();Assert.Equal(2,page.Lines.Length);Assert.Single(page.Lines.Select(x=>x.VariantId).Distinct());var first=page.Lines.Single(x=>x.Ordered==2);var a=await Write(page,"pack",selected:[new(first.LineKey,1,[])]);page=await Page();await Write(page,"dispatch",page.Parcels.Single());page=await Page();var b=await Write(page,"pack",selected:page.Lines.Where(x=>x.Remaining>0).Select(x=>new PartialDispatchSelection(x.LineKey,x.Remaining,[])).ToArray());Assert.Equal(2,b.Detail.Lines.Length);page=await Page();await Write(page,"dispatch",page.Parcels.Single(x=>x.Id==b.Detail.Parcel.Id));page=await Page();await Write(page,"deliver",page.Parcels.Single(x=>x.Id==a.Detail.Parcel.Id));Assert.Equal("Paid",(await Page()).OrderState);page=await Page();await Write(page,"deliver",page.Parcels.Single(x=>x.Id==b.Detail.Parcel.Id));Assert.Equal("Fulfilled",(await Page()).OrderState);
        var history=await Body(await customer.GetAsync("/api/orders/v2/"+id));Assert.Equal(originalLines,history["lines"]!.ToJsonString());await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();var stock=await db.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal((0,0,0),(stock.OnHand,stock.Reserved,stock.SourcingReserved));var last=await db.PartialDispatches.AsNoTracking().SingleAsync(x=>x.OrderId==id&&x.Sequence==2);var lines=await db.PartialDispatchLines.Where(x=>x.DispatchId==last.Id).ToArrayAsync();Assert.Equal(2,lines.Length);Assert.Single(lines.Select(x=>x.MovementId).Distinct());Assert.Equal("Transferred",(await db.SourcingAllocations.AsNoTracking().SingleAsync(x=>x.AcceptanceId==s.Acceptance)).State);return true;});
    }
}
