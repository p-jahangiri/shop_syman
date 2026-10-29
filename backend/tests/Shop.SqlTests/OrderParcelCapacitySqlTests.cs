using System.Net;
using System.Net.Http.Json;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests
{
    [Fact]public async Task SixtyFourthActualParcelCanBeExplicitlyRepackedToCloseAllRemainingGoodsWithoutUnknownOutcome()
    {
        var s=await Create(quantity:65);using var customer=s.Customer;var ids=new List<string>();
        // Bulk history is a synthetic prerequisite through the same root
        // transaction/service, without relaxing the real HTTP rate limiter.
        for(var n=0;n<64;n++){var page=await ParcelSeedRead(service=>service.ReadAdminAsync(s.Owner,s.OrderId,null,default));var packed=await ParcelSeedWrite(s,ParcelInput(page,"pack",null,new PartialDispatchSelection(page.Lines[0].LineKey,1,[])));ids.Add(packed.Detail.Parcel.Id);}
        for(var n=0;n<63;n++){
            var page=await ParcelSeedRead(service=>service.ReadAdminAsync(s.Owner,s.OrderId,null,default));var detail=await ParcelSeedRead(service=>service.ReadDetailAsync(s.Owner,s.OrderId,ids[n],false,default));
            if(n>0){var repacked=await ParcelSeedWrite(s,ParcelInput(page,"repack",detail.Parcel,new PartialDispatchSelection(page.Lines[0].LineKey,1,[])));detail=repacked.Detail;page=await ParcelSeedRead(service=>service.ReadAdminAsync(s.Owner,s.OrderId,null,default));}
            await ParcelSeedWrite(s,ParcelInput(page,"dispatch",detail.Parcel));
        }
        var current=await Parcels(s);Assert.Equal(63,current.DispatchCount);Assert.Equal(64,current.ActiveParcelCount);Assert.Equal(2,current.Lines[0].Remaining);Assert.False(current.CanPack);var last=await ParcelSeedRead(service=>service.ReadDetailAsync(s.Owner,s.OrderId,ids[^1],false,default));
        var incomplete=ParcelInput(current,"repack",last.Parcel,new PartialDispatchSelection(current.Lines[0].LineKey,1,[]));using(var denied=await ParcelStaff.PostAsJsonAsync(ParcelBase(s)+"/commands/"+incomplete.CommandId,incomplete)){Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);Assert.Contains("parcel_capacity_conflict",await denied.Content.ReadAsStringAsync());}
        using(var noReceipt=await ParcelStaff.GetAsync(ParcelBase(s)+"/commands/"+incomplete.CommandId))Assert.Equal(HttpStatusCode.NotFound,noReceipt.StatusCode);
        Assert.Equal(2,(await Stock(s.Variant)).Reserved);var repack=await ParcelWrite(s,ParcelInput(current,"repack",last.Parcel,new PartialDispatchSelection(current.Lines[0].LineKey,2,[])));current=await Parcels(s);await ParcelWrite(s,ParcelInput(current,"dispatch",repack.Detail.Parcel));current=await Parcels(s);Assert.Equal(64,current.DispatchCount);Assert.Equal(0,current.Lines[0].Remaining);Assert.Equal(0,(await Stock(s.Variant)).OnHand);Assert.Equal(0,(await Stock(s.Variant)).Reserved);Assert.Equal("Paid",current.OrderState);
    }
}
