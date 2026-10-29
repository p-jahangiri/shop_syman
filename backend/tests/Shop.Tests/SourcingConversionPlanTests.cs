using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingConversionPlanTests
{
    private const string V="AAAAAAAAAAE=";
    private static readonly string Hash=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static SourcingConversionInput Input()=>new(Id(),Id(),V,V,V,Id(),Id(),V,Id(),V,Hash,null);
    private static SourcingStockAllocationPlan Plan()=>new(Id(),Id(),Id(),Id(),"owner",Hash,At.AddHours(2),false,[new(Id(),"sku","product_1",2,Hash)]);
    private static SourcingStockConversionProof Proof(SourcingStockAllocationPlan plan)=>new(Id(),plan.RequestId,plan.TaskId,plan.OfferId,plan.AcceptanceId,plan.TermsHash,V,At.AddHours(1),plan.ContainsDemo,plan.Lines.Select(l=>new SourcingAllocationSummaryLine(l.OfferLineId,l.VariantId,l.Quantity)).ToArray());
    private static AcceptedSourcingPurchasePlan Purchase(SourcingStockAllocationPlan plan)=>new(plan.RequestId,plan.TaskId,plan.OfferId,1,plan.AcceptanceId,plan.OwnerId,plan.TermsHash,V,V,V,plan.PurchaseUntil,"شرایط دقیق","Exact terms",plan.ContainsDemo,plan.Lines.Select(l=>new AcceptedSourcingPlanLine(l.OfferLineId,Id(),l.Quantity,"9007199254740993",null!)).ToArray());
    private static SourcingConversionMutation Result(AcceptedSourcingPurchasePlan plan)=>new(1,Id(),plan.RequestId,plan.TaskId,plan.OfferId,plan.AcceptanceId,Id(),Id(),Id(),V,plan.Lines.Select(l=>new SourcingCartLineLink(Id(),Id(),l.OfferLineId)).ToArray(),Id(),At,false);

    [Fact] public void ConversionInputCanonicalizesCommandUuidAndKeepsAbsentCartVersionExplicit()
    {
        var input=Input() with{RequestId=Guid.NewGuid().ToString("D")};var normalized=SourcingConversionPlanRules.Normalize(input);Assert.Equal(Guid.Parse(input.RequestId).ToString("N"),normalized.RequestId);Assert.Null(normalized.CartVersion);Assert.Contains("\"cartVersion\":null",JsonSerializer.Serialize(normalized,new JsonSerializerOptions(JsonSerializerDefaults.Web)));Assert.Equal(V,SourcingConversionPlanRules.Normalize(input with{CartVersion=V}).CartVersion);
        foreach(var invalid in new[]{input with{RequestVersion=""},input with{TaskVersion="AAAAAAAAAA=="},input with{AllocationVersion="AAAAAAAAAAE"},input with{AgreementVersion="not-version"},input with{CartVersion=""},input with{TermsHash=Hash.ToLowerInvariant()},input with{AgreementId=Guid.Empty.ToString("N")}})Assert.Throws<BusinessException>(()=>SourcingConversionPlanRules.Normalize(invalid));
    }
    [Fact] public void BrowserCannotSupplyPriceQuantityOwnerOrDeadlineAuthority()
    {
        var json=JsonSerializer.Serialize(Input(),new JsonSerializerOptions(JsonSerializerDefaults.Web));
        foreach(var extra in new[]{"\"ownerId\":\"another-owner\"","\"unitPriceRial\":\"1\"","\"quantity\":1","\"lines\":[]","\"expiresAt\":\"2099-01-01T00:00:00Z\""})Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<SourcingConversionInput>(json[..^1]+","+extra+"}",new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    [Fact] public void InventoryProofCoversEveryExactAcceptedLineAndSharedSkuQuantity()
    {
        var plan=Plan();plan=plan with{Lines=[plan.Lines[0],plan.Lines[0] with{OfferLineId=Id(),VariantId="SKU",Quantity=3}]};var proof=Proof(plan);SourcingStockConversionRules.ValidateCoverage(plan,proof,At);SourcingStockConversionRules.ValidateCoverage(plan,proof with{Lines=proof.Lines.Reverse().ToArray()},At);
        foreach(var bad in new[]{proof with{Lines=[proof.Lines[0]]},proof with{Lines=[proof.Lines[0],proof.Lines[0]]},proof with{Lines=[proof.Lines[0],proof.Lines[1] with{Quantity=4}]},proof with{Lines=[proof.Lines[0],proof.Lines[1] with{VariantId="replacement"} ]},proof with{Lines=[proof.Lines[0],proof.Lines[1] with{OfferLineId=Id()}]}})Assert.Equal("sourcing_allocation_conversion_conflict",Assert.Throws<BusinessException>(()=>SourcingStockConversionRules.ValidateCoverage(plan,bad,At)).Code);
    }
    [Fact] public void InventoryProofCannotCrossRequestTaskOfferAcceptanceTermsOrDemoScope()
    {
        var plan=Plan();var proof=Proof(plan);
        foreach(var bad in new[]{proof with{RequestId=Id()},proof with{TaskId=Id()},proof with{OfferId=Id()},proof with{AcceptanceId=Id()},proof with{TermsHash=new string('B',64)},proof with{IsDemo=true}})Assert.Equal("sourcing_allocation_conversion_conflict",Assert.Throws<BusinessException>(()=>SourcingStockConversionRules.ValidateCoverage(plan,bad,At)).Code);
    }
    [Theory][InlineData("now")][InlineData("purchase-ceiling")][InlineData("offset")]
    public void InventoryProofUsesAbsoluteServerClockDeadline(string invalid)
    {
        var plan=Plan();var proof=Proof(plan);proof=proof with{ExpiresAt=invalid switch{"now"=>At,"purchase-ceiling"=>plan.PurchaseUntil.AddTicks(1),_=>proof.ExpiresAt.ToOffset(TimeSpan.FromHours(1))}};Assert.Equal("sourcing_allocation_deadline_conflict",Assert.Throws<BusinessException>(()=>SourcingStockConversionRules.ValidateCoverage(plan,proof,At)).Code);SourcingStockConversionRules.ValidateCoverage(plan,Proof(plan) with{ExpiresAt=At.AddTicks(1)},At);
    }
    [Fact] public void InventoryProofHasNoMoneyDeviceOwnerOrPrivateSupplyFields()
    {
        var json=JsonSerializer.Serialize(Proof(Plan()),new JsonSerializerOptions(JsonSerializerDefaults.Web));foreach(var name in new[]{"unitIds","unitId","serial","imei1","ownerId","actorId","unitPriceRial","totalRial","sourceKey","internalNote"})Assert.DoesNotContain("\""+name+"\":",json,StringComparison.OrdinalIgnoreCase);
    }
    [Fact] public void CompletionLinksEveryAcceptedLineExactlyOnceWithoutSubstitution()
    {
        var stock=Plan();stock=stock with{Lines=[stock.Lines[0],stock.Lines[0] with{OfferLineId=Id()}]};var plan=Purchase(stock);var result=Result(plan);SourcingConversionPlanRules.ValidateCompletion(plan,result);
        foreach(var bad in new[]{result with{Lines=[result.Lines[0]]},result with{Lines=[result.Lines[0],result.Lines[1] with{OfferLineId=Id()}]},result with{Lines=[result.Lines[0],result.Lines[1] with{LineId=result.Lines[0].LineId}]},result with{Lines=[result.Lines[0],result.Lines[1] with{AgreementLineId=result.Lines[0].AgreementLineId}]},result with{Lines=[result.Lines[0],result.Lines[1] with{OfferLineId=result.Lines[0].OfferLineId}]}})Assert.Throws<InvalidOperationException>(()=>SourcingConversionPlanRules.ValidateCompletion(plan,bad));
    }
    [Fact] public async Task MarketEntriesAndInventoryAssertionRequireRootSerializableBeforeAnySqlOrModuleRead()
    {
        using var market=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedConversionMarket;Integrated Security=true;TrustServerCertificate=true").Options);var service=new SourcingConversionPlanService(market,new NoCatalog(),new NoPurchasing(),TimeProvider.System,true);var input=Input();var stock=Plan();var plan=Purchase(stock);var result=Result(plan);
        foreach(var action in new Func<Task>[] {()=>service.AcquireOwnerAsync("owner",default),()=>service.AcquireCandidateLocksAsync("owner",plan.RequestId,plan.OfferId,default),()=>service.AcquireRequestTaskAsync("owner",plan.RequestId,plan.OfferId,input.TaskId,input.RequestId,default),()=>service.CandidateAsync("owner",plan.RequestId,plan.OfferId,default),()=>service.PrepareAsync("owner",plan.RequestId,plan.OfferId,input,default),()=>service.CompleteAsync("owner",plan,result,default)})Assert.Contains("root Serializable",(await Assert.ThrowsAsync<InvalidOperationException>(action)).Message);
        using var inventory=new InventoryDbContext(new DbContextOptionsBuilder<InventoryDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedConversionInventory;Integrated Security=true;TrustServerCertificate=true").Options);var guard=new SourcingConversionGuard(inventory,new(inventory,TimeProvider.System),TimeProvider.System,true);Assert.Contains("root Serializable",(await Assert.ThrowsAsync<InvalidOperationException>(()=>guard.AssertAsync("owner",stock,Id(),V,default))).Message);Assert.Empty(market.ChangeTracker.Entries());Assert.Empty(inventory.ChangeTracker.Entries());
    }
    private sealed class NoCatalog:ICatalogOfferReader
    {
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct)=>throw new InvalidOperationException("Do not read Catalog before the root transaction and scoped locks.");
        public Task<OfferSkuPage> LookupAsync(string modelId,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class NoPurchasing:IPurchaseConfiguration
    {
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("Do not read purchasing before the root transaction and scoped locks.");
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>throw new NotSupportedException();
    }
}
