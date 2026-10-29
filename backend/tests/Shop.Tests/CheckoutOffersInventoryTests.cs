using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CheckoutOffersInventoryTests
{
    private const string Version="AAAAAAAAAAE=";
    private static readonly string Fingerprint=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static SourcingCheckoutAllocationRequest Request(int quantity=2,string variant="sku")=>new(new(Id(),Id(),Id(),Id(),"owner",Fingerprint,At.AddHours(1),false,[new(Id(),variant,"product",quantity,Fingerprint)]),Id(),Version);
    private static SourcingStockAllocation Allocation(string variant="sku",int quantity=2,string mode="none")=>new(){Id=Id(),State="Active",IsActive=true,Lines=[new(){OfferLineId=Id(),VariantId=variant,Quantity=quantity,TrackingMode=mode}]};
    private static Dictionary<string,StockItem> Stocks(int onHand,int reserved,int sourcing,string mode="none")=>new(StringComparer.OrdinalIgnoreCase){["SKU"]=new(){VariantId="sku",OnHand=onHand,Reserved=reserved,SourcingReserved=sourcing,TrackingMode=mode}};

    [Fact]
    public void SeveralAcceptedGroupsAndOrdinaryDemandKeepIndependentSameSkuCoverage()
    {
        var a=Request(2,"sku");var b=Request(3,"SKU");
        var requests=SourcingCheckoutInventoryRules.NormalizeAllocations("owner",[b,a],false);
        var ordinary=SourcingCheckoutInventoryRules.NormalizeOrdinary([new("sKu",4)]);
        SourcingCheckoutInventoryRules.ValidateWholeCart(requests,ordinary);
        Assert.Equal(2,requests.Length);Assert.Equal(2,requests.Select(r=>r.AllocationId).Distinct().Count());
        Assert.Equal(new[]{a.Plan.AcceptanceId,b.Plan.AcceptanceId}.OrderBy(x=>x,StringComparer.Ordinal),requests.Select(r=>r.Plan.AcceptanceId));
        Assert.All(requests,r=>Assert.Equal("SKU",Assert.Single(r.Plan.Lines).VariantId));
        Assert.Equal("SKU",Assert.Single(ordinary).VariantId);
        var stocks=Stocks(10,1,5);
        SourcingCheckoutInventoryRules.ValidateHeldStock([Allocation(quantity:2),Allocation(quantity:3)],stocks);
        Assert.Equal(4,StockAvailability.Available(10,1,5));
    }

    [Fact]
    public void AcceptedOnlyWithNoPublicAvailabilityIsBackedByItsOwnSourcingCounter()
    {
        var stock=Stocks(5,0,5);
        SourcingCheckoutInventoryRules.ValidateHeldStock([Allocation(quantity:2),Allocation(quantity:3)],stock);
        Assert.Equal(0,StockAvailability.Available(5,0,5));
        Assert.Equal(5,stock["SKU"].SourcingReserved);Assert.Equal(0,stock["SKU"].Reserved);
    }

    [Theory]
    [InlineData(4,"none")]
    [InlineData(5,"serial")]
    public void CoverageCannotBorrowOrdinaryStockOrIgnoreChangedTracking(int sourcing,string mode)
    {
        var error=Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.ValidateHeldStock([Allocation(quantity:2),Allocation(quantity:3)],Stocks(100,0,sourcing,mode)));
        Assert.Equal("sourcing_allocation_checkout_conflict",error.Code);
    }

    [Fact]
    public void EveryAcceptedSkuNeedsExistingStockEvenWhenAnotherSkuHasSurplus()
    {
        var error=Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.ValidateHeldStock([Allocation("missing",2)],Stocks(100,0,50)));
        Assert.Equal("sourcing_allocation_checkout_conflict",error.Code);
    }

    [Fact]
    public void DuplicateAcceptanceOrAllocationCannotDoubleCountOneOwnedHold()
    {
        var request=Request();var next=Request();
        foreach(var pair in new[]{new[]{request,request},new[]{request,next with{AllocationId=request.AllocationId}},new[]{request,next with{Plan=next.Plan with{AcceptanceId=request.Plan.AcceptanceId}}}})
            Assert.Equal("invalid_sourcing_checkout_inventory",Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.NormalizeAllocations("owner",pair,false)).Code);
    }

    [Fact]
    public void ForeignOwnerAndHiddenDemoPlansRemainIndistinguishableFromMissing()
    {
        var request=Request();
        Assert.Equal("not_found",Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.NormalizeAllocations("other-owner",[request],true)).Code);
        var demo=request with{Plan=request.Plan with{ContainsDemo=true}};
        Assert.Equal("not_found",Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.NormalizeAllocations("owner",[demo],false)).Code);
        Assert.True(Assert.Single(SourcingCheckoutInventoryRules.NormalizeAllocations("owner",[demo],true)).Plan.ContainsDemo);
    }

    [Fact]
    public void WholeCartHasOneCombinedSkuQuantityBudgetAcrossAllPurchaseLanes()
    {
        var requests=SourcingCheckoutInventoryRules.NormalizeAllocations("owner",[Request(500000),Request(499999)],false);
        SourcingCheckoutInventoryRules.ValidateWholeCart(requests,SourcingCheckoutInventoryRules.NormalizeOrdinary([new("SKU",1)]));
        Assert.Equal("invalid_sourcing_checkout_inventory",Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.ValidateWholeCart(requests,SourcingCheckoutInventoryRules.NormalizeOrdinary([new("SKU",2)]))).Code);
    }

    [Fact]
    public void CompleteAcceptedLinesShareTheSameWholeCartLineBudgetAsOrdinary()
    {
        var request=Request();request=request with{Plan=request.Plan with{Lines=Enumerable.Range(0,64).Select(i=>new SourcingStockAllocationPlanLine(Id(),"sku_"+i,"product",1,Fingerprint)).ToArray()}};
        var requests=SourcingCheckoutInventoryRules.NormalizeAllocations("owner",[request],false);
        SourcingCheckoutInventoryRules.ValidateWholeCart(requests,[]);
        Assert.Equal("invalid_sourcing_checkout_inventory",Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.ValidateWholeCart(requests,[new("extra",1)])).Code);
    }

    [Fact]
    public void OrdinaryInputCannotRepeatCaseVariantsOrUseUnboundedQuantities()
    {
        foreach(var invalid in new[]{new[]{new SourcingCheckoutOrdinaryLine("sku",1),new("SKU",1)},new[]{new SourcingCheckoutOrdinaryLine("sku",0)},new[]{new SourcingCheckoutOrdinaryLine("sku",1000001)}})
            Assert.Equal("invalid_sourcing_checkout_inventory",Assert.Throws<BusinessException>(()=>SourcingCheckoutInventoryRules.NormalizeOrdinary(invalid)).Code);
    }

    [Fact]
    public void CheckoutProofExposesNoMoneyDeviceOrOwnerAuthority()
    {
        var request=Request();var plan=request.Plan;
        var proof=new SourcingCheckoutInventoryProof([new(request.AllocationId,plan.RequestId,plan.TaskId,plan.OfferId,plan.AcceptanceId,plan.TermsHash,Version,At,plan.ContainsDemo,plan.Lines.Select(l=>new SourcingAllocationSummaryLine(l.OfferLineId,l.VariantId,l.Quantity)).ToArray())],new Dictionary<string,int>{{"SKU",0}});
        var json=JsonSerializer.Serialize(proof,new JsonSerializerOptions(JsonSerializerDefaults.Web));
        foreach(var field in new[]{"ownerId","unitId","unitIds","serial","imei1","unitPriceRial","totalRial","internalNote"})Assert.DoesNotContain("\""+field+"\":",json,StringComparison.OrdinalIgnoreCase);
        Assert.Contains("\"ordinaryAvailable\":{\"SKU\":0}",json);
    }

    [Fact]
    public async Task AssertionRequiresParentSerializableBeforeOpeningDatabaseOrTrackingAnything()
    {
        using var db=new InventoryDbContext(new DbContextOptionsBuilder<InventoryDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedCheckoutOffers;Integrated Security=true;TrustServerCertificate=true").Options);
        var guard=new CheckoutOffersGuard(db,new(db,TimeProvider.System),TimeProvider.System,false);
        Assert.Contains("root Serializable",(await Assert.ThrowsAsync<InvalidOperationException>(()=>guard.AssertAsync("owner",[Request()],[new("ordinary",1)],default))).Message);
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);Assert.Empty(db.ChangeTracker.Entries());
    }
}
