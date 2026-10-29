using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class PartialFulfillmentTests
{
    private const string Reservation="11111111111111111111111111111111",Order="22222222222222222222222222222222",Parcel="33333333333333333333333333333333",Command="44444444444444444444444444444444",Unit1="55555555555555555555555555555555",Unit2="66666666666666666666666666666666";
    private static readonly string Hash=new('A',64);
    private static PartialDispatchRequest Input(params PartialDispatchSelection[] lines)=>new("owner",Reservation,Parcel,"actor",Command,Hash,lines);
    private static PartialFulfillmentView View(PartialFulfillmentBalance[] lines,FulfillmentInventoryUnit[]? units=null)=>new(1,Reservation,Order,2,"AAAAAAAAAAE=",StockReservationState.Allocated,0,lines,units??[],Hash);
    private static FulfillmentInventoryUnit Unit(string id,string line,string sku)=>new(id,line,sku,"AAAAAAAAAAE=","assigned","SYNTHETIC-"+id,null,null,null);
    [Fact]public void SameSkuLinesKeepSeparateEntitlementsWhileOneMovementUsesTheCombinedQuantity()
    {
        var view=View([new("line-a","SKU",2,1,1,"none"),new("line-b","SKU",3,0,3,"none")]);var plan=PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("line-a",1,[]),new("line-b",1,[])));Assert.Equal(2,plan.Lines.Length);Assert.Single(plan.Movements);Assert.Equal(2,plan.Movements[0].Quantity);Assert.False(plan.CompletesReservation);Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("line-a",2,[]))));
    }
    [Fact]public void FinalDispatchRequiresEveryRemainingLineAndNeverReusesPreviouslyDispatchedQuantity()
    {
        var view=View([new("a","sku-a",5,4,1,"none"),new("b","sku-b",2,2,0,"none")]);Assert.True(PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("a",1,[]))).CompletesReservation);Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("b",1,[]))));Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view with{Lines=[new("a","sku-a",5,4,2,"none")]},Input(new PartialDispatchSelection("a",1,[]))));
    }
    [Fact]public void TrackedDevicesCannotMoveBetweenSameSkuLinesOrAppearTwiceInOneParcel()
    {
        var view=View([new("a","sku",1,0,1,"serial"),new("b","sku",1,0,1,"serial")],[Unit(Unit1,"a","sku"),Unit(Unit2,"b","sku")]);Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("a",1,[Unit2]))));Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Normalize(Input(new PartialDispatchSelection("a",1,[Unit1]),new("b",1,[Unit1]))));Assert.True(PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("a",1,[Unit1]),new("b",1,[Unit2]))).CompletesReservation);
    }
    [Fact]public void MissingTrackedAssignmentsStaleFingerprintAndCompletedReservationsFailClosed()
    {
        var view=View([new("a","sku",2,0,2,"imei")],[Unit(Unit1,"a","sku")]);Assert.Equal("serial_assignment_required",Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("a",1,[Unit1])))).Code);Assert.Equal("partial_fulfillment_version_conflict",Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("a",1,[Unit1]))with{ExpectedFingerprint=new('B',64)})).Code);Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view with{State=StockReservationState.Fulfilled},Input(new PartialDispatchSelection("a",1,[Unit1]))));
    }
    [Fact]public void TechnicalBoundsRejectRatherThanTruncateAndNormalizationFreezesCanonicalSelection()
    {
        Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Normalize(Input(Enumerable.Range(0,65).Select(i=>new PartialDispatchSelection("line"+i,1,[])).ToArray())));Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Normalize(Input(new PartialDispatchSelection("a",0,[]))));Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Normalize(Input(new PartialDispatchSelection("a",1,[]),new("A",1,[]))));Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(View([new("a","sku",1,0,1,"none")])with{DispatchCount=64},Input(new PartialDispatchSelection("a",1,[]))));var input=Input(new PartialDispatchSelection("b",1,[]),new("a",1,[]));var normalized=PartialFulfillmentRules.Normalize(input);input.Lines[0]=new("changed",2,[]);Assert.Equal(new[]{"a","b"},normalized.Lines.Select(x=>x.LineKey));Assert.Equal("OWNER",normalized.OwnerId);
    }
    [Fact]public void LastParcelSlotCannotStrandReservedItemsBeyondTheHistoryCapacity()
    {
        var view=View([new("a","sku",65,63,2,"none")])with{DispatchCount=63};Assert.Equal("partial_fulfillment_capacity_unavailable",Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("a",1,[])))).Code);Assert.True(PartialFulfillmentRules.Plan(view,Input(new PartialDispatchSelection("a",2,[]))).CompletesReservation);
    }
}
