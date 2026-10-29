using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingAllocationTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private const string V="AAAAAAAAAAA=";
    private static readonly string Hash=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static SourcingStockAllocationPlan Plan()=>new(Id(),Id(),Id(),Id(),"owner",Hash,At.AddHours(2),false,[new(Id(),"sku","catalog-product_1",2,Hash)]);
    private static SourcingAllocationInput Input(SourcingStockAllocationPlan plan)=>new(Id(),V,V,V,plan.AcceptanceId,plan.TermsHash,At.AddHours(1),"Physical units held for the accepted plan",plan.Lines.Select(l=>new SourcingAllocationLineInput(l.OfferLineId,V,"none",[])).ToArray());

    [Fact] public void PlansAndPicksNormalizeInStableOrderWithoutInventedPriceQuantityOrUnitSelection()
    {
        var plan=Plan();var second=plan.Lines[0] with{OfferLineId=Id(),VariantId="other"};plan=plan with{Lines=[plan.Lines[0],second]};var one=SourcingAllocationRules.Normalize(Input(plan));var two=SourcingAllocationRules.Normalize(Input(plan) with{RequestId=one.RequestId,Lines=one.Lines.Reverse().ToArray()});Assert.Equal(SourcingAllocationRules.Hash(one),SourcingAllocationRules.Hash(two));var normalized=SourcingAllocationRules.NormalizePlan(plan);Assert.All(normalized.Lines,l=>Assert.Equal(l.VariantId.ToUpperInvariant(),l.VariantId));Assert.Equal("catalog-product_1",normalized.Lines[0].ProductId);Assert.Equal("OWNER",normalized.OwnerId);SourcingAllocationRules.ValidateCoverage(normalized,one);
    }
    [Fact] public void DuplicatePhysicalUnitsCannotCoverTwoAcceptedLines()
    {
        var plan=Plan();var line=new SourcingAllocationLineInput(plan.Lines[0].OfferLineId,V,"serial",[new(Id(),V),new(Id(),V)]);var input=Input(plan) with{Lines=[line]};Assert.Equal(2,Assert.Single(SourcingAllocationRules.Normalize(input).Lines).Units.Length);Assert.Throws<BusinessException>(()=>SourcingAllocationRules.Normalize(input with{Lines=[line with{Units=[line.Units[0],line.Units[0]]}]}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.Normalize(input with{Lines=[line,line with{OfferLineId=Id()}]}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.Normalize(Input(plan) with{Lines=[Input(plan).Lines[0],Input(plan).Lines[0]]}));
    }
    [Fact] public void TrackedBatchLimitIsOneAtomicSelectionAndNeverSilentlySplit()
    {
        var plan=Plan();var line=Input(plan).Lines[0] with{TrackingMode="serial",Units=Enumerable.Range(0,100).Select(_=>new SourcingAllocationUnitInput(Id(),V)).ToArray()};Assert.Equal(100,SourcingAllocationRules.Normalize(Input(plan) with{Lines=[line]}).Lines[0].Units.Length);Assert.Throws<BusinessException>(()=>SourcingAllocationRules.Normalize(Input(plan) with{Lines=[line with{Units=[..line.Units,new(Id(),V)]}]}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.Normalize(Input(plan) with{Lines=[line,line with{OfferLineId=Id(),Units=[new(Id(),V)]}]}));
    }
    [Fact] public void BrowserSelectionMustExactlyCoverTheServerAcceptedPlan()
    {
        var plan=SourcingAllocationRules.NormalizePlan(Plan());var input=SourcingAllocationRules.Normalize(Input(plan));SourcingAllocationRules.ValidateCoverage(plan,input);Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateCoverage(plan,input with{AcceptanceId=Id()}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateCoverage(plan,input with{TermsHash=new string('B',64)}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateCoverage(plan,input with{Lines=[input.Lines[0] with{OfferLineId=Id()}]}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateCoverage(plan,input with{Lines=[input.Lines[0] with{TrackingMode="imei",Units=[new(Id(),V)]}]}));
    }
    [Fact] public void SharedSkuQuantitiesAndStockVersionsAreValidatedAsOnePhysicalCapacity()
    {
        var plan=Plan();plan=plan with{Lines=[plan.Lines[0] with{Quantity=500000},plan.Lines[0] with{OfferLineId=Id(),VariantId="SKU",Quantity=500000}]};var normalized=SourcingAllocationRules.NormalizePlan(plan);var input=SourcingAllocationRules.Normalize(Input(normalized));SourcingAllocationRules.ValidateCoverage(normalized,input);Assert.Throws<BusinessException>(()=>SourcingAllocationRules.NormalizePlan(plan with{Lines=[plan.Lines[0],plan.Lines[1] with{Quantity=500001}]}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateCoverage(normalized,input with{Lines=[input.Lines[0],input.Lines[1] with{StockVersion="AQAAAAAAAAA="}]}));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateCoverage(normalized,input with{Lines=[input.Lines[0],input.Lines[1] with{TrackingMode="serial"}]}));
    }
    [Theory][InlineData(0)][InlineData(-1)][InlineData(1000001)]
    public void TrustedQuantitiesRemainPositiveBounded(int quantity){var plan=Plan();Assert.Throws<BusinessException>(()=>SourcingAllocationRules.NormalizePlan(plan with{Lines=[plan.Lines[0] with{Quantity=quantity}]}));}
    [Fact] public void ExplicitAbsoluteDeadlineCannotPassNowOrAcceptedCeilingOrChangeTimezone()
    {
        SourcingAllocationRules.ValidateDeadline(At.AddTicks(1),At.AddHours(1),At);SourcingAllocationRules.ValidateDeadline(At.AddHours(1),At.AddHours(1),At);Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateDeadline(At,At.AddHours(1),At));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateDeadline(At.AddHours(1).AddTicks(1),At.AddHours(1),At));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.ValidateDeadline(At.AddMinutes(1).ToOffset(TimeSpan.FromHours(1)),At.AddHours(1),At));Assert.Equal("Expired",SourcingAllocationRules.EffectiveState("Active",At,At));Assert.Equal("Active",SourcingAllocationRules.EffectiveState("Active",At.AddTicks(1),At));Assert.Equal("Transferred",SourcingAllocationRules.EffectiveState("Transferred",At,At.AddDays(1)));
    }
    [Fact] public void ModeVersionsCompleteLinesAndPrivateReasonAreExplicit()
    {
        var plan=Plan();var input=Input(plan);foreach(var invalid in new[]{input with{Lines=[]},input with{Lines=[input.Lines[0] with{TrackingMode="guess"}]},input with{Lines=[input.Lines[0] with{Units=[new(Id(),V)]}]},input with{Lines=[input.Lines[0] with{StockVersion=""}]},input with{Reason=""},input with{TermsHash=new string('a',64)}})Assert.Throws<BusinessException>(()=>SourcingAllocationRules.Normalize(invalid));Assert.Throws<BusinessException>(()=>SourcingAllocationRules.Normalize(new SourcingAllocationReleaseInput(Id(),"bad",V,"reason")));
    }
    [Fact] public void ModelKeepsActiveAcceptanceAndUnitUniquenessAndImmutableOriginWithinInventory()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var model=db.GetService<IDesignTimeModel>().Model;var allocation=model.FindEntityType(typeof(SourcingStockAllocation))!;Assert.True(allocation.FindProperty(nameof(SourcingStockAllocation.Version))!.IsConcurrencyToken);Assert.Contains(allocation.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual(["AcceptanceId"])&&i.GetFilter()=="[IsActive] = 1");var claim=model.FindEntityType(typeof(SerialUnitClaim))!;Assert.Contains(claim.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual(["UnitId"])&&i.GetFilter()=="[IsActive] = 1");Assert.True(claim.FindProperty(nameof(SerialUnitClaim.Version))!.IsConcurrencyToken);Assert.Contains(claim.GetForeignKeys(),fk=>fk.PrincipalEntityType.ClrType==typeof(SourcingStockAllocationLine));foreach(var type in new[]{typeof(SourcingStockAllocation),typeof(SourcingStockAllocationLine),typeof(SourcingAllocationCommand),typeof(SourcingAllocationEvent),typeof(SerialUnitClaim)}){var entity=model.FindEntityType(type)!;Assert.Equal("inventory",entity.GetSchema());Assert.All(entity.GetForeignKeys(),fk=>{Assert.Equal("inventory",fk.PrincipalEntityType.GetSchema());Assert.Equal(DeleteBehavior.Restrict,fk.DeleteBehavior);});}
    }
    [Fact] public void PriceFreeWireDoesNotExposeOwnerActorSupplierOrPhysicalIdentifiers()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};var data=new SourcingAllocationData(1,Id(),Id(),Id(),Id(),Id(),"Active","Active",V,At,At,At.AddHours(1),false,[new(Id(),"sku",1,[Id()])]);var json=JsonSerializer.Serialize(data,options);foreach(var forbidden in new[]{"ownerId","actorId","priceRial","serial","imei1","imei2","sourceKey","internalNote"})Assert.DoesNotContain("\""+forbidden+"\":",json);var history=JsonSerializer.Serialize(new SourcingAllocationEventPage(1,20,[new("9007199254740993","Active","allocation_active",At)],null),options);Assert.Contains("\"id\":\"9007199254740993\"",history);Assert.Contains("\"nextCursor\":null",history);Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<SourcingAllocationInput>(JsonSerializer.Serialize(Input(Plan()),options)[..^1]+",\"quantity\":1}",options));
    }
    [Fact] public async Task AllocationReplayAndReleaseRequireParentTransactionBeforeOpeningSql()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var service=new SourcingAllocationService(db,new StockReservationService(db,TimeProvider.System),TimeProvider.System,false);var plan=Plan();await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReplayAsync("actor",plan.RequestId,plan.TaskId,Id(),Input(plan),default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReplayReleaseAsync("actor",plan.RequestId,plan.TaskId,Id(),new(Id(),plan.AcceptanceId,V,"release"),default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReleaseAsync("actor",Id(),new(Id(),plan.AcceptanceId,V,"release"),default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReleaseForAcceptanceAsync("actor",plan.AcceptanceId,"release",default));Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public async Task SummaryLookupRejectsMoreThanFiftyRawAcceptanceIdsAndInvalidIdsBeforeSql()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var service=new SourcingAllocationService(db,new StockReservationService(db,TimeProvider.System),TimeProvider.System,false);foreach(var invalid in new string[][]{null!,Enumerable.Range(0,51).Select(_=>Id()).ToArray(),Enumerable.Repeat(Id(),51).ToArray()})Assert.Equal("invalid_sourcing_allocation",(await Assert.ThrowsAsync<BusinessException>(()=>service.ReadSummariesAsync(invalid,"owner",default))).Code);await Assert.ThrowsAsync<BusinessException>(()=>service.ReadSummariesAsync(["bad"],"owner",default));Assert.Empty(await service.ReadSummariesAsync([],"owner",default));Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public void SummaryWireCarriesExactQuantitiesWithoutPhysicalPicksPricesOrPrivateIdentity()
    {
        var data=new SourcingAllocationSummaryData(1,Id(),Id(),Id(),Id(),Id(),"Active","Expired",V,At,false,5,[new(Id(),"sku",2),new(Id(),"sku",3)]);var json=JsonSerializer.Serialize(data,new JsonSerializerOptions(JsonSerializerDefaults.Web));Assert.Equal(5,data.Lines.Sum(l=>l.Quantity));Assert.Contains("\"quantity\":5",json);Assert.Contains("\"effectiveState\":\"Expired\"",json);foreach(var field in new[]{"unitIds","unitId","ownerId","actorId","serial","imei1","imei2","unitPriceRial","priceRial","sourceKey","reason"})Assert.DoesNotContain("\""+field+"\":",json);
    }
}
